# Universal Accessibility Audit (Playwright + axe-core)

**Created by:** Justin Adams — JustWhat.net — justin@justwhat.net  
**Version:** 0.1.18

A universal, command-line accessibility audit tool that:

- Builds a scan URL list from a site's sitemap (Yoast / WordPress core / standard `sitemap.xml`)
- Supports a **manual browser-saved sitemap XML fallback** for protected sites
- Runs automated WCAG 2.1 A/AA checks via **axe-core** inside a real browser using **Playwright**
- Produces **ticket-ready artifacts**:
  - CSV of violating elements (one row per node)
  - JSON raw results
  - summary report formatted for Google Docs (Markdown)
  - **ticket/backlog CSV** (one row per recommended issue)
  - image alt text inventory report for SEO + accessibility review

This project is designed to support a real-world workflow:

**audit → ticket → fix → re-audit → verify**

---

## What this tool is for

This toolkit is intended for teams that need a repeatable, evidence-backed accessibility workflow across:

- WordPress sites
- Yoast sitemap setups
- Drupal sites
- static sites
- sitemap-driven marketing sites
- enterprise/public-sector/NGO sites with partial bot protection or WAF controls

It is especially useful when you need:

- **global vs page-level issue grouping**
- **ticket-ready outputs** for project-management systems or other work trackers
- **Google Sheets evidence links**
- **Google Docs–ready summaries**
- a way to work around **blocked sitemap discovery** using browser-saved XML

---

## Requirements

- **Node.js 20+** recommended
- npm (or pnpm / yarn)
- Playwright browser install (Chromium)

Install dependencies:

```bash
npm install
npx playwright install --with-deps chromium
```

If Playwright later reports that the browser executable is missing, run:

```bash
npx playwright install
```

---

## Quick start

### Standard site audit
For a normal site with a readable sitemap:

```bash
node scripts/run-audit.mjs --site https://www.example.com
```

This performs:

1. sitemap discovery / URL list build
2. Playwright + axe-core page scan
3. docs-ready summary generation
4. ticket/backlog generation

### Protected-site conservative audit
For sites that may be rate limited or behind Cloudflare / WAF protections:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --slow \
  --respect-robots \
  --cloudflare-aware
```

---

## Output

Each run writes to a **site-name + timestamp folder** so reports are never overwritten and are easier to identify later:

```text
reports/
  example.com-20260122-141010/
    urls.txt
    a11y-violations.csv
    a11y-report.json
    a11y-run-metadata.json
    a11y-summary-google-doc.md
    a11y-github-tickets.csv
    a11y-image-alts.csv
  latest
```

### Output files explained

- **`urls.txt`**  
  The URL list used for the run

- **`a11y-violations.csv`**  
  One row per violating node

- **`a11y-report.json`**  
  Raw per-page results

- **`a11y-run-metadata.json`**  
  Summary counts, top pages, rule totals, and run timing

- **`a11y-summary-google-doc.md`**  
  Docs-ready report content you can paste into Google Docs

- **`a11y-github-tickets.csv`**  
  One row per recommended ticket or work item

- **`a11y-image-alts.csv`**  
  Image alt text inventory with readability scoring and suggested improvements

---

## Progress logging

The audit prints progress while scanning:

```text
[12/221] Scanning: https://example.com/some-page
   ↳ Done in 3.4s | violation nodes: 18 | total: 214
```

For protected sites, you may also see warnings like:

```text
⚠ Bot protection detected (cloudflare, status 403). Backing off 15s then retrying...
```

---

## Sitemap discovery behavior

### Default discovery order
When you provide `--site https://example.com`, the URL builder attempts:

1. `robots.txt` sitemap hints
2. `/sitemap_index.xml`
3. `/sitemap.xml`

### WordPress + Yoast defaults
If a sitemap index exists, only **content sitemaps** are included by default.

This includes common generators such as:

- Yoast page sitemaps
- Yoast post sitemaps
- WordPress core `wp-sitemap-posts-*` sitemaps (pages, posts, and public post types)

This means the tool may report something like:

```text
Found 15 sitemaps in index; selected 8
```

That is expected behavior for many WordPress sites.

The first number is the **total number of sitemap files** in the index.  
The second number is the subset that the tool considers **user-facing content sitemaps** worth auditing by default.

