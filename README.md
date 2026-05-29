# Universal Accessibility Audit

**Package:** `@pbpyrojust/universal-accessibility-audit`  
**CLI commands:** `universal-a11y-audit`, `uaaudit`  
**Version:** 0.2.7

A CLI toolkit for accessibility and browser-native AI readiness audits with:

- sitemap discovery for WordPress, Yoast, Drupal, and standard sitemap.xml setups
- Playwright + axe-core WCAG scanning
- Agentic Lighthouse-style scoring for browser-native AI readiness
- manual browser-saved sitemap XML fallback for protected sites
- CSV, JSON, Markdown, and backlog/ticket-ready outputs with importance and likely out-of-control flags
- image alt text inventory reporting
- WebMCP Protocol, Accessibility Trees, Semantic Data Formatting, and Layout Stability scoring

This repo works in two ways:

1. **Clone and run directly from source**
2. **Install and run as an npm CLI package**

---

## Clone and run from source

```bash
git clone https://github.com/pbpyrojust/universal-accessibility-audit.git
cd universal-accessibility-audit
npm install
npx playwright install --with-deps chromium
node scripts/run-audit.mjs --site https://www.example.com
```

---

## Install from npm

```bash
npm install -g @pbpyrojust/universal-accessibility-audit
npx playwright install --with-deps chromium
universal-a11y-audit audit --site https://www.example.com
```

You can also use the shorter alias:

```bash
uaaudit audit --site https://www.example.com
```

---


## Password-protected, staging, and development sites

The tool can also run against protected sites in two common ways:

### 1. HTTP / Basic Auth
For environments protected by browser-native username/password auth:

```bash
node scripts/run-audit.mjs \
  --site https://staging.example.com \
  --http-username your-user \
  --http-password your-pass
```

You can combine that with other flags:

```bash
node scripts/run-audit.mjs \
  --site https://staging.example.com \
  --http-username your-user \
  --http-password your-pass \
  --slow \
  --respect-robots \
  --cloudflare-aware
```

### 2. Form login via local auth config
For sites that require a login form, use a local auth config file:

```bash
node scripts/run-audit.mjs \
  --site https://staging.example.com \
  --auth-config ./auth.local.json
```

Example `auth.local.json`:

```json
{
  "loginUrl": "https://staging.example.com/login",
  "username": "your-username",
  "password": "your-password",
  "usernameSelector": "input[name='username']",
  "passwordSelector": "input[name='password']",
  "submitSelector": "button[type='submit']",
  "readySelector": "body",
  "postLoginWaitMs": 2000
}
```

You can also override parts of the config with flags:

- `--login-url`
- `--username`
- `--password`
- `--username-selector`
- `--password-selector`
- `--submit-selector`
- `--ready-selector`
- `--post-login-wait-ms`

### Environment variables
Instead of putting secrets directly on the command line, you can use environment variables:

```bash
export A11Y_HTTP_USERNAME=your-user
export A11Y_HTTP_PASSWORD=your-pass
```

or for form login:

```bash
export A11Y_LOGIN_USERNAME=your-user
export A11Y_LOGIN_PASSWORD=your-pass
```

### Important security note
Do **not** commit real auth config files, credentials, or environment files.  
The project now ignores local auth files such as:

- `*.auth.json`
- `auth.local.json`
- `.auth.local.json`
- `.a11y-auth.local.json`

Use the committed `auth-config.example.json` file only as a template.


## Requirements

- Node.js 20+ recommended for local use
- Chromium installed for Playwright scans

Install dependencies:

```bash
npm install
npx playwright install --with-deps chromium
```

If Playwright later reports a missing browser, run:

```bash
npx playwright install
```

---

## Quick start

### Standard site audit

```bash
node scripts/run-audit.mjs --site https://www.example.com
```

Installed CLI equivalent:

```bash
universal-a11y-audit audit --site https://www.example.com
```

### Protected-site conservative audit

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --slow \
  --respect-robots \
  --cloudflare-aware
```

### Small-batch protected-site audit

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --urls-file ./reports/manual-urls.txt \
  --slow \
  --respect-robots \
  --cloudflare-aware \
  --batch-size 10
```

