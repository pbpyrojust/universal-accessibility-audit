#!/usr/bin/env node
/**
 * build-urls-from-sitemap.mjs
 *
 * Universal URL list builder for accessibility audits.
 * Works with:
 *  - WordPress + Yoast (sitemap_index.xml) and WP core sitemaps
 *  - Static sites with sitemap.xml
 *
 * Defaults:
 *  - Prefer "page" + "post" style sitemaps when a sitemap index exists
 *  - Exclude common archive/taxonomy pages (tag/category/author/pagination)
 *  - Output a newline-delimited URLs file suitable for the audit runner
 *
 * Examples:
 *  node scripts/build-urls-from-sitemap.mjs --site https://www.example.com --out scripts/urls.txt
 *  node scripts/build-urls-from-sitemap.mjs --site https://example.com --include-sitemaps "page,post" --exclude-path "/tag/,/category/" --out scripts/urls.txt
 *  node scripts/build-urls-from-sitemap.mjs --sitemap-url https://example.com/sitemap.xml --out scripts/urls.txt
 *
 * Notes:
 *  - Node 18+ recommended (uses global fetch)
 */

import fs from "node:fs";
import { XMLParser } from "fast-xml-parser";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function normalizeSite(site) {
  if (!site) return null;
  const u = new URL(site);
  // Force https if someone passed http accidentally? We'll keep as-is.
  // Ensure no trailing slash for consistent concatenation.
  u.pathname = "/";
  u.hash = "";
  u.search = "";
  return u.origin;
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    // remove trailing slash except root
    if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return u;
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "Universal-A11y-Audit/1.0 (+Playwright+axe-core)" },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function toArray(maybe) {
  if (!maybe) return [];
  return Array.isArray(maybe) ? maybe : [maybe];
}

