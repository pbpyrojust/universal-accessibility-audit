# Universal Accessibility Audit (Playwright + axe-core)

**Created by:** Justin Adams — JustWhat.net — justin@justwhat.net
**Version:** 0.1.12

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
# If Playwright reports a missing browser later, run this again:
# npx playwright install
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

### Drupal XML sitemap notes
Some Drupal sites expose a top-level sitemap like `https://www.example.com/sitemap.xml` that points to paged child sitemaps such as:
- `https://www.example.com/sitemap.xml?page=1`
- `https://www.example.com/sitemap.xml?page=2`

This tool now recognizes that pattern when the top-level sitemap is accessible and will process the paged child sitemap URLs automatically.

If you pass a query-string sitemap URL manually in `zsh`, quote it so the shell does not treat `?` as a glob pattern:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --sitemap-url 'https://www.example.com/sitemap.xml?page=1'
```


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

## Bot protection, rate limits, and responsible scanning

Many sites use **Cloudflare** or other web application firewalls (WAF/bot protection). Repeated automated browser scans can trigger:
- Challenge pages ("Just a moment…", CAPTCHA, interstitial checks)
- Temporary blocks (403/429), throttling, or inconsistent results

This tool will attempt to **detect common bot challenge pages** and will tag them explicitly in the output as:
- `rule_id = bot_protection` (instead of producing misleading WCAG violations from a challenge page)

If a site exposes a sitemap in a normal browser but blocks scripted access to `robots.txt` or `sitemap.xml`, the URL builder may fail before the page scan begins. That usually indicates Cloudflare/WAF/rate limiting on non-interactive requests. In those cases, this tool will not bypass the protection.

### Conservative scanning options
Use these flags when scanning production sites, Cloudflare-protected properties, or whenever you want to be cautious:

- `--slow` — adds a delay between pages and enables retry/backoff defaults.
- `--respect-robots` — attempts to read `robots.txt` and *skips* disallowed URLs (best-effort).

Example:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --slow \
  --respect-robots
```

### Retry / backoff tuning
You can also override retry behavior:

- `--retries 2` — number of additional navigation retries (beyond the first attempt)
- `--backoff-ms 8000` — base backoff delay in milliseconds (exponential)
- `--crawl-delay-ms 1500` — delay between discovered pages during crawl mode

> If you see bot protection warnings in the terminal or `bot_protection` rows in the CSV, back off and try again later (or scan from a whitelisted IP / staging environment).

### Recommended fallback workflow for protected sites
1) Open the sitemap in a normal browser and export/copy the URLs you need.
2) Save them into a plain text file (one URL per line).
3) Run the audit with `--urls-file` to skip sitemap discovery entirely.

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --urls-file ./my-urls.txt \
  --slow \
  --respect-robots
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

Audit a prepared URLs list directly:
```bash
node scripts/a11y-audit.mjs --urls-file reports/<run-id>/urls.txt --out-dir reports
```

Run the full workflow with a prepared URL list (skip sitemap discovery):
```bash
node scripts/run-audit.mjs --site https://example.com --urls-file ./my-urls.txt --slow --respect-robots
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



### Safer mode for protected sites

For sites behind Cloudflare or similar WAF/bot protection, use:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --slow \
  --respect-robots \
  --cloudflare-aware
```

What these flags do:

- `--slow` adds pacing, conservative waits, and longer backoff between requests
- `--respect-robots` follows `robots.txt` guidance where applicable
- `--cloudflare-aware` detects common Cloudflare / challenge pages and retries with backoff instead of reporting misleading results

### Manual fallback for protected sitemap access

If a sitemap is visible in your normal browser but blocked to scripts or SEO crawlers, save the XML from your browser and convert it into `urls.txt`:

```bash
node scripts/convert-sitemap-xml-to-urls.mjs \
  --input ./saved-sitemap.xml \
  --out ./reports/manual/urls.txt

node scripts/run-audit.mjs \
  --site https://www.example.com \
  --urls-file ./reports/manual/urls.txt \
  --slow \
  --respect-robots \
  --cloudflare-aware
```

### Important
This project does **not** attempt to bypass bot protection. Challenge detection, retry, and backoff are intended to make scans safer and more accurate, not to defeat site protections.

## Manual fallback for protected sites: browser-saved sitemap XML

Some sites use Cloudflare, WAFs, or other bot protection that allows a human user to open sitemap files in a normal browser, but blocks scripted access from Node, Playwright, SEO crawlers, or API clients.

For those cases, this project includes a manual fallback helper:

```bash
node scripts/convert-sitemap-xml-to-urls.mjs \
  --input ./saved-sitemap.xml \
  --out ./reports/<run-id>/urls.txt
```

### Recommended workflow for protected sites
1. Open the sitemap in your normal browser.
2. Save the XML file locally.
3. Run the helper to convert that saved XML into a `urls.txt` file.
4. Run the audit against that file.

Example:

```bash
node scripts/convert-sitemap-xml-to-urls.mjs \
  --input ./saved-sitemap.xml \
  --out ./reports/manual/urls.txt

node scripts/run-audit.mjs \
  --site https://www.example.com \
  --urls-file ./reports/manual/urls.txt \
  --slow \
  --respect-robots
```

### Drupal XML sitemap note
Some Drupal sites publish a top-level sitemap index like:

- `https://www.example.com/sitemap.xml`
- nested sitemap pages such as:
  - `https://www.example.com/sitemap.xml?page=1`
  - `https://www.example.com/sitemap.xml?page=2`

