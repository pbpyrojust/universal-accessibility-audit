#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else { args[key] = next; i++; }
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
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => {
    if (row.length === 1 && row[0] === "") { row = []; return; }
    rows.push(row); row = [];
  };
  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { pushField(); continue; }
    if (ch === '\n') { pushField(); pushRow(); continue; }
    if (ch === '\r') { if (csvText[i + 1] === '\n') i++; pushField(); pushRow(); continue; }
    field += ch;
  }
  pushField(); pushRow();
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || "").trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] ?? ""; });
    return obj;
  });
}

function toCsv(items, columns) {
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  return [columns.join(","), ...items.map((item) => columns.map((c) => esc(item[c])).join(","))].join("\n") + "\n";
}

const priorityRank = { "P0-Critical": 0, "P1-High": 1, "P2-Medium": 2, "P3-Low": 3 };
const importanceRank = { "Highest": 0, "High": 1, "Medium": 2, "Low": 3 };

function titleFor(t) {
  if (t.ticket_type === "Global") return `[A11Y][${t.priority}] Fix ${t.rule_id} across site`;
  let pathPart = "";
  try {
    const u = new URL(t.page_url);
    pathPart = u.pathname && u.pathname !== "/" ? u.pathname : "/";
  } catch {
    pathPart = t.page_url;
  }
  return `[A11Y][${t.priority}] Fix ${t.rule_id} on ${pathPart}`;
}

function labelsFor(t) {
  const parts = ["accessibility", "wcag", `priority:${t.priority.toLowerCase()}`];
  if (t.ticket_type === "Global") parts.push("global");
  if (t.likely_out_of_control === "yes") parts.push("third-party-review");
  return parts.join(", ");
}

