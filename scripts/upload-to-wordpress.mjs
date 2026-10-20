#!/usr/bin/env node
/**
 * Sends one audit run to the Universal Accessibility Audit WordPress plugin.
 *
 *   universal-a11y-audit upload --reports-dir reports [--run-dir <dir>]
 *     [--site <url>] [--mode full|quick] [--wcag 2.2] [--trigger manual]
 *
 * Reads UAA_REPORT_URL and UAA_REPORT_SECRET from the environment (the
 * values shown under Accessibility → Settings → Receiving results). In
 * GitHub Actions the run's log URL is added automatically.
 *
 * --dry-run prints what would be sent without sending (no URL/secret needed).
 *
 * No dependencies: Node 20+.
 */
import fs from "node:fs";
import path from "node:path";
import { wcagVersion } from "./request-options.mjs";

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
  }
  return out;
}

/** RFC 4180 CSV → array of objects keyed by the header row. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

function readCsv(dir, name) {
  const p = path.join(dir, name);
  return fs.existsSync(p) ? parseCsv(fs.readFileSync(p, "utf8").replace(/^﻿/, "")) : [];
}

function newestRunDir(reportsDir) {
  const latest = path.join(reportsDir, "latest");
  if (fs.existsSync(latest) && fs.statSync(latest).isFile()) {
    const id = fs.readFileSync(latest, "utf8").trim();
    if (id && fs.existsSync(path.join(reportsDir, id))) return path.join(reportsDir, id);
  }
  const dirs = fs.readdirSync(reportsDir)
    .map((d) => path.join(reportsDir, d))
    .filter((d) => fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, "a11y-run-metadata.json")))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0];
}

const opts = args(process.argv);
const url = process.env.UAA_REPORT_URL;
const secret = process.env.UAA_REPORT_SECRET;
if (!opts["dry-run"] && (!url || !secret)) {
  console.error("UAA_REPORT_URL and UAA_REPORT_SECRET must be set.");
  process.exit(1);
}
const runDir = opts["run-dir"] || newestRunDir(opts["reports-dir"] || "reports");
if (!runDir || !fs.existsSync(path.join(runDir, "a11y-run-metadata.json"))) {
  console.error(`No finished run found (looked in ${opts["run-dir"] || opts["reports-dir"] || "reports"}).`);
  process.exit(1);
}

const metadata = JSON.parse(fs.readFileSync(path.join(runDir, "a11y-run-metadata.json"), "utf8"));
const cut = (s, n) => (typeof s === "string" && s.length > n ? s.slice(0, n) + "…" : s);
const violations = readCsv(runDir, "a11y-violations.csv").map((v) => ({ ...v, html_snippet: cut(v.html_snippet, 2000), failure_summary: cut(v.failure_summary, 4000) }));
const tickets = readCsv(runDir, "a11y-github-tickets.csv");
const images = readCsv(runDir, "a11y-image-alts.csv");
const summaryPath = path.join(runDir, "a11y-summary-google-doc.md");
const gh = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "";

const body = {
  run_key: metadata.runId || path.basename(runDir),
  site: opts.site || "",
  mode: opts.mode || "",
  wcag: opts.wcag || metadata.wcagVersion || wcagVersion(),
  trigger: opts.trigger || (process.env.GITHUB_EVENT_NAME === "schedule" ? "schedule" : "manual"),
  github_run_url: gh,
  metadata,
  violations,
  tickets,
  images,
  summary_md: fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, "utf8") : "",
};

if (opts["dry-run"]) {
  console.log(`[dry run] ${body.run_key}: ${violations.length} issues, ${tickets.length} tickets, ${images.length} images, ${Math.round(JSON.stringify(body).length / 1024)} KB.`);
  process.exit(0);
}

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-uaa-secret": secret, "user-agent": "universal-accessibility-audit-upload" },
  body: JSON.stringify(body),
});
const text = await res.text();
let reply = null;
try { reply = JSON.parse(text); } catch { /* not JSON */ }
if (!res.ok || !reply || reply.success !== true) {
  // A 200 that isn't the plugin's JSON reply is usually a wrong address
  // (e.g. /wp-json/ on a site without pretty permalinks: use ?rest_route=).
  console.error(`WordPress didn't accept the run (HTTP ${res.status}): ${(reply && (reply.error || reply.message)) || text.slice(0, 300)}`);
  process.exit(1);
}
console.log(`Sent ${violations.length} issues, ${tickets.length} tickets, ${images.length} images from ${path.basename(runDir)}. Stored as run ${reply.runId}: ${reply.dashboard}`);
