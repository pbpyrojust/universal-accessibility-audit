#!/usr/bin/env node
/**
 * generate-google-doc-report.mjs
 *
 * Creates a paste-ready Google Docs summary report as Markdown from:
 *  - a11y-run-metadata.json
 *  - a11y-violations.csv
 *
 * Output:
 *  - a11y-summary-google-doc.md (in the run folder)
 */

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

function readCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/g).filter(Boolean);
  const header = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Very small CSV parser (handles quotes)
    const vals = [];
    let cur = "";
    let inQ = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"' && line[j + 1] === '"') {
        cur += '"';
        j++;
      } else if (ch === '"') {
        inQ = !inQ;
      } else if (ch === "," && !inQ) {
        vals.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    vals.push(cur);
    const obj = {};
    for (let k = 0; k < header.length; k++) obj[header[k]] = vals[k] ?? "";
    rows.push(obj);
  }
  return rows;
}

function topN(map, n) {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function main() {
  const args = parseArgs(process.argv);
  const runDir = args["run-dir"];
  const site = args.site || "";

  if (!runDir) {
    console.error("ERROR: Missing --run-dir path/to/reports/<runId>");
    process.exit(1);
  }

  const metaPath = path.join(runDir, "a11y-run-metadata.json");
  const csvPath = path.join(runDir, "a11y-violations.csv");

  if (!fs.existsSync(metaPath) || !fs.existsSync(csvPath)) {
    console.error("ERROR: Missing a11y-run-metadata.json or a11y-violations.csv in run directory.");
    process.exit(1);
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const rows = readCsv(csvPath).filter((r) => r.rule_id && r.rule_id !== "page_error");

  const byRule = new Map();
  const byImpact = new Map();
  const byPage = new Map();

  for (const r of rows) {
    byRule.set(r.rule_id, (byRule.get(r.rule_id) || 0) + 1);
    byImpact.set(r.impact || "unknown", (byImpact.get(r.impact || "unknown") || 0) + 1);
    byPage.set(r.page_url, (byPage.get(r.page_url) || 0) + 1);
  }

  const runId = meta.runId || path.basename(runDir);

  const lines = [];
  lines.push(`# Accessibility Audit Summary (WCAG 2.1 AA)`);
  lines.push("");
  lines.push(`**Site:** ${site || "(not provided)"}`);
  lines.push(`**Run ID:** ${runId}`);
  lines.push(`**Pages scanned:** ${meta.pagesScanned}`);
  lines.push(`**Violating elements (CSV rows):** ${meta.violationNodes}`);
  lines.push(`**Scan start:** ${meta.startedAt}`);
  lines.push(`**Scan finish:** ${meta.finishedAt}`);
  lines.push("");

  lines.push(`## Executive summary`);
  lines.push(`Automated testing (Playwright + axe-core) identified accessibility issues mapped to WCAG 2.1 A/AA criteria. This report summarizes the results and suggests a ticketing approach focused on high-impact global fixes first (contrast, viewport, ARIA).`);
  lines.push("");
  lines.push(`> Add your Google Sheets link here after importing the CSV: **[LINK]**`);
  lines.push("");

  // Severity
  lines.push(`## Findings by severity (axe impact)`);
  const impacts = ["critical", "serious", "moderate", "minor", "unknown"];
  for (const imp of impacts) {
    if (byImpact.has(imp)) lines.push(`- **${imp}**: ${byImpact.get(imp)}`);
  }
  lines.push("");

  // Top rules
  lines.push(`## Top issue types (by violating elements)`);
  for (const [rule, count] of topN(byRule, 10)) {
    lines.push(`- \`${rule}\`: ${count}`);
  }
  lines.push("");

  // Top pages
  lines.push(`## Pages with the most issues (top 10)`);
  for (const [p, c] of topN(byPage, 10)) {
    lines.push(`- ${p} — ${c}`);
  }
  lines.push("");

  // Ticketing guidance
  lines.push(`## Ticketing guidance (recommended approach)`);
  lines.push(`Create **global/component tickets** first for the top rule IDs. These typically fix many pages at once. After global fixes land, re-run the audit and create only truly page-specific follow-ups.`);
  lines.push("");
  lines.push(`### Suggested global tickets to create`);
  const suggested = ["color-contrast", "meta-viewport", "aria-prohibited-attr", "button-name", "link-name", "scrollable-region-focusable", "link-in-text-block", "image-alt"];
  for (const rule of suggested) {
    const count = byRule.get(rule) || 0;
    if (count) lines.push(`- \`${rule}\` (≈ ${count} violating elements)`);
  }
  lines.push("");

  lines.push(`## What automated scanning does NOT cover (manual testing required)`);
  lines.push(`Automated tools do not fully validate: keyboard-only usability, focus order edge cases, screen reader UX, meaning/quality of link text and alt text, form error handling, and media captions/transcripts. Plan a manual pass for these areas before declaring WCAG AA readiness.`);
  lines.push("");

  lines.push(`## How to format a GitHub Issue (copy/paste pattern)`);
  lines.push("```");
  lines.push("Title: [A11Y][WCAG] <Short issue name>");
  lines.push("Labels: accessibility, wcag, priority:P1, frontend, global");
  lines.push("");
  lines.push("Summary: <What’s broken + who it impacts>");
  lines.push("Audit evidence: rule_id + count + link to Google Sheet filtered view/search");
  lines.push("WCAG reference: <SC>");
  lines.push("Acceptance criteria: <bullet list>");
  lines.push("QA steps: <how to verify + re-run scan>");
  lines.push("```");
  lines.push("");

  const outPath = path.join(runDir, "a11y-summary-google-doc.md");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote: ${outPath}`);
}

main();
