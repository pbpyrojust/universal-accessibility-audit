#!/usr/bin/env node
/**
 * run-audit.mjs
 *
 * One-command runner:
 *  - Builds URL list from sitemap (Yoast/WP core/standard sitemap.xml)
 *  - Runs Playwright + axe audit with progress logging
 *  - Generates a Google-Docs-ready summary markdown file
 *
 * Examples:
 *  node scripts/run-audit.mjs --site https://www.example.com
 *  node scripts/run-audit.mjs --site https://example.com --exclude-path "/tag/,/category/,/author/" --include-sitemaps "page,post"
 *  node scripts/run-audit.mjs --site https://example.com --fallback-crawl --max-pages 75
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
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

function main() {
  const args = parseArgs(process.argv);

  const site = args.site;
  if (!site) {
    console.error("ERROR: Missing --site https://example.com");
    process.exit(1);
  }

  const outDir = args["out-dir"] || "reports";
  const runId = args["run-id"] || getRunIdFromNow();
  const runDir = path.resolve(process.cwd(), outDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  // Default URL list output lives inside the run folder (avoids leaving real site URLs in repo files)
  const urlsOut = args["urls-out"] || path.join(runDir, "urls.txt");

  // 1) Build URL list from sitemap
  const buildArgs = ["scripts/build-urls-from-sitemap.mjs", "--site", site, "--out", urlsOut];
  if (args["sitemap-url"]) buildArgs.push("--sitemap-url", args["sitemap-url"]);
  if (args["include-sitemaps"]) buildArgs.push("--include-sitemaps", args["include-sitemaps"]);
  if (args["exclude-sitemaps"]) buildArgs.push("--exclude-sitemaps", args["exclude-sitemaps"]);
  if (args["include-path"]) buildArgs.push("--include-path", args["include-path"]);
  if (args["exclude-path"]) buildArgs.push("--exclude-path", args["exclude-path"]);
  if (args["max-urls"]) buildArgs.push("--max-urls", args["max-urls"]);

  console.log("\n=== Step 1/4: Build URL list from sitemap ===\n");
  const build = spawnSync("node", buildArgs, { stdio: "inherit" });

  let useCrawl = false;
  if (build.status !== 0) {
    if (args["fallback-crawl"]) {
      console.warn("\nWARN: Sitemap build failed; falling back to crawl mode.\n");
      useCrawl = true;
    } else {
      process.exit(build.status ?? 1);
    }
  }

  // 2) Run audit
  console.log("\n=== Step 2/4: Run accessibility audit (Playwright + axe-core) ===\n");

  const auditArgs = ["scripts/a11y-audit.mjs", "--out-dir", outDir, "--run-id", runId];
  if (args["sheet-id"]) auditArgs.push("--sheet-id", args["sheet-id"]);
  if (args["sheet-gid"]) auditArgs.push("--sheet-gid", args["sheet-gid"]);

  if (useCrawl) {
    auditArgs.push("--crawl", "--start", site, "--max-pages", String(args["max-pages"] || 50));
  } else {
    auditArgs.push("--urls-file", urlsOut);
  }

  run("node", auditArgs);

  // 3) Generate docs-ready report for latest run
  console.log("\n=== Step 3/4: Generate docs-ready summary report ===\n");
  // Use run folder for this execution

  run("node", ["scripts/generate-google-doc-report.mjs", "--run-dir", runDir, "--site", site]);
  // 4) Generate ticket backlog CSV (one row per GitHub ticket)
  if (!args["no-tickets"]) {
    console.log("\n=== Step 4/4: Generate GitHub ticket backlog CSV ===\n");
    run("node", ["scripts/generate-ticket-csv.mjs", "--run-dir", runDir, "--site", site, ...(args["sheet-id"] ? ["--sheet-id", args["sheet-id"]] : []), ...(args["sheet-gid"] ? ["--sheet-gid", args["sheet-gid"]] : [])]);
  } else {
    console.log("\n=== Step 4/4: Skipped ticket backlog CSV (--no-tickets) ===\n");
  }

}

main();