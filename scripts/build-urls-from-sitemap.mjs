#!/usr/bin/env node
/**
 * Build a URL list from a site's sitemap(s).
 *
 * Supports:
 * - robots.txt sitemap hints
 * - sitemap_index.xml
 * - sitemap.xml
 * - Drupal paged sitemap indexes (e.g. sitemap.xml?page=1)
 *
 * Notes:
 * - This script is for discovery, not bypassing bot protection.
 * - For protected sites, use the browser-saved XML fallback helper:
 *   scripts/convert-sitemap-xml-to-urls.mjs
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.replace(/^--/, "");
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function normalizeSite(site) {
  const u = new URL(site);
  u.hash = "";
  return u.origin;
}

function normalizeUrl(u, base) {
  try {
    const url = base ? new URL(u, base) : new URL(u);
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return String(u || "").trim();
  }
}

function splitCsvish(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function xmlDecode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchText(url, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "user-agent": "Universal-A11y-Audit URL Builder",
        "accept": "text/plain, application/xml, text/xml, */*",
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url, text };
  } catch (e) {
    return { ok: false, status: 0, url, text: "", error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function detectCloudflareOrBot(text, status) {
  const s = String(text || "").toLowerCase();
  if ([403, 429, 503].includes(Number(status))) return true;
  return (
    s.includes("just a moment") ||
    s.includes("cf-browser-verification") ||
    s.includes("attention required") ||
    s.includes("cloudflare") ||
    s.includes("captcha") ||
    s.includes("verify you are human")
  );
}

function extractLocs(xml) {
  const locs = [];
  const re = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const v = xmlDecode(m[1]).trim();
    if (v) locs.push(v);
  }
  return locs;
}

function detectRootType(xml) {
  const s = String(xml || "").toLowerCase();
  if (s.includes("<sitemapindex")) return "sitemapindex";
  if (s.includes("<urlset")) return "urlset";
  return "unknown";
}

function shouldKeepUrl(url, includePaths, excludePaths) {
  const u = String(url || "");
  if (!u) return false;
  if (includePaths.length && !includePaths.some((p) => u.includes(p))) return false;
  if (excludePaths.some((p) => u.includes(p))) return false;
  return true;
}

function selectContentSitemaps(urls, includeSitemaps, includeAllSitemaps = false) {
  if (includeAllSitemaps) {
    return urls;
  }

  if (includeSitemaps.length) {
    return urls.filter((u) => includeSitemaps.some((p) => u.toLowerCase().includes(p.toLowerCase())));
  }

  const selected = urls.filter((u) => {
    const s = u.toLowerCase();

    // Include user-facing content sitemap patterns across common generators:
    // - Yoast: page-sitemap.xml, post-sitemap.xml
    // - Drupal XML Sitemap: sitemap.xml?page=1
    // - WordPress core: wp-sitemap-posts-post-1.xml, wp-sitemap-posts-page-1.xml,
    //   and other public post-type sitemaps under wp-sitemap-posts-*
    const include =
      s.includes("page-sitemap") ||
      s.includes("post-sitemap") ||
      s.includes("/sitemap.xml?page=") ||
      s.includes("wp-sitemap-posts-");

    // Exclude common non-content / archive / media / user sitemap patterns
    const exclude =
      s.includes("tag") ||
      s.includes("category") ||
      s.includes("author") ||
      s.includes("taxonomy") ||
      s.includes("wp-sitemap-taxonomies-") ||
      s.includes("wp-sitemap-users") ||
      s.includes("attachment") ||
      s.includes("media") ||
      s.includes("image-sitemap") ||
      s.includes("video-sitemap");

    return include && !exclude;
  });

  // If we still selected nothing, fall back to all non-excluded sitemap URLs.
  // This helps with uncommon-but-valid sitemap naming conventions while still
  // avoiding obviously non-content sitemap sources.
  if (selected.length === 0) {
    return urls.filter((u) => {
      const s = u.toLowerCase();
      const exclude =
        s.includes("tag") ||
        s.includes("category") ||
        s.includes("author") ||
        s.includes("taxonomy") ||
        s.includes("wp-sitemap-taxonomies-") ||
        s.includes("wp-sitemap-users") ||
        s.includes("attachment") ||
        s.includes("media") ||
        s.includes("image-sitemap") ||
        s.includes("video-sitemap");
      return !exclude;
    });
  }

  return selected;
}

async function getRobotsHints(siteOrigin) {
  const robotsUrl = `${siteOrigin}/robots.txt`;
  const details = await fetchText(robotsUrl);
  if (!details.ok) return { sitemapHints: [], robotsText: "", crawlDelay: null, details };

  const lines = details.text.split(/\r?\n/g);
  const hints = [];
  let crawlDelay = null;
  for (const line of lines) {
    const trimmed = line.trim();
    const m = /^sitemap:\s*(.+)$/i.exec(trimmed);
    if (m) hints.push(normalizeUrl(m[1], siteOrigin));
    const cd = /^crawl-delay:\s*(\d+)$/i.exec(trimmed);
    if (cd && crawlDelay === null) crawlDelay = Number(cd[1]);
  }
  return { sitemapHints: hints, robotsText: details.text, crawlDelay, details };
}

async function main() {
  const args = parseArgs(process.argv);
  const site = args.site ? normalizeSite(args.site) : null;
  const out = args.out || args["urls-file"] || "scripts/urls.txt";
  const includePaths = splitCsvish(args["include-path"]);
  const excludePaths = splitCsvish(
    args["exclude-path"] || "/tag/,/category/,/author/,/page/,/wp-json/,?,/feed"
  );
  const includeSitemaps = splitCsvish(args["include-sitemaps"]);
  const includeAllSitemaps = Boolean(args["include-all-sitemaps"]);

  if (!site && !args["sitemap-url"]) {
    console.error("ERROR: Provide --site https://www.example.com or --sitemap-url https://www.example.com/sitemap.xml");
    process.exit(1);
  }

  let sitemapCandidates = [];
  let crawlDelay = null;
  let robotsBlocked = false;

  if (args["sitemap-url"]) {
    sitemapCandidates = [args["sitemap-url"]];
  } else {
    const robots = await getRobotsHints(site);
    crawlDelay = robots.crawlDelay;
    if (robots.details && detectCloudflareOrBot(robots.details.text, robots.details.status)) {
      robotsBlocked = true;
    }
    sitemapCandidates = [
      ...robots.sitemapHints,
      `${site}/sitemap_index.xml`,
      `${site}/sitemap.xml`,
    ];
  }

  sitemapCandidates = Array.from(new Set(sitemapCandidates.map((u) => normalizeUrl(u, site || undefined))));

  let selectedTopLevel = null;
  let topLevelXml = null;
  let topLevelType = "unknown";
  let botProtected = false;

  for (const candidate of sitemapCandidates) {
    const details = await fetchText(candidate);
    if (detectCloudflareOrBot(details.text, details.status)) {
      botProtected = true;
      continue;
    }
    if (!details.ok || !details.text) continue;
    const type = detectRootType(details.text);
    if (type !== "unknown") {
      selectedTopLevel = candidate;
      topLevelXml = details.text;
      topLevelType = type;
      break;
    }
  }

  if (!selectedTopLevel || !topLevelXml) {
    console.error("ERROR: Could not fetch sitemap (robots.txt, sitemap_index.xml, sitemap.xml).");
    if (botProtected || robotsBlocked) {
      console.error("NOTE: The site appears to use bot protection / WAF / Cloudflare-style challenges.");
    }
    console.error("Tip: Use --sitemap-url explicitly, or use the browser-saved XML fallback helper.");
    console.error("Tip: For protected sites, save the sitemap XML in your browser and run:");
    console.error("     node scripts/convert-sitemap-xml-to-urls.mjs --input ./saved-sitemap.xml --out ./urls.txt");
    process.exit(1);
  }

  console.log(`Using sitemap: ${selectedTopLevel}`);
  if (crawlDelay !== null) {
    console.log(`robots.txt Crawl-delay detected: ${crawlDelay}s`);
  }

  let urls = [];
  if (topLevelType === "urlset") {
    urls = extractLocs(topLevelXml);
    // If this looks like a Drupal top-level index rendered as urlset of nested sitemap pages,
    // the user can still choose to use them directly or convert browser-saved XML.
  } else if (topLevelType === "sitemapindex") {
    const sitemapUrls = extractLocs(topLevelXml);
    const selected = selectContentSitemaps(sitemapUrls, includeSitemaps, includeAllSitemaps);
    console.log(`Found ${sitemapUrls.length} sitemaps in index; selected ${selected.length}`);
    for (const sm of selected) {
      console.log(`Processing ${sm}`);
      const details = await fetchText(sm);
      if (detectCloudflareOrBot(details.text, details.status)) {
        console.warn(`Skipping protected sitemap: ${sm}`);
        continue;
      }
      if (!details.ok || !details.text) continue;
      const type = detectRootType(details.text);
      if (type === "urlset") {
        urls.push(...extractLocs(details.text));
      } else if (type === "sitemapindex") {
        // nested index, collect locs but do not recurse deeply
        urls.push(...extractLocs(details.text));
      }
    }
  }

  urls = urls
    .map((u) => normalizeUrl(u, site || undefined))
    .filter((u) => shouldKeepUrl(u, includePaths, excludePaths));

  urls = Array.from(new Set(urls));

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(path.resolve(out), urls.join("\n") + (urls.length ? "\n" : ""), "utf8");
  console.log(`✔ Wrote ${urls.length} URLs to ${path.resolve(out)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
