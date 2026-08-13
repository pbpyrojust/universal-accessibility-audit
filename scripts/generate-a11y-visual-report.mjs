#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.replace(/^--/, '');
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}
function parseCsv(csvText) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { if (!(row.length === 1 && row[0] === '')) rows.push(row); row = []; };
  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (inQuotes) {
      if (ch === '"') { if (csvText[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
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
  const headers = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, idx) => [h, r[idx] ?? ''])));
}
function esc(s) { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function loadCsv(runDir, name) {
  const p = path.join(runDir, name);
  return fs.existsSync(p) ? parseCsv(fs.readFileSync(p, 'utf8')) : [];
}
function loadJson(runDir, name) {
  const p = path.join(runDir, name);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function wcagLevel(refs) {
  if (!refs) return null;
  if (refs.includes('wcag2aaa')) return 'AAA';
  if (refs.includes('wcag2aa')) return 'AA';
  if (refs.includes('wcag2a')) return 'A';
  return null;
}
function impactColor(impact) {
  return { critical: '#dc2626', serious: '#ea580c', moderate: '#d97706', minor: '#65a30d' }[impact] || '#64748b';
}
function scoreColor(score) {
  const n = num(score);
  if (n >= 90) return '#16a34a';
  if (n >= 50) return '#d97706';
  return '#dc2626';
}

const args = parseArgs(process.argv);
if (!args['run-dir']) { console.error('ERROR: Missing --run-dir'); process.exit(1); }
const runDir = path.resolve(process.cwd(), args['run-dir']);
const site = args.site || 'the site';

let branding = {
  companyName: 'Universal Accessibility Audit',
  primaryColor: '#7c3aed',
  secondaryColor: '#111827',
  accentColor: '#22c55e',
  reportTitle: 'Accessibility & WCAG Compliance Audit',
  author: 'Universal Accessibility Audit',
  footerText: 'Confidential report'
};
if (args['brand-config']) {
  try { branding = { ...branding, ...JSON.parse(fs.readFileSync(path.resolve(process.cwd(), args['brand-config']), 'utf8')) }; }
  catch (e) { console.warn('Warning: failed to load brand config:', String(e?.message || e)); }
}

const runMeta = loadJson(runDir, 'a11y-run-metadata.json') || {};
const violations = loadCsv(runDir, 'a11y-violations.csv');
const tickets = loadCsv(runDir, 'a11y-github-tickets.csv');
const imageAlts = loadCsv(runDir, 'a11y-image-alts.csv');
const lighthouse = loadCsv(runDir, 'agentic-lighthouse-scores.csv');

const pagesScanned = num(runMeta.pagesScanned);
const violationNodes = num(runMeta.violationNodes);
const byImpact = runMeta.byImpact || {};
const byRule = runMeta.byRule || {};
const topPages = Array.isArray(runMeta.topPages) ? runMeta.topPages : [];
const agentic = runMeta.agenticLighthouse || {};
const categories = agentic.categories || {};

const pagesWithViolations = new Set(violations.map((v) => v.page_url)).size;
const cleanPages = Math.max(0, pagesScanned - pagesWithViolations);

const wcagCounts = { A: 0, AA: 0, AAA: 0 };
for (const v of violations) {
  const lvl = wcagLevel(v.wcag_refs);
  if (lvl) wcagCounts[lvl] += 1;
}

const topRules = Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 15);

const totalImages = imageAlts.length;
const missingAlt = imageAlts.filter((a) => a.alt_present === 'no').length;
const flaggedAlt = imageAlts.filter((a) => a.readability_rating && a.readability_rating !== 'Good').length;
const worstAlts = imageAlts
  .filter((a) => a.alt_present === 'no' || (a.issues && a.issues.trim()))
  .sort((a, b) => (a.alt_present === 'no' ? -1 : 1) - (b.alt_present === 'no' ? -1 : 1))
  .slice(0, 20);

const topFixes = tickets
  .slice()
  .sort((a, b) => num(b.violation_nodes) - num(a.violation_nodes))
  .slice(0, 15);

const lhByPage = new Map();
for (const r of lighthouse) {
  const key = r.page_url;
  if (!lhByPage.has(key)) lhByPage.set(key, { page_url: key, overall_score: r.overall_score });
  lhByPage.get(key)[r.category] = r.category_score;
}
const agenticRows = Array.from(lhByPage.values()).sort((a, b) => num(a.overall_score) - num(b.overall_score)).slice(0, 20);

const impactOrder = ['critical', 'serious', 'moderate', 'minor'];
const impactCardsHtml = impactOrder
  .filter((k) => byImpact[k] !== undefined)
  .map((k) => `<div class="card" style="padding:12px"><div class="sub" style="text-transform:capitalize">${esc(k)}</div><div class="metric" style="font-size:28px;color:${impactColor(k)}">${num(byImpact[k])}</div></div>`)
  .join('');

const wcagCardsHtml = ['A', 'AA', 'AAA']
  .map((lvl) => `<div class="card" style="padding:12px"><div class="sub">WCAG ${lvl}</div><div class="metric" style="font-size:28px">${wcagCounts[lvl]}</div></div>`)
  .join('');

const topRulesHtml = topRules.length
  ? topRules.map(([rule, count]) => `<tr><td>${esc(rule)}</td><td>${count}</td></tr>`).join('')
  : '<tr><td colspan="2">No violations found.</td></tr>';

const topPagesHtml = topPages.length
  ? topPages.slice(0, 20).map((p) => `<tr><td>${esc(p.url)}</td><td>${esc(p.count)}</td></tr>`).join('')
  : '<tr><td colspan="2">No page-level data found.</td></tr>';

const topFixesHtml = topFixes.length
  ? topFixes.map((t) => `<tr><td>${esc(t.ticket_title || t.rule_id)}</td><td><span style="color:${impactColor(t.impact)}">${esc(t.priority)}</span></td><td>${esc(t.pages_affected)}</td><td>${esc(t.violation_nodes)}</td><td>${esc(t.wcag_refs)}</td></tr>`).join('')
  : '<tr><td colspan="5">No ticket backlog data found. Run with tickets enabled to populate this section.</td></tr>';

const altTableHtml = worstAlts.length
  ? worstAlts.map((a) => `<tr><td>${esc(a.page_url)}</td><td>${esc(a.image_url)}</td><td>${a.alt_present === 'no' ? '<span style="color:#dc2626">missing</span>' : esc(a.alt_text)}</td><td>${esc(a.issues)}</td><td>${esc(a.suggested_alt)}</td></tr>`).join('')
  : '<tr><td colspan="5">No image alt-text issues found.</td></tr>';

const categoryLabels = {
  webmcp_protocol: 'WebMCP',
  accessibility_trees: 'A11y Tree',
  semantic_data_formatting: 'Semantic Data',
  layout_stability: 'Layout Stability'
};
const agenticCategoryCardsHtml = Object.entries(categories)
  .map(([key, v]) => `<div class="card" style="padding:12px"><div class="sub">${esc(categoryLabels[key] || key)}</div><div class="metric" style="font-size:28px;color:${scoreColor(v.averageScore)}">${esc(v.averageScore)}</div><div class="sub">${esc(v.failingPages)} page(s) failing</div></div>`)
  .join('');
const agenticRowsHtml = agenticRows.length
  ? agenticRows.map((r) => `<tr><td>${esc(r.page_url)}</td><td style="color:${scoreColor(r.overall_score)}">${esc(r.overall_score)}</td><td>${esc(r.webmcp_protocol)}</td><td>${esc(r.accessibility_trees)}</td><td>${esc(r.semantic_data_formatting)}</td><td>${esc(r.layout_stability)}</td></tr>`).join('')
  : '<tr><td colspan="6">No agentic readiness data found.</td></tr>';

const logoHtml = branding.logo ? `<img src="${esc(branding.logo)}" alt="${esc(branding.companyName)} logo" style="max-height:56px; max-width:220px; object-fit:contain; display:block; margin-bottom:12px;">` : '';

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(branding.reportTitle)}</title><style>:root{--primary:${branding.primaryColor};--secondary:${branding.secondaryColor};--accent:${branding.accentColor};--bg:#f8fafc;--panel:#ffffff;--muted:#64748b;--border:#cbd5e1}body{font-family:Inter,Arial,sans-serif;margin:0;background:var(--bg);color:var(--secondary)}.wrap{max-width:1180px;margin:0 auto;padding:32px}.header{background:linear-gradient(135deg,var(--primary),var(--secondary));color:white;padding:28px;border-radius:18px;box-shadow:0 10px 30px rgba(15,23,42,.18)}.header h1{margin:0 0 8px;font-size:32px;line-height:1.1}.header p{margin:4px 0 0;color:#ede9fe}.meta{margin-top:8px;font-size:13px;color:#e2e8f0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:24px 0}.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}.section{margin-top:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:20px;box-shadow:0 6px 20px rgba(15,23,42,.06)}.card h2{margin:0 0 12px;font-size:20px}.metric{font-size:34px;font-weight:700;color:var(--primary)}.sub{color:var(--muted);font-size:13px}.table{width:100%;border-collapse:collapse;margin-top:8px}.table th,.table td{border-bottom:1px solid var(--border);padding:10px;text-align:left;font-size:14px;vertical-align:top}.table th{background:#f8fafc}.badge{display:inline-block;background:#f8fafc;border:1px solid var(--border);border-radius:999px;padding:4px 8px;font-size:12px}.footer{margin-top:24px;color:var(--muted);font-size:12px;text-align:center}@media print{body{background:#fff}.wrap{max-width:none;padding:0}.header{box-shadow:none}.card{box-shadow:none;break-inside:avoid-page}.grid,.two{break-inside:avoid}}</style></head><body><div class="wrap">
<div class="header">${logoHtml}<h1>${esc(branding.reportTitle)}</h1><p>${esc(branding.companyName)}</p><div class="meta">Site: ${esc(site)} &middot; Run folder: ${esc(runDir)} &middot; Prepared by ${esc(branding.author || branding.companyName)}</div></div>
<div class="grid">
<div class="card"><div class="sub">Pages scanned</div><div class="metric">${pagesScanned}</div></div>
<div class="card"><div class="sub">Violation nodes</div><div class="metric">${violationNodes}</div></div>
<div class="card"><div class="sub">Pages with issues</div><div class="metric">${pagesWithViolations}</div></div>
<div class="card"><div class="sub">Clean pages</div><div class="metric" style="color:#16a34a">${cleanPages}</div></div>
${impactCardsHtml}
${wcagCardsHtml}
<div class="card"><div class="sub">Agentic readiness</div><div class="metric" style="color:${scoreColor(agentic.overallScore)}">${esc(agentic.overallScore ?? '—')}</div></div>
<div class="card"><div class="sub">Missing alt text</div><div class="metric" style="color:${missingAlt > 0 ? '#dc2626' : '#16a34a'}">${missingAlt}</div></div>
</div>
<div class="two section">
<div class="card"><h2>Executive Summary</h2><p>This report summarizes WCAG 2.1 conformance findings for ${esc(site)}, based on an automated axe-core scan across ${pagesScanned} page(s), plus image alt-text quality and agentic (AI-agent) readiness scoring.</p><p><strong>Immediate attention:</strong> critical and serious impact violations, missing/low-quality alt text, and any WCAG Level A failures &mdash; these carry the highest legal and usability risk.</p></div>
<div class="card"><h2>Top violation rules</h2><table class="table"><thead><tr><th>Rule</th><th>Occurrences</th></tr></thead><tbody>${topRulesHtml}</tbody></table></div>
</div>
<div class="section card"><h2>Top priority fixes</h2><table class="table"><thead><tr><th>Issue</th><th>Priority</th><th>Pages affected</th><th>Violation nodes</th><th>WCAG refs</th></tr></thead><tbody>${topFixesHtml}</tbody></table></div>
<div class="two section">
<div class="card"><h2>Most affected pages</h2><table class="table"><thead><tr><th>Page</th><th>Violation nodes</th></tr></thead><tbody>${topPagesHtml}</tbody></table></div>
<div class="card"><h2>Image alt-text quality</h2><div class="sub" style="margin-bottom:8px">${totalImages} image(s) scanned</div><div class="grid" style="grid-template-columns:repeat(2,1fr);margin:0 0 12px"><div class="card" style="padding:12px"><div class="sub">Missing alt (WCAG failure)</div><div class="metric" style="font-size:24px;color:#dc2626">${missingAlt}</div></div><div class="card" style="padding:12px"><div class="sub">Flagged for human review</div><div class="metric" style="font-size:24px;color:#d97706">${flaggedAlt}</div></div></div><table class="table"><thead><tr><th>Page</th><th>Image</th><th>Alt text</th><th>Issue</th><th>Suggested alt</th></tr></thead><tbody>${altTableHtml}</tbody></table></div>
</div>
<div class="section card"><h2>Agentic readiness</h2><div class="grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">${agenticCategoryCardsHtml}</div><table class="table"><thead><tr><th>Page</th><th>Overall</th><th>WebMCP</th><th>A11y Tree</th><th>Semantic Data</th><th>Layout Stability</th></tr></thead><tbody>${agenticRowsHtml}</tbody></table></div>
<div class="footer">${esc(branding.footerText || '')}</div>
</div></body></html>`;

const htmlPath = path.join(runDir, 'a11y-dashboard.html');
const pdfPath = path.join(runDir, 'a11y-dashboard.pdf');
fs.writeFileSync(htmlPath, html, 'utf8');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('file://' + htmlPath, { waitUntil: 'load' });
await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' } });
await browser.close();

console.log(`Wrote: ${htmlPath}`);
console.log(`Wrote: ${pdfPath}`);
