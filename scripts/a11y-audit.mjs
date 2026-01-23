#!/usr/bin/env node
/**
 * a11y-audit.mjs
 *
 * Automated accessibility audit: Playwright + axe-core
 *
 * Outputs (in a timestamped run folder):
 *  - a11y-report.json (full per-page results)
 *  - a11y-violations.csv (one row per violating node)
 *  - a11y-run-metadata.json (summary counts for reporting)
 *
 * Features:
 *  - Progress logging with per-page timing
 *  - Timestamped reports (prevents overwriting)
 *  - Google Sheets helper links included in CSV (with SHEET_ID placeholder or --sheet-id)
 *
 * Usage examples:
 *   node scripts/a11y-audit.mjs --urls-file scripts/urls.txt --out-dir reports
 *   node scripts/a11y-audit.mjs --crawl --start https://example.com --max-pages 75 --out-dir reports
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { stringify } from "csv-stringify/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--crawl") args.crawl = true;
    else if (a.startsWith("--")) {
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

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    // normalize trailing slash for consistency (except root)
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return u;
  }
}

function isSameOrigin(u, origin) {
  try {
    return new URL(u).origin === origin;
  } catch {
    return false;
  }
}

function loadUrlsFromFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#"))
    .map(normalizeUrl);
}

async function crawlInternalLinks(page, startUrl, maxPages) {
  const origin = new URL(startUrl).origin;
  const queue = [normalizeUrl(startUrl)];
  const seen = new Set(queue);

  while (queue.length && seen.size < maxPages) {
    const current = queue.shift();
    try {
      await page.goto(current, { waitUntil: "domcontentloaded", timeout: 60000 });
      const hrefs = await page.$$eval("a[href]", (as) =>
        as.map((a) => a.getAttribute("href")).filter(Boolean)
      );
      for (const href of hrefs) {
        let abs;
        try {
          abs = new URL(href, current).toString();
        } catch {
          continue;
        }
        abs = normalizeUrl(abs);
        if (!isSameOrigin(abs, origin)) continue;

        // Skip common non-content paths / file downloads
        const u = new URL(abs);
        const p = u.pathname.toLowerCase();
        if (p.endsWith(".pdf") || p.endsWith(".png") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".zip")) continue;

        if (!seen.has(abs) && seen.size < maxPages) {
          seen.add(abs);
          queue.push(abs);
        }
      }
    } catch {
      // ignore crawl failures; will show in final report as "page error" during scan if included
    }
  }

  return Array.from(seen);
}

async function runAxe(page) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    return await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
      resultTypes: ["violations", "incomplete", "passes"],
    });
  });
  return result;
}

function mapImpactToPriority(impact) {
  if (impact === "critical") return "P0-Critical";
  if (impact === "serious") return "P1-High";
  if (impact === "moderate") return "P2-Medium";
  if (impact === "minor") return "P3-Low";
  return "P2-Medium";
}

function extractWcagRefs(tags = []) {
  const sc = tags.filter((t) => /^wcag\d+/.test(t));
  return sc.length ? sc.join(" | ") : "";
}

function getRunIdFromNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function sheetFilterUrl(sheetId, gid, column, value) {
  // We intentionally keep this simple. After CSV import, users can replace SHEET_ID with their real ID.
  // Note: Google Sheets filter params differ depending on UI. This URL is a practical helper for jumping to a sheet
  // and using Find/Filter quickly. Teams often use filter views or slicers after import.
  const safeId = sheetId || "SHEET_ID";
  const safeGid = gid || "0";
  const v = encodeURIComponent(String(value));
  // Use a query-ish fragment that is still useful even if Sheets doesn't auto-apply it as a filter in all cases.
  // It acts as a documented "search link" that makes it trivial to locate values.
  return `https://docs.google.com/spreadsheets/d/${safeId}/edit#gid=${safeGid}&q=${column}%3A${v}`;
}

async function main() {
  const args = parseArgs(process.argv);

  const baseOutDir = path.resolve(process.cwd(), args["out-dir"] || "reports");
  const runId = args["run-id"] ? String(args["run-id"]) : getRunIdFromNow();
  const outDir = path.join(baseOutDir, runId);
  ensureDir(outDir);

  const sheetId = args["sheet-id"] ? String(args["sheet-id"]) : "SHEET_ID";
  const sheetGid = args["sheet-gid"] ? String(args["sheet-gid"]) : "0";

  const startUrl = args.start ? normalizeUrl(args.start) : "https://example.com/";
  const maxPages = args["max-pages"] ? Number(args["max-pages"]) : 50;

  let urls = [];
  if (args.crawl) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    urls = await crawlInternalLinks(page, startUrl, maxPages);
    await browser.close();
  } else if (args["urls-file"]) {
    const filePath = path.resolve(process.cwd(), args["urls-file"]);
    urls = loadUrlsFromFile(filePath);
  } else {
    urls = [startUrl];
  }

  // Scan
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Universal-A11y-Audit (Playwright + axe-core)",
  });
  const page = await context.newPage();

  const siteResults = [];
  const csvRows = [];

  const startedAt = Date.now();
  let totalViolationNodes = 0;
  let pageErrors = 0;

  // Summary maps for report metadata
  const byImpact = new Map();
  const byRule = new Map();
  const byPage = new Map();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const idx = i + 1;

    const pageStart = Date.now();
    console.log(`[${idx}/${urls.length}] Scanning: ${url}`);

    const pageResult = {
      url,
      ok: true,
      error: null,
      axe: null,
      timestamp: new Date().toISOString(),
    };

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(800);

      const axe = await runAxe(page);
      pageResult.axe = axe;

      let pageViolationNodes = 0;

      for (const v of axe.violations || []) {
        byRule.set(v.id, (byRule.get(v.id) || 0) + 1);
        byImpact.set(v.impact || "unknown", (byImpact.get(v.impact || "unknown") || 0) + 1);

        for (const node of v.nodes || []) {
          pageViolationNodes++;
          byPage.set(url, (byPage.get(url) || 0) + 1);

          const target = Array.isArray(node.target) ? node.target.join(" | ") : String(node.target || "");
          const wcagRefs = extractWcagRefs(v.tags || []);

          csvRows.push({
            scope: "Page",
            page_url: url,
            rule_id: v.id,
            impact: v.impact || "",
            priority: mapImpactToPriority(v.impact),
            wcag_refs: wcagRefs,
            help: v.help || "",
            help_url: v.helpUrl || "",
            description: v.description || "",
            failure_summary: node.failureSummary || "",
            selector_target: target,
            html_snippet: (node.html || "").replace(/\s+/g, " ").slice(0, 500),

            // Helper fields for ticketing / Sheets linking
            is_global_candidate: ["color-contrast", "meta-viewport", "aria-prohibited-attr", "button-name", "link-name"].includes(v.id)
              ? "yes"
              : "no",
            suggested_github_issue: v.id,
            rule_filter_url: sheetFilterUrl(sheetId, sheetGid, "rule_id", v.id),
            impact_filter_url: sheetFilterUrl(sheetId, sheetGid, "impact", v.impact || ""),
            page_filter_url: sheetFilterUrl(sheetId, sheetGid, "page_url", url),

            recommendation:
              "Fix the issue per axe guidance; ensure WCAG 2.1 Level AA compliance for this component/site-wide pattern.",
          });
        }
      }

      totalViolationNodes += pageViolationNodes;

      const elapsed = ((Date.now() - pageStart) / 1000).toFixed(1);
      const totalElapsed = ((Date.now() - startedAt) / 60).toFixed(1);
      console.log(
        `   ↳ Done in ${elapsed}s | violation nodes: ${pageViolationNodes} | total: ${totalViolationNodes} | elapsed: ${totalElapsed}m`
      );
    } catch (err) {
      pageResult.ok = false;
      pageResult.error = String(err?.message || err);
      pageErrors++;

      csvRows.push({
        scope: "Page",
        page_url: url,
        rule_id: "page_error",
        impact: "serious",
        priority: "P1-High",
        wcag_refs: "",
        help: "Page failed to load for scanning",
        help_url: "",
        description: "Playwright navigation error",
        failure_summary: pageResult.error,
        selector_target: "",
        html_snippet: "",
        is_global_candidate: "no",
        suggested_github_issue: "page_error",
        rule_filter_url: sheetFilterUrl(sheetId, sheetGid, "rule_id", "page_error"),
        impact_filter_url: sheetFilterUrl(sheetId, sheetGid, "impact", "serious"),
        page_filter_url: sheetFilterUrl(sheetId, sheetGid, "page_url", url),
        recommendation:
          "Confirm the page is publicly accessible without auth/bot protection. Re-run scan; if persistent, ticket separately.",
      });

      const elapsed = ((Date.now() - pageStart) / 1000).toFixed(1);
      const totalElapsed = ((Date.now() - startedAt) / 60).toFixed(1);
      console.log(`   ↳ ERROR in ${elapsed}s | elapsed: ${totalElapsed}m`);
    }

    siteResults.push(pageResult);
  }

  await browser.close();

  const jsonOut = path.join(outDir, "a11y-report.json");
  fs.writeFileSync(jsonOut, JSON.stringify({ runId, scanned: urls, results: siteResults }, null, 2));

  const csvOut = path.join(outDir, "a11y-violations.csv");
  const columns = [
    "scope",
    "page_url",
    "rule_id",
    "impact",
    "priority",
    "wcag_refs",
    "help",
    "help_url",
    "description",
    "failure_summary",
    "selector_target",
    "html_snippet",
    "is_global_candidate",
    "suggested_github_issue",
    "rule_filter_url",
    "impact_filter_url",
    "page_filter_url",
    "recommendation",
  ];
  fs.writeFileSync(csvOut, stringify(csvRows, { header: true, columns }));

  const meta = {
    runId,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    pagesScanned: urls.length,
    pageErrors,
    violationNodes: csvRows.filter((r) => r.rule_id !== "page_error").length,
    byImpact: Object.fromEntries(byImpact),
    byRule: Object.fromEntries(byRule),
    topPages: Array.from(byPage.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([url, count]) => ({ url, count })),
  };
  const metaOut = path.join(outDir, "a11y-run-metadata.json");
  fs.writeFileSync(metaOut, JSON.stringify(meta, null, 2));

  // Also write a pointer for convenience
  const latestPtr = path.join(baseOutDir, "latest");
  try {
    // best effort: create/overwrite "latest" file with runId
    fs.writeFileSync(latestPtr, runId, "utf8");
  } catch {}

  console.log(`Scanned ${urls.length} page(s).`);
  console.log(`CSV rows (violating nodes): ${meta.violationNodes}`);
  if (pageErrors) console.log(`Pages with scan errors: ${pageErrors}`);
  console.log(`Wrote: ${jsonOut}`);
  console.log(`Wrote: ${csvOut}`);
  console.log(`Wrote: ${metaOut}`);
  console.log(`Run folder: ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