Common non-content sitemap types are excluded:

- tag
- category
- author
- taxonomy
- media / image / attachment
- archive-like sitemap sources


If you want to include **everything** in the sitemap index — including taxonomy, archive, author, or other non-content sitemap sources — use:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --include-all-sitemaps
```

Use that only when you intentionally want a broader audit scope, since it may introduce duplicate-like archive pages, low-value URLs, and extra ticket noise.

### Drupal support
This project also supports Drupal sitemap patterns, including paged sitemap URLs such as:

```text
https://www.example.com/sitemap.xml?page=1
https://www.example.com/sitemap.xml?page=2
```

### Static sites
If the site exposes a standard `sitemap.xml` with a `urlset`, it can be scanned directly.

---

## Controlling what gets included or excluded

### Default exclusions
URLs containing the following are excluded by default:

- `/tag/`
- `/category/`
- `/author/`
- `/page/`
- `/wp-json/`
- query strings (`?`)
- `/feed`

### Override include / exclude rules

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --exclude-path "/tag/,/category/,/author/" \
  --include-path "/services/,/insights/"
```

### Choose which sitemap types to include

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --include-sitemaps "page,post"
```

### Use an explicit sitemap URL

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --sitemap-url 'https://www.example.com/sitemap.xml?page=1'
```

> If the sitemap URL contains `?`, quote it in your shell.

### Fallback crawl mode

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --fallback-crawl \
  --max-pages 75
```

---

## Google Sheets evidence links

This tool can generate **ready-to-click Google Sheets evidence links** inside the CSV outputs.

### Recommended workflow

1. Create a **blank Google Sheet**
2. Copy the full Sheet URL
3. Pass it to the audit with `--sheet-url`

Example:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --sheet-url "https://docs.google.com/spreadsheets/d/1abcDEF1234567890/edit?gid=0#gid=0"
```

The runner extracts:

- the **Sheet ID**
- the **gid** (worksheet/tab ID)

Then all evidence links in the output files are populated automatically.

### If you do not pass `--sheet-url`
If `--sheet-url` is omitted, outputs use a placeholder `SHEET_ID`.

You can later replace it manually inside Google Sheets if needed.

### Evidence link columns
CSV outputs may include helper columns such as:

- `rule_filter_url`
- `impact_filter_url`
- `page_filter_url`
- `rule_evidence_url`
- `page_evidence_url`

These are intended to make ticket creation easier.

> Limitation: CSV import cannot create Google Sheets saved filter views automatically.  
> These links are best-effort evidence jump links, not true prebuilt filter views.

---

## Ticketing / project-management workflow

### Ticket / project-management backlog CSV
Each run also generates:

- **`a11y-github-tickets.csv`**

This file is grouped into recommended issues:

- **Global tickets** for issues that affect many pages or shared components
- **Page tickets** for isolated, page-specific problems

### Recommended workflow
1. Run the audit
2. Import `a11y-violations.csv` into Google Sheets
3. Review `a11y-github-tickets.csv`
4. Create global/component tickets or work items first
5. Re-run after fixes
6. Only create net-new page tickets after the global fixes land

### Suggested issue format

```text
Title: [A11Y][WCAG] <Short issue name>
Labels: accessibility, wcag, priority:P1, frontend, global

Summary: <What’s broken + who it impacts>
Audit evidence: rule_id + count + link to Google Sheet evidence
WCAG reference: <SC>
Acceptance criteria: <bullet list>
QA steps: <how to verify + re-run scan>
```

---

## Image alt text report

Each run also generates:

- **`a11y-image-alts.csv`**

This report includes:

- `page_url`
- `image_url`
- `alt_present`
- `alt_text`
- `title_text`
- `locator`
- `readability_score`
- `readability_rating`
- `issues`
- `suggested_alt`

### Why this matters
Many websites, especially CMS-based sites, use weak alt text patterns such as:

- file names
- generic placeholders
- empty or missing alt text
- editor-generated defaults

This report helps identify both:
- accessibility issues
- weak SEO / content quality patterns

---

## Protected sites, WAFs, Cloudflare, and conservative scanning

Some sites allow a human visitor to browse pages or open sitemap files, but block scripted requests, SEO crawlers, or repeated automated browser traffic.

This commonly happens on sites protected by:

