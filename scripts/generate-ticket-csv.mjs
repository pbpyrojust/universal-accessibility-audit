#!/usr/bin/env node
/**
 * generate-ticket-csv.mjs
 *
 * Generates a "one row per ticket" CSV from a run folder:
 *  - Reads: a11y-violations.csv + a11y-run-metadata.json (if present)
 *  - Writes: a11y-github-tickets.csv
 *
 * Ticket grouping:
 *  - Global tickets: grouped by (rule_id, priority) when the issue spans many pages
 *  - Page tickets: grouped by (page_url, rule_id, priority)
 *
 * This is designed for project-management systems: you can bulk-create issues from rows.
 *
 * Usage:
 *  node scripts/generate-ticket-csv.mjs --run-dir reports/20260122-141010 --site https://example.com
 *  node scripts/generate-ticket-csv.mjs --run-dir reports/.. --sheet-id <ID> --sheet-gid 0
 *
 * Options:
 *  --global-threshold 0.15   (fraction of pages that must be affected for a rule to be considered "Global")
 *  --global-min-pages 10     (minimum pages threshold)
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

function sheetFilterUrl(sheetId, gid, column, value) {
  const safeId = sheetId || "SHEET_ID";
  const safeGid = gid || "0";
  const v = encodeURIComponent(String(value));
  return `https://docs.google.com/spreadsheets/d/${safeId}/edit#gid=${safeGid}&q=${column}%3A${v}`;
}

function parseCsv(csvText) {
  // RFC4180-ish parser that supports commas, quotes, and newlines inside quoted fields.
  // Returns an array of objects keyed by header names.
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };

  const pushRow = () => {
    // Skip completely empty rows
    if (row.length === 1 && row[0] === "") {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote
        if (csvText[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      pushField();
      continue;
    }

    if (ch === "\n") {
      pushField();
      pushRow();
      continue;
    }

    if (ch === "\r") {
      // Handle CRLF or lone CR
      if (csvText[i + 1] === "\n") i++;
      pushField();
      pushRow();
      continue;
    }

    field += ch;
  }

  // Flush last field/row
  pushField();
  pushRow();

  if (!rows.length) return [];

  const headers = rows[0].map((h) => String(h || "").trim());
  const data = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (!cols || !cols.length) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = cols[c] ?? "";
    }
    // Skip rows that don't have a rule_id (likely parser artifacts)
    data.push(obj);
  }
  return data;
}

function toCsv(rows, columns) {
  const esc = (v) => {
    const s = String(v ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
    if (/[",\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const lines = [];
  lines.push(columns.join(","));
  for (const r of rows) {
    lines.push(columns.map((c) => esc(r[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

function maxPriority(a, b) {
  const order = { "P0-Critical": 0, "P1-High": 1, "P2-Medium": 2, "P3-Low": 3 };
  return (order[a] ?? 99) <= (order[b] ?? 99) ? a : b;
}


function descriptionFor(t) {
  // Keep this single-line and paste-friendly for ticket / work items
  const parts = [];
  const scope = t.ticket_type === "Global" ? "Global/site-wide" : "Page-specific";
  parts.push(`${scope} accessibility issue detected by automated scan (Playwright + axe-core).`);
  if (t.wcag_refs) parts.push(`WCAG refs: ${t.wcag_refs}.`);
  if (t.pages_affected) parts.push(`Pages affected: ${t.pages_affected}.`);
  if (t.violation_nodes) parts.push(`Violating nodes: ${t.violation_nodes}.`);
  if (t.ticket_type === "Page" && t.page_url) parts.push(`Page: ${t.page_url}.`);
  // Evidence links
  if (t.rule_evidence_url) parts.push(`Rule evidence: ${t.rule_evidence_url}`);
  if (t.page_evidence_url) parts.push(`Page evidence: ${t.page_evidence_url}`);
  parts.push("Acceptance: resolve the underlying component/pattern, re-run audit, and confirm the rule no longer appears.");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function labelsFor({ ticket_type, priority }) {
  const base = ["accessibility", "wcag", "audit"];
  if (ticket_type === "Global") base.push("global");
  else base.push("page");
  base.push(`priority:${priority}`);
  return base.join(", ");
}

function titleFor({ ticket_type, rule_id, priority, page_url }) {
  if (ticket_type === "Global") {
    return `[A11Y][${priority}] Fix ${rule_id} across site`;
  }
  // page ticket: shorten URL path
  let pathPart = "";
  try {
    const u = new URL(page_url);
    pathPart = u.pathname && u.pathname !== "/" ? u.pathname : "/";
  } catch {
    pathPart = page_url;
  }
  return `[A11Y][${priority}] Fix ${rule_id} on ${pathPart}`;
}

function main() {
  const args = parseArgs(process.argv);
  const runDir = args["run-dir"];
  if (!runDir) {
    console.error("ERROR: Missing --run-dir <path to run folder>");
    process.exit(1);
  }

  const sheetId = args["sheet-id"] || "";
  const sheetGid = args["sheet-gid"] || "0";

  const globalThreshold = args["global-threshold"] ? Number(args["global-threshold"]) : 0.15;
  const globalMinPages = args["global-min-pages"] ? Number(args["global-min-pages"]) : 10;

  const violationsPath = path.join(runDir, "a11y-violations.csv");
  if (!fs.existsSync(violationsPath)) {
    console.error(`ERROR: Missing ${violationsPath}`);
    process.exit(1);
  }

  const metaPath = path.join(runDir, "a11y-run-metadata.json");
  let pagesScanned = 0;
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      pagesScanned = Number(meta.pagesScanned || meta.pages_scanned || meta.pages || 0) || 0;
    } catch {}
  }

  const rows = parseCsv(fs.readFileSync(violationsPath, "utf8"))
    .filter((r) => r.rule_id && r.rule_id !== "page_error");

  // Gather per-rule stats to decide global/page
  const rulePages = new Map(); // rule_id -> Set(page_url)
  const ruleCounts = new Map(); // rule_id -> count
  const rulePriority = new Map(); // rule_id -> worst priority
  const ruleImpact = new Map(); // rule_id -> max impact
  const ruleWcag = new Map(); // rule_id -> Map(wcag_refs -> count)
  const ruleSelectors = new Map(); // rule_id -> Map(selector -> count)

  const impactOrder = { critical: 0, serious: 1, moderate: 2, minor: 3 };

  for (const r of rows) {
    const rid = r.rule_id;
    const page = r.page_url;
    if (!rulePages.has(rid)) rulePages.set(rid, new Set());
    rulePages.get(rid).add(page);

    ruleCounts.set(rid, (ruleCounts.get(rid) || 0) + 1);
    rulePriority.set(rid, rulePriority.has(rid) ? maxPriority(rulePriority.get(rid), r.priority) : (r.priority || "P2-Medium"));

    // impact max (lowest order)
    const prev = ruleImpact.get(rid);
    const cur = (r.impact || "").toLowerCase();
    if (!prev) ruleImpact.set(rid, cur);
    else {
      const p = impactOrder[prev] ?? 99;
      const c = impactOrder[cur] ?? 99;
      if (c < p) ruleImpact.set(rid, cur);
    }

    const wc = (r.wcag_refs || "").trim();
    if (wc) {
      if (!ruleWcag.has(rid)) ruleWcag.set(rid, new Map());
      const m = ruleWcag.get(rid);
      m.set(wc, (m.get(wc) || 0) + 1);
    }

    const sel = (r.selector_target || "").trim();
    if (sel) {
      if (!ruleSelectors.has(rid)) ruleSelectors.set(rid, new Map());
      const m = ruleSelectors.get(rid);
      m.set(sel, (m.get(sel) || 0) + 1);
    }
  }

  const knownGlobalRules = new Set([
    "color-contrast",
    "meta-viewport",
    "aria-prohibited-attr",
    "button-name",
    "link-name",
    "link-in-text-block",
    "scrollable-region-focusable",
  ]);

  function isGlobalRule(ruleId) {
    if (knownGlobalRules.has(ruleId)) return true;
    const affected = rulePages.get(ruleId)?.size || 0;
    if (pagesScanned > 0) {
      if (affected >= Math.max(globalMinPages, Math.ceil(pagesScanned * globalThreshold))) return true;
    } else {
      // no meta: fall back to a fixed threshold
      if (affected >= globalMinPages) return true;
    }
    return false;
  }

  // Group into tickets
  const tickets = [];
  const globalKeyed = new Map();
  const pageKeyed = new Map();

  for (const r of rows) {
    const rid = r.rule_id;
    const priority = r.priority || "P2-Medium";
    const page = r.page_url;

    if (isGlobalRule(rid)) {
      const key = `${rid}::${priority}`;
      if (!globalKeyed.has(key)) {
        globalKeyed.set(key, {
          ticket_type: "Global",
          rule_id: rid,
          priority,
          impact: ruleImpact.get(rid) || "",
          wcag_refs: "",
          pages_affected: rulePages.get(rid)?.size || 0,
          violation_nodes: ruleCounts.get(rid) || 0,
          example_pages: [],
          example_selectors: [],
        });
      }
    } else {
      const key = `${page}::${rid}::${priority}`;
      if (!pageKeyed.has(key)) {
        pageKeyed.set(key, {
          ticket_type: "Page",
          page_url: page,
          rule_id: rid,
          priority,
          impact: (r.impact || "").toLowerCase(),
          wcag_refs: r.wcag_refs || "",
          pages_affected: 1,
          violation_nodes: 0,
          example_pages: [page],
          example_selectors: [],
        });
      }
      const t = pageKeyed.get(key);
      t.violation_nodes += 1;
      // Keep a few selectors
      const sel = (r.selector_target || "").trim();
      if (sel && t.example_selectors.length < 3 && !t.example_selectors.includes(sel)) t.example_selectors.push(sel);
    }
  }

  // Finalize global tickets: pick top pages + selectors + most common wcag ref
  for (const t of globalKeyed.values()) {
    // wcag refs: most common
    const wcMap = ruleWcag.get(t.rule_id);
    if (wcMap && wcMap.size) {
      const top = Array.from(wcMap.entries()).sort((a, b) => b[1] - a[1])[0][0];
      t.wcag_refs = top;
    }

    // example pages: pick 5
    const pages = Array.from(rulePages.get(t.rule_id) || []).slice(0, 5);
    t.example_pages = pages;
    // Representative page to make CSV easier to read/sort
    t.page_url = pages[0] || "";

    // example selectors: top 3
    const selMap = ruleSelectors.get(t.rule_id);
    if (selMap && selMap.size) {
      t.example_selectors = Array.from(selMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s]) => s);
    }

    // evidence links
    t.rule_evidence_url = sheetFilterUrl(sheetId, sheetGid, "rule_id", t.rule_id);
    t.priority_evidence_url = sheetFilterUrl(sheetId, sheetGid, "priority", t.priority);
    if (t.page_url) t.page_evidence_url = sheetFilterUrl(sheetId, sheetGid, "page_url", t.page_url);

    // github formatting
    t.ticket_description = descriptionFor(t);
    t.ticket_title = titleFor(t);
    t.ticket_labels = labelsFor(t);
  }

  for (const t of pageKeyed.values()) {
    t.rule_evidence_url = sheetFilterUrl(sheetId, sheetGid, "rule_id", t.rule_id);
    t.page_evidence_url = sheetFilterUrl(sheetId, sheetGid, "page_url", t.page_url);
    t.ticket_description = descriptionFor(t);
    t.ticket_title = titleFor(t);
    t.ticket_labels = labelsFor(t);
  }

  // Combine and sort: Global first, then Page; priority order
  const priorityRank = { "P0-Critical": 0, "P1-High": 1, "P2-Medium": 2, "P3-Low": 3 };
  const allTickets = [...globalKeyed.values(), ...pageKeyed.values()].sort((a, b) => {
    if (a.ticket_type !== b.ticket_type) return a.ticket_type === "Global" ? -1 : 1;
    return (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
  });

  // Add a few human-helpful columns
  for (const t of allTickets) {
    t.example_pages = (t.example_pages || []).join(" | ");
    t.example_selectors = (t.example_selectors || []).join(" | ");
  }

  const outPath = path.join(runDir, "a11y-github-tickets.csv");
  const columns = [
    "ticket_type",
    "priority",
    "rule_id",
    "page_url",
    "impact",
    "wcag_refs",
    "pages_affected",
    "violation_nodes",
    "example_pages",
    "example_selectors",
    "rule_evidence_url",
    "page_evidence_url",
    "priority_evidence_url",
    "ticket_description",
    "ticket_title",
    "ticket_labels",
  ];

  fs.writeFileSync(outPath, toCsv(allTickets, columns), "utf8");
  console.log(`Wrote: ${outPath}`);
}

main();
