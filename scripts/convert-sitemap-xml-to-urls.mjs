#!/usr/bin/env node
/**
 * convert-sitemap-xml-to-urls.mjs
 *
 * Convert a browser-saved sitemap XML file into a plain urls.txt file.
 *
 * Supported inputs:
 * - XML sitemap index (<sitemapindex>) with nested sitemap .xml URLs
 * - XML urlset (<urlset>) with page URLs
 *
 * This is intended as a manual fallback for sites protected by
 * Cloudflare / WAF / bot protection, where sitemap URLs may be visible
 * in a normal browser but blocked to scripted requests.
 *
 * Usage:
 *   node scripts/convert-sitemap-xml-to-urls.mjs \
 *     --input ./saved-sitemap.xml \
 *     --out ./reports/20260306-120000/urls.txt
 *
 * Optional:
 *   --base-url https://www.example.com
 *   --exclude-path "/tag/,/category/,/author/"
 *   --include-path "/news/,/about/"
 *
 * Notes:
 * - If the input is a sitemap index, this script outputs the nested sitemap
 *   URLs it finds. It does NOT fetch them.
 * - To build a final page URL list from a protected site, save each nested
 *   sitemap XML in the browser and run this helper on the saved file(s).
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

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function normalizeUrl(u, baseUrl) {
  if (!u) return "";
  try {
    const url = baseUrl ? new URL(u, baseUrl) : new URL(u);
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return String(u).trim();
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

function extractLocs(xml, rootTag) {
  const locs = [];
  const re = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const val = xmlDecode(m[1]).trim();
    if (val) locs.push(val);
  }
  return locs;
}

function detectRootType(xml) {
  const s = xml.toLowerCase();
  if (s.includes("<sitemapindex")) return "sitemapindex";
  if (s.includes("<urlset")) return "urlset";
  return "unknown";
}

function shouldInclude(url, includePaths, excludePaths) {
  const u = String(url || "");
  if (!u) return false;
  if (includePaths.length && !includePaths.some((p) => u.includes(p))) {
    return false;
  }
  if (excludePaths.some((p) => u.includes(p))) {
    return false;
  }
  return true;
}

function main() {
  const args = parseArgs(process.argv);
  const input = args.input || args.in;
  const out = args.out || "urls.txt";
  const baseUrl = args["base-url"] || "";
  const includePaths = splitCsvish(args["include-path"]);
  const excludePaths = splitCsvish(args["exclude-path"]);

  if (!input) {
    console.error("ERROR: Missing --input <saved-sitemap.xml>");
    process.exit(1);
  }
  if (!fs.existsSync(input)) {
    console.error(`ERROR: Input file not found: ${input}`);
    process.exit(1);
  }

  const xml = fs.readFileSync(input, "utf8");
  const type = detectRootType(xml);
  const locs = extractLocs(xml, type);
  const urls = [];
  const seen = new Set();

  for (const raw of locs) {
    const url = normalizeUrl(raw, baseUrl);
    if (!url) continue;
    if (!shouldInclude(url, includePaths, excludePaths)) continue;
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  ensureDirForFile(out);
  fs.writeFileSync(path.resolve(out), urls.join("\n") + (urls.length ? "\n" : ""), "utf8");

  console.log(`Input type: ${type}`);
  console.log(`Extracted URLs: ${urls.length}`);
  console.log(`Wrote: ${path.resolve(out)}`);

  if (type === "sitemapindex") {
    console.log("Note: This file was a sitemap index. The output contains nested sitemap URLs.");
    console.log("For protected sites, save each nested sitemap XML in your browser and run this helper on those files too.");
  }
}

main();