---

## What a full audit runs

The `audit` workflow runs four steps:

1. Discover URLs from the sitemap, unless `--urls-file` is provided.
2. Scan pages with Playwright, axe-core, image-alt inventory, and Agentic Lighthouse scoring.
3. Generate a Google Docs-ready Markdown summary.
4. Generate a GitHub/backlog-ready ticket CSV, unless `--no-tickets` is used.

The scan is intentionally two-layered:

- **WCAG/axe layer**: finds accessibility violations and affected DOM nodes.
- **Agentic Lighthouse layer**: scores how well AI/browser agents can understand, call, and safely operate functional page surfaces.

---


## Importance and out-of-control flags

Violation output now includes an **importance** field in addition to impact/priority. This is intended to help triage what should be handled first in a ticketing or project-management system.

The scan also attempts to flag issues that are **likely out of direct control**, especially when they appear to be inside:

- iframes
- embedded media players
- third-party widgets
- externally hosted embeds

### New violation output fields

- `importance`
- `likely_out_of_control`
- `control_notes`

### New ticket/backlog fields

- `importance`
- `likely_out_of_control`
- `control_notes`
- `ticket_notes`

### Important note
The out-of-control detection is a **best-effort heuristic**. It is designed to surface likely iframe/embed issues for manual review, not to make a perfect ownership decision automatically.


## Agentic Lighthouse scoring

Each scan now includes an additional agent-readiness score modeled after Lighthouse-style category scoring. This score is separate from axe/WCAG violations and is designed to show how well browser-native AI agents and software test harnesses can understand and safely operate the site.

### Categories

- **WebMCP Protocol**: checks for WebMCP-style manifests, page-level registration signals, and named functional surfaces such as cart, checkout, search, filter, sort, login, and booking controls.
- **Accessibility Trees**: checks whether form controls and clickable components expose precise accessible names through labels, text, ARIA, titles, or placeholders.
- **Semantic Data Formatting**: checks machine-readable discovery files including `/llms.txt`, `/robots.txt`, `/sitemap.xml`, and `/.well-known/ai-plugin.json`.
- **Layout Stability**: checks observed cumulative layout shift and whether interactive controls move after page load.

### New agentic output files

- `agentic-lighthouse-scores.csv`
- `agentic-lighthouse-report.json`

The summary report includes overall and per-category averages, and the ticket backlog includes agent-readiness tickets for category scores below 90.


## Output

Each run writes to a **site-name + timestamp folder** so reports are easy to identify later:

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
    agentic-lighthouse-scores.csv
    agentic-lighthouse-report.json
  latest
```

### Output file reference

- `urls.txt`: URL list used for the run.
- `a11y-violations.csv`: one row per violating axe node, with impact, priority, importance, WCAG refs, ownership hints, and recommendations.
- `a11y-report.json`: full per-page JSON scan results, including axe results and Agentic Lighthouse page details.
- `a11y-run-metadata.json`: run timing, page counts, axe rollups, and agentic scoring rollups.
- `a11y-summary-google-doc.md`: paste-ready executive summary with WCAG findings and Agentic Lighthouse averages.
- `a11y-github-tickets.csv`: backlog-ready tickets for global accessibility issues, page-level accessibility issues, and low agentic category scores.
- `a11y-image-alts.csv`: image alt-text inventory with readability ratings and suggested review notes.
- `agentic-lighthouse-scores.csv`: per-page, per-category agent-readiness scores with findings, evidence, priority, importance, and recommendations.
- `agentic-lighthouse-report.json`: structured Agentic Lighthouse scoring details for every scored page.
- `latest`: text pointer containing the latest run ID.

### Agentic score thresholds

- `90-100`: pass
- `70-89`: needs review
- `0-69`: fail

Agentic tickets are generated for category scores below `90`.

---

## Public repo safety

This repo is intended to stay public.

Do **not** commit:

- `.npmrc` with real tokens
- npm access tokens
- GitHub personal access tokens
- `.env` files with secrets
- generated real-world reports under `reports/`
- saved sitemap XML files from client sites
- internal or staging URLs
- browser/session files

This repo already ignores the common risky files in `.gitignore`, but you should still review what is staged before pushing.

### Quick checks before pushing

```bash
git status
git ls-files
git grep -n "_authToken"
git grep -n "BEGIN PRIVATE KEY"
git grep -n "github_pat_"
git grep -n "ghp_"
```

---

## Publishing overview

This project is set up to:

1. stay a normal GitHub repo
2. publish as a public npm CLI package
3. optionally publish to GitHub Packages later
4. auto-publish from GitHub Actions on version tags

See **PUBLISHING.md** for the exact release steps.

---

## Commands reference

### Installed CLI commands

```bash
universal-a11y-audit help
universal-a11y-audit version
universal-a11y-audit audit --site https://www.example.com
universal-a11y-audit build-urls --site https://www.example.com --out ./reports/urls.txt
universal-a11y-audit scan --urls-file ./reports/urls.txt --out-dir ./reports
universal-a11y-audit report --run-dir ./reports/<run-id>
universal-a11y-audit tickets --run-dir ./reports/<run-id>
universal-a11y-audit sitemap-xml-to-urls --input ./saved-sitemap.xml --out ./reports/urls.txt
```

The shorter alias works the same way:

```bash
uaaudit audit --site https://www.example.com
```

### Source commands

Full audit:

```bash
node scripts/run-audit.mjs --site https://www.example.com
```

Full audit with explicit output folder:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --out-dir ./reports
```