If the top-level file is protected, you can:
1. open each sitemap page in a normal browser,
2. save the XML locally,
3. run `convert-sitemap-xml-to-urls.mjs` on each saved file,
4. combine or append the resulting `urls.txt` files.

### Optional filters
You can still filter what gets written to `urls.txt`:

```bash
node scripts/convert-sitemap-xml-to-urls.mjs \
  --input ./saved-sitemap.xml \
  --out ./reports/manual/urls.txt \
  --exclude-path "/tag/,/category/,/author/" \
  --include-path "/news/,/about/"
```

### Important note
If the saved XML file is a **sitemap index** (`<sitemapindex>`), this helper will extract the nested sitemap URLs it finds, but it will **not fetch them automatically**. That is intentional, so the workflow remains safe and compatible with protected sites.



## Protected sites, WAFs, Cloudflare, and conservative scanning

Some sites allow a human visitor to browse pages or open sitemap files, but block scripted requests, SEO crawlers, or repeated automated browser traffic. This commonly happens on sites protected by:

- Cloudflare
- Akamai
- Imperva
- custom WAF / rate limiting
- bot protection or CAPTCHA / “verify you are human” interstitials

This project **does not bypass** those protections. Instead, it provides safer handling so you can:

- back off and retry conservatively
- respect `robots.txt`
- use browser-saved sitemap XML as a fallback
- audit in small batches

### Important
These features are **optional** and are intended for hard-to-scan or partially protected sites.

They do **not** change the normal/default workflow for regular sites.

For normal sites, you can still run:

```bash
node scripts/run-audit.mjs --site https://www.example.com
```

Only when you add flags like `--slow`, `--respect-robots`, `--cloudflare-aware`, `--backoff-ms`, or `--crawl-delay-ms` do the conservative behaviors apply.

### Conservative / protected-site flags

- `--slow`  
  Enables slower navigation timing, longer waits, and safer retries.

- `--respect-robots`  
  Reads `robots.txt`, applies Disallow filtering when possible, and uses `Crawl-delay` if present.

- `--cloudflare-aware`  
  Detects common Cloudflare / bot-challenge pages and tags them as bot protection events instead of pretending they are normal page failures.

- `--backoff-ms <milliseconds>`  
  Sets the base retry backoff delay. Higher values are safer for protected sites.

- `--crawl-delay-ms <milliseconds>`  
  Forces an additional wait between page requests. Use this when you want to slow the audit down even more than the built-in defaults.

- `--retries <count>`  
  Sets how many retries are attempted for navigation failures or detected challenge pages.

### Recommended command for protected sites

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --slow \
  --respect-robots \
  --cloudflare-aware
```

### Slower / more conservative example

If the site still appears sensitive, increase both the crawl delay and the retry backoff:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --urls-file ./reports/example-urls-small.txt \
  --slow \
  --respect-robots \
  --cloudflare-aware \
  --crawl-delay-ms 10000 \
  --backoff-ms 15000 \
  --retries 3
```

That example waits longer between page requests and backs off more aggressively before retrying.

### Browser requirement for Playwright
If you see an error like:

```text
Executable doesn't exist ...
Please run: npx playwright install
```

install the browser binaries and try again:

```bash
npx playwright install
```

or, for a full install:

```bash
npx playwright install --with-deps chromium
```

### Recommended workflow for a protected Drupal / Cloudflare site

1. Try the normal conservative command first.
2. If sitemap access is blocked, save the sitemap XML in a normal browser.
3. Convert the saved XML into `urls.txt`.
4. Run the audit against a **small subset first**.
5. Increase batch size gradually only if the site stays stable.

#### Example: convert browser-saved sitemap XML to `urls.txt`

```bash
node scripts/convert-sitemap-xml-to-urls.mjs \
  --input ./saved-sitemap.xml \
  --out ./reports/manual-urls.txt
```

#### Example: test a small batch first

```bash
head -n 10 ./reports/manual-urls.txt > ./reports/manual-urls-small.txt

node scripts/run-audit.mjs \
  --site https://www.example.com \
  --urls-file ./reports/manual-urls-small.txt \
  --slow \
  --respect-robots \
  --cloudflare-aware \
  --crawl-delay-ms 10000 \
  --backoff-ms 15000 \
  --retries 3
```

### What to expect
For protected sites, the goal is not to “force” the scan through. The goal is to:

- reduce request pressure
- avoid misleading results
- identify bot protection explicitly
- find a workable batch size
- keep the workflow honest and reproducible

If a site still blocks the audit even in slow mode, use the browser-saved sitemap XML fallback and smaller page batches.



Protected-site slow mode:
```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --slow \
  --respect-robots \
  --cloudflare-aware
```

Protected-site slower mode with explicit delay tuning:
```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --urls-file ./reports/example-urls-small.txt \
  --slow \
  --respect-robots \
  --cloudflare-aware \
  --crawl-delay-ms 10000 \
  --backoff-ms 15000 \
  --retries 3
```

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


### When sitemap fetch fails but the sitemap works in your browser
That usually means the site is treating scripted requests differently from an interactive browser session. Common causes include:
- WAF / bot protection
- rate limiting
- geo/IP filtering
- challenge pages returned instead of XML

This toolkit does **not** bypass those protections. Recommended options:
- wait and try again later
- use `--slow --respect-robots` for conservative scanning
- pass `--sitemap-url` explicitly (quoted if it contains `?`)
- save the browser-visible sitemap URLs into a text file and run with `--urls-file`
- prefer a staging or whitelisted environment when available