- Cloudflare
- Akamai
- Imperva
- custom WAF / rate limiting
- CAPTCHA / “verify you are human” interstitials
- bot protection applied to sitemap downloads or page requests

This project **does not bypass** those protections.

Instead, it provides safer handling so you can:

- back off and retry conservatively
- respect `robots.txt`
- use browser-saved sitemap XML as a fallback
- audit in small batches
- explicitly tag bot-protection events instead of pretending they are page-level accessibility issues

### Important
These features are **optional**.

They do **not** change the normal/default workflow for regular sites.

For a normal site, continue using:

```bash
node scripts/run-audit.mjs --site https://www.example.com
```

Only when you add flags such as:

- `--slow`
- `--respect-robots`
- `--cloudflare-aware`
- `--backoff-ms`
- `--crawl-delay-ms`
- `--retries`

do the conservative behaviors apply.

### Protected-site flags

- **`--slow`**  
  Enables slower navigation timing, longer waits, and safer retries.

- **`--respect-robots`**  
  Reads `robots.txt`, applies Disallow filtering when possible, and uses `Crawl-delay` if present.

- **`--cloudflare-aware`**  
  Detects common Cloudflare / challenge pages and tags them explicitly as bot protection events.

- **`--backoff-ms <milliseconds>`**  
  Sets the base retry backoff delay.

- **`--crawl-delay-ms <milliseconds>`**  
  Forces an additional wait between page requests.

- **`--retries <count>`**  
  Sets how many retries are attempted for navigation failures or challenge pages.

- **`--batch-size <count>`**  
  Trims the current URL list to the first N URLs for safer protected-site testing and small-batch runs.

### Recommended protected-site command

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --slow \
  --respect-robots \
  --cloudflare-aware
```

### Slower / more conservative example

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

That example:
- waits longer between page requests
- backs off more aggressively
- retries conservatively

### Important note on intent
These flags exist to make scans **safer and more honest**, not to defeat site protections.

---

## When sitemap discovery is blocked

Some sites allow humans to view the sitemap in a browser, but block automated tools from downloading it.

Typical output looks like:

```text
ERROR: Could not fetch sitemap (robots.txt, sitemap_index.xml, sitemap.xml).
NOTE: The site appears to use bot protection / WAF / Cloudflare-style challenges.
```

If that happens, use the fallback workflow below.

### Step 1 — open the sitemap in your browser

Examples:

```text
https://www.example.com/sitemap.xml
https://www.example.com/sitemap_index.xml
https://www.example.com/sitemap.xml?page=1
```

Save the XML file locally.

### Step 2 — convert saved XML to `urls.txt`

```bash
node scripts/convert-sitemap-xml-to-urls.mjs \
  --input ./saved-sitemap.xml \
  --out ./reports/manual-urls.txt
```

### Step 3 — test a small batch first

```bash
head -n 10 ./reports/manual-urls.txt > ./reports/manual-urls-small.txt
```

### Step 4 — run the audit from that file

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --urls-file ./reports/manual-urls-small.txt \
  --slow \
  --respect-robots \
  --cloudflare-aware
```

### Step 5 — go even slower if needed

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --urls-file ./reports/manual-urls-small.txt \
  --slow \
  --respect-robots \
  --cloudflare-aware \
  --crawl-delay-ms 10000 \
  --backoff-ms 20000 \
  --retries 2