Protected-site slow mode:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --slow \
  --respect-robots \
  --cloudflare-aware
```

Small-batch helper:

```bash
node scripts/run-audit.mjs \
  --site https://www.example.com \
  --urls-file ./reports/manual-urls.txt \
  --slow \
  --respect-robots \
  --cloudflare-aware \
  --batch-size 10
```

Build URLs only:

```bash
node scripts/build-urls-from-sitemap.mjs \
  --site https://www.example.com \
  --out ./reports/<run-id>/urls.txt
```

Scan an existing URL list:

```bash
node scripts/a11y-audit.mjs \
  --urls-file ./reports/<run-id>/urls.txt \
  --out-dir ./reports \
  --run-id <run-id>
```

Scan by crawling from a start URL:

```bash
node scripts/a11y-audit.mjs \
  --crawl \
  --start https://www.example.com \
  --max-pages 50 \
  --out-dir ./reports
```

Generate only the Markdown summary:

```bash
node scripts/generate-google-doc-report.mjs \
  --run-dir ./reports/<run-id> \
  --site https://www.example.com
```

Generate only the ticket/backlog CSV:

```bash
node scripts/generate-ticket-csv.mjs \
  --run-dir ./reports/<run-id>
```

Convert browser-saved sitemap XML into `urls.txt`:

```bash
node scripts/convert-sitemap-xml-to-urls.mjs \
  --input ./saved-sitemap.xml \
  --out ./reports/<run-id>/urls.txt
```

### Common options

- `--site`: site origin to discover and audit.
- `--sitemap-url`: explicit sitemap URL when auto-discovery is not enough.
- `--urls-file`: use an existing URL list instead of building one from a sitemap.
- `--out-dir`: base output folder, defaults to `reports`.
- `--run-id`: explicit run folder name.
- `--batch-size`: cap the number of URLs scanned in one run.
- `--slow`: use more conservative navigation timing and retries.
- `--respect-robots`: respect `robots.txt` disallow rules during URL filtering/crawling.
- `--cloudflare-aware`: detect likely Cloudflare/WAF challenge pages and back off.
- `--retries`: override navigation retry count.
- `--backoff-ms`: override retry backoff timing.
- `--crawl-delay-ms`: add delay between scanned pages.
- `--no-tickets`: skip ticket CSV generation in the full `audit` workflow.
- `--http-username` / `--http-password`: HTTP Basic Auth credentials.
- `--auth-config`: local form-login config file.

### npm scripts

```bash
npm run audit
npm run audit:crawl
npm run audit:urls
npm run audit:slow
npm run build:urls
npm run report
npm run sitemap:xml-to-urls
npm run pack:check
```

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

> Fix note: run folders now consistently use `site-name + timestamp`, for example `example.com-20260307-094546`.

---

## License

MIT
