# Universal Accessibility Audit (Playwright + axe-core)

**Created by:** Justin Adams — JustWhat.net — justin@justwhat.net
**Version:** 0.1.4

A universal, command-line accessibility audit tool that:
- Builds a scan URL list from a site's sitemap (Yoast/WP core/standard sitemap.xml)
- Runs automated WCAG 2.1 A/AA checks via **axe-core** inside a real browser using **Playwright**
- Produces **ticket-ready** artifacts:
  - CSV of violating elements (one row per node)
  - JSON raw results
  - Summary report formatted for Google Docs (Markdown)
  - **GitHub ticket backlog CSV** (one row per ticket)

---

## Requirements
- **Node.js 20+ (LTS recommended)** (tested with Node 20/22/24)
- npm (or pnpm/yarn)
- Playwright browser install (Chromium)

Install deps:
```bash
npm install
npx playwright install --with-deps chromium
```

---

## Quick start (one command)

### WordPress / Yoast (or any site with sitemap)
```bash
node scripts/run-audit.mjs --site https://www.example.com
```

This runs 3 steps:
1) Build URLs from sitemap -> `reports/<run-id>/urls.txt`
2) Scan URLs with Playwright + axe-core (with progress logging)
3) Generate docs-ready summary report

---

## Output

Each run writes to a **timestamped folder** so reports are never overwritten:

```
reports/
  20260122-141010/
    a11y-violations.csv
    a11y-report.json
    a11y-run-metadata.json
    a11y-summary-google-doc.md
  latest   (contains the latest runId)
```

---

## Progress logging

The audit prints progress as it scans:

```
[12/221] Scanning: https://example.com/some-page
   ↳ Done in 3.4s | violation nodes: 18 | total: 214 | elapsed: 0.8m
```

---

## Sitemap behavior (universal)

### What it tries by default
When you provide `--site https://example.com`, the URL builder will try:
1) `robots.txt` sitemap hints (`Sitemap: ...`)
2) `https://example.com/sitemap_index.xml`
3) `https://example.com/sitemap.xml`

### WordPress + Yoast defaults
If a sitemap index exists, we **select only content sitemaps** by default:
- includes: page + post sitemaps (Yoast + WP core patterns)
- excludes: taxonomy/tag/category/author/archive/media/attachment sitemaps

### Static sites
If the site has a standard `sitemap.xml` (urlset), we scan it directly.

---

## Controlling what gets included/excluded

### Exclude common WP archive pages (default)
By default, URLs containing these segments are excluded:
- `/tag/`, `/category/`, `/author/`, `/page/`, `/wp-json/`, query strings `?`, and `/feed`

### Override / customize
You can override by passing your own matchers:

```bash
node scripts/run-audit.mjs \
  --site https://example.com \
  --exclude-path "/tag/,/category/,/author/,/page/" \
  --include-path "/insights/,/services/"
```

### Choose which sitemaps to include (when index exists)
```bash
node scripts/run-audit.mjs \
  --site https://example.com \
  --include-sitemaps "page,post"
```

### Explicit sitemap URL
```bash
node scripts/run-audit.mjs --sitemap-url https://example.com/sitemap.xml --site https://example.com
```

### Fallback to crawl
If sitemap discovery fails, you can opt into crawl mode:
```bash
node scripts/run-audit.mjs --site https://example.com --fallback-crawl --max-pages 75
```

---

## Google Sheets evidence links (recommended workflow)

This toolkit can generate ready-to-click **Google Sheets evidence links** inside the CSV outputs (for quick “jump to evidence” when creating tickets).

### Recommended process (no manual find/replace)

1) Create a **blank Google Sheet** (any name is fine).
2) Copy the full Sheet URL from your browser. It looks like:

   `https://docs.google.com/spreadsheets/d/1abcDEF_exampleSheetId/edit?gid=0#gid=0`