function splitCsv(v) {
  if (!v) return [];
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function compileMatchers(items) {
  // items can be substrings OR /regex/ style or plain regex string
  return (items || []).map((raw) => {
    const s = String(raw).trim();
    if (!s) return null;
    if (s.startsWith("/") && s.endsWith("/") && s.length > 2) {
      return { type: "regex", value: new RegExp(s.slice(1, -1), "i"), raw: s };
    }
    return { type: "substr", value: s, raw: s };
  }).filter(Boolean);
}

function matchesAny(url, matchers) {
  for (const m of matchers) {
    if (m.type === "substr" && url.includes(m.value)) return true;
    if (m.type === "regex" && m.value.test(url)) return true;
  }
  return false;
}

async function discoverSitemapsFromRobots(siteOrigin) {
  const robotsUrl = `${siteOrigin}/robots.txt`;
  try {
    const txt = await fetchText(robotsUrl);
    const lines = txt.split(/\r?\n/g);
    const sitemaps = lines
      .map((l) => l.trim())
      .filter((l) => /^sitemap:/i.test(l))
      .map((l) => l.split(/:\s*/i).slice(1).join(":").trim())
      .filter(Boolean);
    return sitemaps.map(normalizeUrl);
  } catch {
    return [];
  }
}

function parseSitemapXml(xml) {
  const parser = new XMLParser({ ignoreAttributes: false });
  return parser.parse(xml);
}

function extractLocsFromUrlset(parsed) {
  const urlset = parsed?.urlset?.url;
  const urls = toArray(urlset).map((u) => u?.loc).filter(Boolean);
  return urls.map(normalizeUrl);
}

function extractSitemapsFromIndex(parsed) {
  const s = parsed?.sitemapindex?.sitemap;
  const urls = toArray(s).map((x) => x?.loc).filter(Boolean);
  return urls.map(normalizeUrl);
}

function defaultSitemapIncludeMatchers() {
  // Focus on human-facing content by default
  // Yoast:
  //  - page-sitemap.xml
  //  - post-sitemap.xml
  // WP core:
  //  - wp-sitemap-posts-post-*.xml
  //  - wp-sitemap-posts-page-*.xml
  return compileMatchers([
    "page-sitemap",
    "post-sitemap",
    "wp-sitemap-posts-page",
    "wp-sitemap-posts-post",
  ]);
}

function defaultSitemapExcludeMatchers() {
  // Exclude taxonomy/author/media archives by default
  return compileMatchers([
    "category-sitemap",
    "post_tag-sitemap",
    "tag-sitemap",
    "author-sitemap",
    "archive-sitemap",
    "wp-sitemap-taxonomies",
    "wp-sitemap-users",
    "wp-sitemap-posts-attachment",
  ]);
}

function defaultUrlExcludeMatchers() {
  return compileMatchers([
    "/tag/",
    "/category/",
    "/author/",
    // pagination
    "/page/",
    // feeds & endpoints
    "/feed",
    "/wp-json/",
    "?",
  ]);
}

async function main() {
  const args = parseArgs(process.argv);

  const outPath = args.out || "scripts/urls.txt";
  const maxUrls = args["max-urls"] ? Number(args["max-urls"]) : null;

  const siteOrigin = normalizeSite(args.site);
  const sitemapUrlArg = args["sitemap-url"] ? normalizeUrl(args["sitemap-url"]) : null;

  if (!siteOrigin && !sitemapUrlArg) {
    console.error("ERROR: Provide --site https://example.com OR --sitemap-url https://example.com/sitemap.xml");
    process.exit(1);
  }

  const includeSitemaps = compileMatchers(splitCsv(args["include-sitemaps"]));
  const excludeSitemaps = compileMatchers(splitCsv(args["exclude-sitemaps"]));
  const includePaths = compileMatchers(splitCsv(args["include-path"]));
  const excludePaths = compileMatchers(splitCsv(args["exclude-path"]));

  // Defaults
  const sitemapInclude = includeSitemaps.length ? includeSitemaps : defaultSitemapIncludeMatchers();
  const sitemapExclude = excludeSitemaps.length ? excludeSitemaps : defaultSitemapExcludeMatchers();
  const urlExclude = excludePaths.length ? excludePaths : defaultUrlExcludeMatchers();

  // Determine sitemap candidates
  let candidates = [];
  if (sitemapUrlArg) {
    candidates = [sitemapUrlArg];
  } else {
    const fromRobots = await discoverSitemapsFromRobots(siteOrigin);
    candidates = fromRobots.length
      ? fromRobots
      : [
          `${siteOrigin}/sitemap_index.xml`,
          `${siteOrigin}/sitemap.xml`,
        ].map(normalizeUrl);
  }

  // Fetch first working sitemap
  let sitemapXml = null;
  let sitemapUrlUsed = null;
  for (const c of candidates) {
    try {
      sitemapXml = await fetchText(c);
      sitemapUrlUsed = c;
      break;
    } catch {
      // continue
    }
  }

  if (!sitemapXml || !sitemapUrlUsed) {
    console.error("ERROR: Could not fetch sitemap (robots.txt, sitemap_index.xml, sitemap.xml).");
    console.error("Tip: Use --sitemap-url explicitly, or use the crawl mode in the audit runner.");
    process.exit(1);
  }

  console.log(`Using sitemap: ${sitemapUrlUsed}`);

  const parsed = parseSitemapXml(sitemapXml);
  let urls = [];

  // If sitemap index, pick child sitemaps then extract URL locs from each
  const childSitemaps = extractSitemapsFromIndex(parsed);
  if (childSitemaps.length) {
    // Filter sitemap files
    const selected = childSitemaps
      .filter((u) => (sitemapInclude.length ? matchesAny(u, sitemapInclude) : true))
      .filter((u) => !matchesAny(u, sitemapExclude));

    console.log(`Found ${childSitemaps.length} sitemaps in index; selected ${selected.length}`);

    for (const sm of selected) {
      try {
        console.log(`Processing ${sm}`);
        const xml = await fetchText(sm);
        const p = parseSitemapXml(xml);
        urls.push(...extractLocsFromUrlset(p));
      } catch (e) {
        console.warn(`WARN: Failed to process sitemap ${sm}: ${String(e?.message || e)}`);
      }
    }
  } else {
    // Standard sitemap.xml (urlset)
    urls = extractLocsFromUrlset(parsed);
    console.log(`Found ${urls.length} URLs in sitemap`);
  }

  // Apply URL filters
  urls = urls.map(normalizeUrl);

  // Include-path can be used to narrow to specific site areas
  if (includePaths.length) {
    urls = urls.filter((u) => matchesAny(u, includePaths));
  }
  // Apply default excludes (and any user excludes)
  urls = urls.filter((u) => !matchesAny(u, urlExclude));

  // Deduplicate + stable sort
  const set = new Set(urls);
  let finalUrls = Array.from(set).sort();

  if (maxUrls && finalUrls.length > maxUrls) {
    finalUrls = finalUrls.slice(0, maxUrls);
  }

  fs.writeFileSync(outPath, finalUrls.join("\n") + "\n");
  console.log(`✔ Wrote ${finalUrls.length} URLs to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
