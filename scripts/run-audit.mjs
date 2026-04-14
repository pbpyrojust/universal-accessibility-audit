#!/usr/bin/env node
/**
 * Orchestrates URL build + a11y audit + report generation + ticket CSV generation.
 * Supports safer modes for protected sites:
 *   --slow
 *   --respect-robots
 *   --sheet-url
 *   --urls-file
 *   --cloudflare-aware
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function getRunIdFromNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function runNodeScript(scriptPath, scriptArgs) {
  return spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    stdio: "inherit",
    env: process.env,
  });
}


function slugifySite(site) {
  if (!site) return "site";
  try {
    const url = new URL(site);
    const host = (url.hostname || site).replace(/^www\./, "").toLowerCase();
    return host.replace(/[^a-z0-9.-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "") || "site";
  } catch {
    return String(site || "site").toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "") || "site";
  }
}

function parseSheetUrl(sheetUrl) {
  try {
    const u = new URL(sheetUrl);
    const m = u.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    const sheetId = m ? m[1] : null;
    const gid = u.searchParams.get("gid") || (u.hash.match(/gid=(\d+)/)?.[1] ?? "0");
    return { sheetId, sheetGid: gid || "0" };
  } catch {
    return { sheetId: null, sheetGid: "0" };
  }
}

function readRobotsDisallows(site) {
  try {
    const robotsUrl = new URL("/robots.txt", site).toString();
    return { robotsUrl };
  } catch {
    return { robotsUrl: null };
  }
}

function printBotNotice(site) {
  console.warn(`\nWARNING: Possible bot protection / WAF / Cloudflare challenge detected for ${site}`);
  console.warn("This tool does not bypass bot protection.");
  console.warn("Recommended next steps:");
  console.warn("  1) Retry with --slow and --respect-robots");
  console.warn("  2) Use --sitemap-url with a quoted URL if needed");
  console.warn("  3) Save sitemap XML in your browser and convert it with:");
  console.warn("     node scripts/convert-sitemap-xml-to-urls.mjs --input ./saved-sitemap.xml --out ./urls.txt");
  console.warn("  4) Audit using --urls-file ./urls.txt");
  console.warn("Tip: Wait a while before retrying to avoid triggering additional rate limits.\n");
}

function main() {
  const args = parseArgs(process.argv);
  const site = args.site;
  const siteSlug = slugifySite(site || args["sitemap-url"] || "site");
  const runId = args["run-id"] || `${siteSlug}-${getRunIdFromNow()}`;
  const baseOutDir = path.resolve(process.cwd(), args["out-dir"] || "reports");
  const outDir = path.join(baseOutDir, runId);
  fs.mkdirSync(outDir, { recursive: true });

  let sheetId = args["sheet-id"] || "SHEET_ID";
  let sheetGid = args["sheet-gid"] || "0";
  if (args["sheet-url"]) {
    const parsed = parseSheetUrl(args["sheet-url"]);
    if (parsed.sheetId) sheetId = parsed.sheetId;
    if (parsed.sheetGid) sheetGid = parsed.sheetGid;
  }

  const urlsFile = args["urls-file"] ? path.resolve(args["urls-file"]) : path.join(outDir, "urls.txt");
  const batchSize = args["batch-size"] ? Number(args["batch-size"]) : 0;

  // Step 1: Build URLs unless user provided a URL file
  if (!args["urls-file"]) {
    console.log("\n=== Step 1/4: Build URL list from sitemap ===");
    const buildArgs = ["--out", urlsFile];
    if (site) buildArgs.push("--site", site);
    if (args["sitemap-url"]) buildArgs.push("--sitemap-url", args["sitemap-url"]);
    if (args["include-path"]) buildArgs.push("--include-path", args["include-path"]);
    if (args["exclude-path"]) buildArgs.push("--exclude-path", args["exclude-path"]);
    if (args["include-sitemaps"]) buildArgs.push("--include-sitemaps", args["include-sitemaps"]);
    if (args["include-all-sitemaps"]) buildArgs.push("--include-all-sitemaps");
    if (batchSize > 0) buildArgs.push("--batch-size", String(batchSize));

    const build = runNodeScript(path.resolve("scripts/build-urls-from-sitemap.mjs"), buildArgs);
    if (build.status !== 0) {
      if (site) printBotNotice(site);
      process.exit(build.status || 1);
    }
  } else {
    console.log("\n=== Step 1/4: Using provided URL file ===");
    console.log(`Using URLs file: ${urlsFile}`);
  }


  if (batchSize > 0) {
    try {
      const raw = fs.readFileSync(urlsFile, "utf8");
      const urls = raw.split(/\r?\n/g).map((s) => s.trim()).filter(Boolean);
      if (urls.length > batchSize) {
        const trimmed = urls.slice(0, batchSize);
        fs.writeFileSync(urlsFile, trimmed.join("\n") + "\n", "utf8");
        console.log(`ℹ --batch-size enabled. Trimmed URL list from ${urls.length} to ${trimmed.length} URL(s) for this run.`);
      } else {
        console.log(`ℹ --batch-size enabled, but URL list already has ${urls.length} URL(s).`);
      }
    } catch (e) {
      console.warn(`WARNING: Could not apply --batch-size to ${urlsFile}: ${String(e?.message || e)}`);
    }
  }

  // Step 2: Run audit
  console.log("\n=== Step 2/4: Run accessibility audit (Playwright + axe-core) ===");
  const auditArgs = [
    "--urls-file", urlsFile,
    "--out-dir", baseOutDir,
    "--run-id", runId,
    "--sheet-id", sheetId,
    "--sheet-gid", sheetGid,
  ];
  if (site) auditArgs.push("--start", site);
  if (args["slow"]) auditArgs.push("--slow");
  if (args["respect-robots"]) auditArgs.push("--respect-robots");
  if (args["cloudflare-aware"]) auditArgs.push("--cloudflare-aware");
  if (args["retries"]) auditArgs.push("--retries", args["retries"]);
  if (args["backoff-ms"]) auditArgs.push("--backoff-ms", args["backoff-ms"]);
  if (args["crawl-delay-ms"]) auditArgs.push("--crawl-delay-ms", args["crawl-delay-ms"]);

  const audit = runNodeScript(path.resolve("scripts/a11y-audit.mjs"), auditArgs);
  if (audit.status !== 0) {
    if (site) printBotNotice(site);
    process.exit(audit.status || 1);
  }

  // Step 3: Generate docs-ready report
  console.log("\n=== Step 3/4: Generate Google Docs-ready report ===");
  const repArgs = ["--run-dir", outDir];
  if (site) repArgs.push("--site", site);
  runNodeScript(path.resolve("scripts/generate-google-doc-report.mjs"), repArgs);

  // Step 4: Generate ticket CSV
  console.log("\n=== Step 4/4: Generate GitHub ticket backlog CSV ===");
  if (!args["no-tickets"]) {
    runNodeScript(path.resolve("scripts/generate-ticket-csv.mjs"), ["--run-dir", outDir, "--sheet-id", sheetId, "--sheet-gid", sheetGid]);
  }

  console.log(`\nRun folder: ${outDir}`);
}

main();