function descriptionFor(t) {
  const lines = [];
  lines.push(`Type: ${t.ticket_type}`);
  lines.push(`Priority: ${t.priority}`);
  lines.push(`Importance: ${t.importance}`);
  if (t.page_url) lines.push(`Primary page: ${t.page_url}`);
  if (t.pages_affected) lines.push(`Pages affected: ${t.pages_affected}`);
  if (t.violation_nodes) lines.push(`Violation nodes: ${t.violation_nodes}`);
  if (t.wcag_refs) lines.push(`WCAG refs: ${t.wcag_refs}`);
  if (t.example_pages) lines.push(`Example pages: ${t.example_pages}`);
  if (t.example_selectors) lines.push(`Example selectors: ${t.example_selectors}`);
  lines.push(`Likely out of our control: ${t.likely_out_of_control}`);
  if (t.control_notes) lines.push(`Control notes: ${t.control_notes}`);
  if (t.rule_evidence_url) lines.push(`Rule evidence: ${t.rule_evidence_url}`);
  if (t.page_evidence_url) lines.push(`Page evidence: ${t.page_evidence_url}`);
  if (t.priority_evidence_url) lines.push(`Priority evidence: ${t.priority_evidence_url}`);
  lines.push("");
  lines.push("Recommended action:");
  lines.push(t.ticket_notes);
  return lines.join("\n");
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
  let pagesScanned = 0;
  const metaPath = path.join(runDir, "a11y-run-metadata.json");
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      pagesScanned = Number(meta.pagesScanned || meta.pages || 0) || 0;
    } catch {}
  }

  const rows = parseCsv(fs.readFileSync(violationsPath, "utf8")).filter((r) => r.rule_id && r.rule_id !== "page_error");

  const rulePages = new Map(), ruleCounts = new Map(), rulePriority = new Map(), ruleImpact = new Map(), ruleImportance = new Map();
  const ruleWcag = new Map(), ruleSelectors = new Map(), ruleControl = new Map();
  const impactOrder = { critical: 0, serious: 1, moderate: 2, minor: 3, "": 4 };

  function bumpMap(map, key, subkey) {
    if (!map.has(key)) map.set(key, new Map());
    const sub = map.get(key);
    sub.set(subkey, (sub.get(subkey) || 0) + 1);
  }

  for (const r of rows) {
    const ruleId = r.rule_id;
    const pageUrl = r.page_url;
    if (!rulePages.has(ruleId)) rulePages.set(ruleId, new Set());
    if (pageUrl) rulePages.get(ruleId).add(pageUrl);
    ruleCounts.set(ruleId, (ruleCounts.get(ruleId) || 0) + 1);

    const currPri = rulePriority.get(ruleId);
    if (!currPri || (priorityRank[r.priority] ?? 99) < (priorityRank[currPri] ?? 99)) rulePriority.set(ruleId, r.priority);

    const currImp = ruleImpact.get(ruleId);
    if (!currImp || (impactOrder[r.impact] ?? 99) < (impactOrder[currImp] ?? 99)) ruleImpact.set(ruleId, r.impact);

    const currImportance = ruleImportance.get(ruleId);
    if (!currImportance || (importanceRank[r.importance] ?? 99) < (importanceRank[currImportance] ?? 99)) ruleImportance.set(ruleId, r.importance || "Medium");

    if (r.wcag_refs) bumpMap(ruleWcag, ruleId, r.wcag_refs);
    if (r.selector_target) bumpMap(ruleSelectors, ruleId, r.selector_target);
    if (r.likely_out_of_control === "yes") {
      const note = r.control_notes || "Likely embedded or third-party controlled content.";
      bumpMap(ruleControl, ruleId, note);
    }
  }

  const globalKeyed = new Map();
  const pageKeyed = new Map();

  for (const r of rows) {
    const ruleId = r.rule_id;
    const pagesAffected = (rulePages.get(ruleId) || new Set()).size;
    const isGlobal = pagesScanned > 0 && pagesAffected >= globalMinPages && (pagesAffected / pagesScanned) >= globalThreshold;
    if (isGlobal) {
      const key = `${ruleId}__${rulePriority.get(ruleId)}`;
      if (!globalKeyed.has(key)) {
        globalKeyed.set(key, {
          ticket_type: "Global",
          priority: rulePriority.get(ruleId) || r.priority,
          importance: ruleImportance.get(ruleId) || r.importance || "Medium",
          rule_id: ruleId,
          page_url: "",
          impact: ruleImpact.get(ruleId) || r.impact || "",
          wcag_refs: "",
          pages_affected: pagesAffected,
          violation_nodes: 0,
          example_pages: [],
          example_selectors: [],
          likely_out_of_control: ruleControl.has(ruleId) ? "yes" : "no",
          control_notes: "",
          rule_evidence_url: "",
          page_evidence_url: "",
          priority_evidence_url: "",
          ticket_description: "",
          ticket_title: "",
          ticket_labels: "",
          ticket_notes: ""
        });
      }
      const t = globalKeyed.get(key);
      t.violation_nodes += 1;
    } else {
      const key = `${r.page_url}__${ruleId}__${r.priority}`;
      if (!pageKeyed.has(key)) {
        pageKeyed.set(key, {
          ticket_type: "Page",
          priority: r.priority,
          importance: r.importance || "Medium",
          rule_id: ruleId,
          page_url: r.page_url,
          impact: r.impact || "",
          wcag_refs: r.wcag_refs || "",
          pages_affected: 1,
          violation_nodes: 0,
          example_pages: [r.page_url].filter(Boolean),
          example_selectors: [],
          likely_out_of_control: r.likely_out_of_control || "no",
          control_notes: r.control_notes || "",
          rule_evidence_url: "",
          page_evidence_url: "",
          priority_evidence_url: "",
          ticket_description: "",
          ticket_title: "",
          ticket_labels: "",
          ticket_notes: ""
        });
      }
      const t = pageKeyed.get(key);
      t.violation_nodes += 1;
      const sel = (r.selector_target || "").trim();
      if (sel && t.example_selectors.length < 3 && !t.example_selectors.includes(sel)) t.example_selectors.push(sel);
      if (r.likely_out_of_control === "yes") t.likely_out_of_control = "yes";
      if (r.control_notes && !t.control_notes) t.control_notes = r.control_notes;
    }
  }

  for (const t of globalKeyed.values()) {
    const wcMap = ruleWcag.get(t.rule_id);
    if (wcMap && wcMap.size) t.wcag_refs = Array.from(wcMap.entries()).sort((a,b)=>b[1]-a[1])[0][0];
    const pages = Array.from(rulePages.get(t.rule_id) || []).slice(0, 5);
    t.example_pages = pages;
    t.page_url = pages[0] || "";
    const selMap = ruleSelectors.get(t.rule_id);
    if (selMap && selMap.size) t.example_selectors = Array.from(selMap.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([s])=>s);
    const ctlMap = ruleControl.get(t.rule_id);
    if (ctlMap && ctlMap.size) t.control_notes = Array.from(ctlMap.entries()).sort((a,b)=>b[1]-a[1])[0][0];
    t.rule_evidence_url = sheetFilterUrl(sheetId, sheetGid, "rule_id", t.rule_id);
    t.priority_evidence_url = sheetFilterUrl(sheetId, sheetGid, "priority", t.priority);
    if (t.page_url) t.page_evidence_url = sheetFilterUrl(sheetId, sheetGid, "page_url", t.page_url);
    t.ticket_notes = t.likely_out_of_control === "yes"
      ? "Review ownership first. If the issue is inside an iframe or third-party embed, coordinate with the provider or document it as outside direct remediation control."
      : "Prioritize this issue based on importance and page coverage. Fix shared components first when the issue is global.";
    t.ticket_description = descriptionFor(t);
    t.ticket_title = titleFor(t);
    t.ticket_labels = labelsFor(t);
  }

  for (const t of pageKeyed.values()) {
    t.rule_evidence_url = sheetFilterUrl(sheetId, sheetGid, "rule_id", t.rule_id);
    t.page_evidence_url = sheetFilterUrl(sheetId, sheetGid, "page_url", t.page_url);
    t.ticket_notes = t.likely_out_of_control === "yes"
      ? "Review ownership first. If the issue is inside an iframe or third-party embed, coordinate with the provider or document it as outside direct remediation control."
      : "Prioritize based on importance and affected user impact. Fix directly in first-party markup if this page/component is in your control.";
    t.ticket_description = descriptionFor(t);
    t.ticket_title = titleFor(t);
    t.ticket_labels = labelsFor(t);
  }

  const allTickets = [...globalKeyed.values(), ...pageKeyed.values()].sort((a, b) => {
    if (a.ticket_type !== b.ticket_type) return a.ticket_type === "Global" ? -1 : 1;
    return (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
  });

  for (const t of allTickets) {
    t.example_pages = (t.example_pages || []).join(" | ");
    t.example_selectors = (t.example_selectors || []).join(" | ");
  }

  const outPath = path.join(runDir, "a11y-github-tickets.csv");
  const columns = [
    "ticket_type","priority","importance","rule_id","page_url","impact","wcag_refs","pages_affected","violation_nodes",
    "example_pages","example_selectors","likely_out_of_control","control_notes",
    "rule_evidence_url","page_evidence_url","priority_evidence_url",
    "ticket_description","ticket_title","ticket_labels","ticket_notes"
  ];
  fs.writeFileSync(outPath, toCsv(allTickets, columns), "utf8");
  console.log(`Wrote: ${outPath}`);
}

main();