3) Run the audit and pass the Sheet URL:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --sheet-url "https://docs.google.com/spreadsheets/d/1abcDEF_exampleSheetId/edit?gid=0#gid=0"
```

The runner will automatically extract:
- the **Sheet ID** (the long string between `/d/` and `/edit`)
- the **gid** (the tab id, typically `0` for a new sheet)

All evidence links will be fully populated in:
- `a11y-violations.csv`
- `a11y-github-tickets.csv`
- `a11y-summary-google-doc.md`

### Import step

After the run:
1) Import `a11y-violations.csv` into your Google Sheet (File → Import).
2) Use evidence links from `a11y-github-tickets.csv` inside your GitHub Issues.

### If you do NOT pass --sheet-url

If `--sheet-url` is omitted, evidence URLs will contain a placeholder `SHEET_ID`.
You can either:
- re-run with `--sheet-url`, **or**
- replace `SHEET_ID` with your spreadsheet ID using Find & Replace after import.

> Limitation: CSV import cannot auto-create Google Sheets *filter views*. The evidence links are designed to be low-effort jump links for browsing evidence by rule / impact / page.

---



## Image alt text inventory report (SEO + accessibility)

Each run also generates:

- `a11y-image-alts.csv` — an inventory of images found during the scan, including:
  - the page the image appears on
  - the resolved image URL
  - the current alt text (or whether it is missing/empty)
  - a simple readability score + rating
  - suggested improvements (especially useful when alt text is a filename)

Notes:
- Empty alt text (`alt=""`) can be valid for decorative images, but should be reviewed.
- Automated suggestions cannot know intent; use this report to prioritize improvements quickly.

## Ticketing workflow (GitHub Projects)

Recommended workflow:
1) Create **global/component tickets** first (contrast, viewport, ARIA).
2) Re-run audit after fixes.
3) Close resolved issues and only create net-new page-level tickets.

### Suggested issue format (copy/paste)
```
Title: [A11Y][WCAG] <Short issue name>
Labels: accessibility, wcag, priority:P1, frontend, global

Summary: <What’s broken + who it impacts>
Audit evidence: rule_id + count + link to Google Sheet evidence
WCAG reference: <SC>
Acceptance criteria: <bullet list>
QA steps: <how to verify + re-run scan>
```

---

## What this tool does NOT cover (manual testing required)

Automated scanning is not sufficient for full WCAG AA compliance. You must manually test:
- Keyboard-only navigation (focus order, traps, visible focus everywhere)
- Screen reader UX (NVDA/JAWS/VoiceOver)
- Meaningfulness of alt text and link text
- Form error messaging and instructions
- Media captions/transcripts
- Usability at 200% zoom / reflow behavior

---

## Commands reference

Build URLs only:
```bash
node scripts/build-urls-from-sitemap.mjs --site https://example.com --out reports/<run-id>/urls.txt
```

Audit a prepared URLs list:
```bash
node scripts/a11y-audit.mjs --urls-file reports/<run-id>/urls.txt --out-dir reports
```

Crawl mode:
```bash
node scripts/a11y-audit.mjs --crawl --start https://example.com --max-pages 50 --out-dir reports
```

Generate docs-ready report for a run:
```bash
node scripts/generate-google-doc-report.mjs --run-dir reports/<runId> --site https://example.com
```

---

## License / disclaimer
This tool provides **automated** WCAG checks and is intended to help teams prioritize remediation. It does not constitute a legal compliance guarantee.



---

## Ticket backlog CSV (one row per GitHub Issue)

Each run also generates:

- `a11y-github-tickets.csv` — **one row per recommended GitHub Issue**, grouped by:
  - **Global**: `(rule_id, priority)` when a rule impacts many pages (or is a known global rule)
  - **Page**: `(page_url, rule_id, priority)` for isolated page-level issues

This is designed for dropping into a GitHub Project "Issues" column quickly.

### How to use it
1) Import `a11y-violations.csv` into Google Sheets (optional but recommended for evidence browsing)
2) Import `a11y-github-tickets.csv` into Google Sheets **or** open it locally
3) Create GitHub Issues using each row:
   - `github_title`
   - `github_labels`
   - Use `rule_evidence_url` / `page_evidence_url` links as supporting evidence

### Google Sheets ID replacement
Evidence links in both CSVs are generated using either:
- `--sheet-url "<YOUR_GOOGLE_SHEET_URL>"` (recommended), **or**
- `--sheet-id <YOUR_SHEET_ID>` and optional `--sheet-gid <gid>`, **or**
- a placeholder `SHEET_ID` (default)

If you used the placeholder:
- After importing into Google Sheets, run a **Find & Replace** in the sheet:
  - Find: `SHEET_ID`
  - Replace with: your real spreadsheet ID (from the URL)

### Skip ticket CSV generation
If you only want the raw scan outputs:

```bash
node scripts/run-audit.mjs --site https://example.com --no-tickets
```

---

## Limitations & required manual testing (summary)

Automated tests do **not** guarantee WCAG 2.1 AA compliance. You still must manually verify:
- Keyboard-only navigation (focus order, traps, visible focus)
- Screen reader behavior (VoiceOver/NVDA)
- Form labels, errors, and input assistance
- Meaningfulness of alt text and link text
- Captions/transcripts for media
- Zoom/reflow at 200% (mobile and desktop)


## Automatic versioning

This project automatically bumps the **patch** version in `package.json` on every commit via a Git hook (Husky).

- After `npm install`, Husky installs a `pre-commit` hook.
- On each commit, the hook runs `node scripts/bump-version.mjs`, stages `package.json`, and proceeds with the commit.

If you need to bump manually:

```bash
npm run version:bump
```

> Note: Git hooks run locally. In CI, your version will already be baked into the commit.