```

### Real-world example: protected Drupal sitemap
Some Drupal sites publish:

```text
https://www.example.com/sitemap.xml?page=1
https://www.example.com/sitemap.xml?page=2
```

If those URLs are visible in a browser but blocked to scripts:

1. save each XML file in the browser
2. convert each to `urls.txt`
3. combine and dedupe them
4. run the audit from the combined file
5. start with a small subset

### Why this scenario matters
This is common on:

- Drupal sites with security modules
- public-sector / NGO websites
- enterprise CMS properties
- sites behind Cloudflare WAF
- environments where SEO crawlers also fail

The project is designed to handle this scenario honestly and predictably.

---



## Long-running scans, warnings, and progress indicators

Some scans can take a while, especially when:

- the site has **many pages**
- you are using `--slow`
- the site has **Cloudflare / WAF / bot protection**
- pages are very large or have many violations
- axe analysis takes longer on complex pages

To make this clearer, the tool prints startup advisories, ETA hints, and heartbeat lines.

### Startup advisories
At the start of a scan, the tool may print notices such as:

- large scan detected
- small-batch mode enabled
- slow/protected-site mode enabled
- crawl delay in use
- retry/backoff policy in use
- Cloudflare-aware detection enabled

These are informational and help set expectations before the scan begins.

### ETA and heartbeat lines
Each page starts with an ETA hint, for example:

```text
[3/25] Scanning: https://example.com/page | ETA remaining: 7.5m
```

If a navigation or analysis step takes a while, the tool also prints heartbeat lines such as:

```text
… still working on https://example.com/some-page (axe analysis) | elapsed 22.1s | ETA remaining: 6.3m
```

This means the process is still running and has **not stalled**.

### Important note
A page with many violations, lots of DOM nodes, or heavy client-side rendering may legitimately take longer to analyze. The heartbeat output is there to make long pages easier to trust.

### Protected-site note
When using:

- `--slow`
- `--respect-robots`
- `--cloudflare-aware`
- high `--crawl-delay-ms`
- high `--backoff-ms`
- multiple `--retries`

the scan may appear quiet for a while between retries or delays. That is expected.

### Small-batch helper
For protected or rate-limited sites, you can force the run to use only the first N URLs from the current URL list:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --urls-file ./reports/manual-urls.txt \
  --slow \
  --respect-robots \
  --cloudflare-aware \
  --batch-size 10
```

This is useful when you want to test stability before running a larger batch.


## Commands reference

Standard audit:

```bash
node scripts/run-audit.mjs --site https://www.example.com
```

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

Include all sitemap index entries (including non-content sitemap sources):

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --include-all-sitemaps
```

Build URLs only:

```bash
node scripts/build-urls-from-sitemap.mjs \
  --site https://www.example.com \
  --out ./reports/<run-id>/urls.txt
```

Audit a prepared URLs list:

```bash
node scripts/a11y-audit.mjs \
  --urls-file ./reports/<run-id>/urls.txt \
  --out-dir ./reports
```

Convert a browser-saved sitemap XML into `urls.txt`:

```bash
node scripts/convert-sitemap-xml-to-urls.mjs \
  --input ./saved-sitemap.xml \
  --out ./reports/<run-id>/urls.txt
```

Generate docs-ready report for a run:

```bash
node scripts/generate-google-doc-report.mjs \
  --run-dir ./reports/<run-id> \
  --site https://www.example.com
```

Skip ticket CSV generation:

```bash
node scripts/run-audit.mjs --site https://www.example.com --no-tickets
```

---

## What this tool does not cover

Automated scanning is not sufficient for full WCAG 2.1 AA compliance.

You must still manually test:

- keyboard-only navigation
- focus order and visible focus
- screen reader behavior (VoiceOver / NVDA / JAWS)
- form labels, errors, and input assistance
- link text meaning
- alt text meaning
- media captions / transcripts
- zoom/reflow at 200%
- overall usability and comprehension

---

## Known limitations

- Some sites block sitemap access even when it is visible to a human in a browser.
- Some sites allow sitemap access but block Playwright page navigation.
- Repeated scans may trigger rate limiting or WAF rules.
- Google Sheets links are helper links, not true saved filter views.
- Internationalized URLs may appear percent-encoded in some outputs unless decoded by your viewer.
- Extremely protected sites may require manual XML export plus very small batch sizes.

### Practical advice
If you encounter bot protection:

- wait before retrying
- reduce batch size
- increase `--crawl-delay-ms`
- increase `--backoff-ms`
- lower retry count if the site is aggressive
- use browser-saved sitemap XML fallback

---

## Automatic versioning

This project automatically bumps the **patch** version in `package.json` on every commit via Husky.

If you need to bump manually:

```bash
npm run version:bump
```

---

## License / disclaimer

This tool provides **automated** WCAG checks and is intended to help teams prioritize remediation. It does **not** guarantee legal compliance and does **not** bypass bot protection, WAF rules, or CAPTCHA systems.

This project is licensed under the **MIT License**.


Protected-site small-batch run:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --urls-file ./reports/manual-urls.txt \
  --slow \
  --respect-robots \
  --cloudflare-aware \
  --batch-size 10
```
