# Universal Accessibility Audit

**Package:** `@pbpyrojust/universal-accessibility-audit`
**CLI commands:** `universal-a11y-audit`, `uaaudit`
**Version:** 0.2.11

A CLI toolkit for WCAG accessibility audits and browser-native AI readiness scoring with sitemap discovery, Playwright + axe-core scanning, and ticket-ready outputs. Built for development, staging, protected, and production sites.

## Runtime expectations

Full-site accessibility audits can take a long time. This tool opens pages in Chromium, runs axe-core, inventories image alt text, gathers browser-agent readiness signals, and writes multiple report formats. A large sitemap, crawl-heavy site, bot protection, slow staging server, or high retry settings can turn a run into hours instead of minutes.

For a quick first pass, use `quick` or `--quick`. It scans only top-level URLs by default, applies lite timing limits, and caps the run at 25 pages unless you override `--batch-size`.

```bash
npm exec --package @pbpyrojust/universal-accessibility-audit -- universal-a11y-audit quick --site https://www.example.com
```

For exhaustive work, use `audit` and tune scope with `--batch-size`, `--include-path`, `--exclude-path`, `--top-level`, `--max-path-depth`, `--slow`, `--respect-robots`, and `--cloudflare-aware`.

## Features

- Sitemap-first URL discovery with WordPress, Yoast, Drupal, and standard sitemap.xml support
- Playwright + axe-core WCAG 2.1 Level AA scanning
- Agentic Lighthouse-style scoring for browser-native AI readiness
- Image alt text inventory with readability ratings
- Manual browser-saved sitemap XML fallback for protected sites
- CSV, JSON, Markdown, and backlog/ticket-ready outputs with importance and out-of-control flags
- WebMCP Protocol, Accessibility Trees, Semantic Data Formatting, and Layout Stability scoring
- Support for HTTP Basic Auth and form-login protected sites

## Requirements

- Node.js 20+
- pnpm (recommended) or npm
- Playwright Chromium

## Installation

```bash
pnpm install
pnpm exec playwright install --with-deps chromium
```

Or with npm:

```bash
npm install
npx playwright install --with-deps chromium
```

## Install from npm

```bash
npm install -g @pbpyrojust/universal-accessibility-audit
npx playwright install --with-deps chromium
```

Or run it without a global install:

```bash
npm exec --package @pbpyrojust/universal-accessibility-audit -- universal-a11y-audit quick --site https://www.example.com
```

## Use in project workflows

Install it as a project dev dependency when you want accessibility audits to run from npm scripts, CI jobs, preview deployments, or release checks:

```bash
npm install --save-dev @pbpyrojust/universal-accessibility-audit
npx playwright install chromium
```

Add scripts to your project's `package.json`:

```json
{
  "scripts": {
    "a11y:quick": "universal-a11y-audit quick --site https://www.example.com",
    "a11y:full": "universal-a11y-audit audit --site https://www.example.com --respect-robots --batch-size 100"
  }
}
```

Then run:

```bash
npm run a11y:quick
```

In automated builds, pass a URL that exists during the job: a staging URL, preview deployment URL, or a localhost server started earlier in the workflow. The package audits a running site; it does not infer a target URL from the project automatically.

### GitHub Actions example

```yaml
name: Accessibility Audit

on:
  pull_request:
  workflow_dispatch:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run a11y:quick
```

## Quick start

Run a fast top-level pass:

```bash
universal-a11y-audit quick --site https://www.example.com
```

Run a full audit:

```bash
node scripts/run-audit.mjs --site https://www.example.com
```

Or use the pnpm shortcut:

```bash
pnpm audit --site https://www.example.com
```

Or use the installed CLI:

```bash
universal-a11y-audit audit --site https://www.example.com
uaaudit audit --site https://www.example.com
```

## Main audit command

```bash
node scripts/run-audit.mjs --site <url> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--site <url>` | **(required)** Target website URL |
| `--sitemap-url <url>` | Use a specific sitemap URL when auto-discovery is not enough |
| `--urls-file <path>` | Provide a text file of URLs to audit (one per line) |
| `--out-dir <path>` | Base output folder (default: `reports`) |
| `--run-id <id>` | Explicit run folder name |
| `--batch-size <n>` | Cap the number of URLs scanned in one run |
| `--quick` | Fast first-pass preset: lite scan settings, top-level URLs, and a 25-page default cap |
| `--lite` | Representative scan preset with smaller crawl/page limits |
| `--top-level` | Keep only homepage and one-segment paths such as `/about` or `/contact` |
| `--max-path-depth <n>` | Keep only URLs with path depth `n` or shallower; `1` is top-level |
| `--slow` | Use more conservative navigation timing and retries |
| `--respect-robots` | Respect `robots.txt` disallow rules during URL filtering/crawling |
| `--cloudflare-aware` | Detect likely Cloudflare/WAF challenge pages and back off |
| `--retries <n>` | Override navigation retry count |
| `--backoff-ms <ms>` | Override retry backoff timing |
| `--crawl-delay-ms <ms>` | Add delay between scanned pages |
| `--no-tickets` | Skip ticket CSV generation in the full audit workflow |
| `--no-visual-report` | Skip HTML dashboard and PDF generation in the full audit workflow |
| `--brand-config <path>` | Path to a branding JSON config for the visual dashboard/PDF |
| `--sheet-url <url>` | Google Sheet URL for filter link generation |
| `--include-path <filter>` | Include only URLs matching this path filter |
| `--exclude-path <filter>` | Exclude URLs matching this path filter |
| `--include-sitemaps <filter>` | Comma-separated filters for sitemap index entries |
| `--include-all-sitemaps` | Include all sitemaps from the sitemap index |

### Examples

```bash
# Full sitemap-based audit
node scripts/run-audit.mjs --site https://www.example.com

# Fast package-style first pass
universal-a11y-audit quick --site https://www.example.com

# Top-level pages only, but keep the full reporting workflow
universal-a11y-audit audit --site https://www.example.com --top-level

# Protected-site conservative scan
node scripts/run-audit.mjs --site https://www.example.com --slow --respect-robots --cloudflare-aware

# Small-batch audit from a manual URL list
node scripts/run-audit.mjs --site https://www.example.com --urls-file ./reports/manual-urls.txt --batch-size 10

# Audit with HTTP Basic Auth
node scripts/run-audit.mjs --site https://staging.example.com --http-username myuser --http-password mypass

# Audit with form login
node scripts/run-audit.mjs --site https://staging.example.com --auth-config ./auth.local.json

# Explicit output folder
node scripts/run-audit.mjs --site https://www.example.com --out-dir ./reports
```

## Authentication for protected sites

For staging or password-protected sites, the tool supports two auth methods.

### HTTP / Basic Auth

| Flag | Description |
|------|-------------|
| `--http-username <user>` | HTTP Basic Auth username |
| `--http-password <pass>` | HTTP Basic Auth password |

```bash
node scripts/run-audit.mjs \
  --site https://staging.example.com \
  --http-username your-user \
  --http-password your-pass
```

### Form login via auth config

| Flag | Description |
|------|-------------|
| `--auth-config <path>` | Path to a local form-login config JSON file |
| `--login-url <url>` | Override the login URL |
| `--username <user>` | Override the username |
| `--password <pass>` | Override the password |
| `--username-selector <sel>` | Override the username input selector |
| `--password-selector <sel>` | Override the password input selector |
| `--submit-selector <sel>` | Override the submit button selector |
| `--ready-selector <sel>` | Override the post-login ready selector |
| `--post-login-wait-ms <ms>` | Override post-login wait time |

Create an auth config from `auth-config.example.json`:

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

### Environment variables

Instead of putting secrets on the command line:

```bash
export A11Y_HTTP_USERNAME=your-user
export A11Y_HTTP_PASSWORD=your-pass
```

Or for form login:

```bash
export A11Y_LOGIN_USERNAME=your-user
export A11Y_LOGIN_PASSWORD=your-pass
```

### Important security note

Do **not** commit real auth config files, credentials, or environment files.
The project ignores local auth files such as `*.auth.json`, `auth.local.json`, `.auth.local.json`, and `.a11y-auth.local.json`.

## Output files

Each audit run creates a timestamped folder under `reports/`:

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
    a11y-dashboard.html
    a11y-dashboard.pdf
  latest
```

| File | Description |
|------|-------------|
| `urls.txt` | URL list used for the run |
| `a11y-violations.csv` | One row per violating axe node with impact, priority, importance, WCAG refs, ownership hints |
| `a11y-report.json` | Full per-page JSON scan results including axe results and Agentic Lighthouse page details |
| `a11y-run-metadata.json` | Run timing, page counts, axe rollups, and agentic scoring rollups |
| `a11y-summary-google-doc.md` | Paste-ready executive summary with WCAG findings and Agentic Lighthouse averages |
| `a11y-github-tickets.csv` | Backlog-ready tickets for global issues, page-level issues, and low agentic scores |
| `a11y-image-alts.csv` | Image alt-text inventory with readability ratings and suggested review notes |
| `agentic-lighthouse-scores.csv` | Per-page, per-category agent-readiness scores with findings and recommendations |
| `agentic-lighthouse-report.json` | Structured Agentic Lighthouse scoring details for every scored page |
| `a11y-dashboard.html` | Branded, stakeholder-ready visual HTML dashboard |
| `a11y-dashboard.pdf` | PDF export of the same dashboard, ready to share or print |
| `latest` | Text pointer containing the latest run ID |

## Visual HTML dashboard & branded PDF report

Every audit run also generates a stakeholder-friendly visual report, similar in spirit to commercial SEO audit dashboards: a branded, single-page HTML dashboard plus a matching PDF export, both built from the same CSV/JSON data as the raw outputs above.

The dashboard includes:

- Headline metric cards: pages scanned, violation nodes, clean pages, impact severity (critical/serious/moderate/minor), WCAG A/AA/AAA breakdown, agentic readiness score, and missing alt text
- Executive summary and top violation rules
- Top priority fixes (pulled from the ticket backlog, ranked by violation volume)
- Most affected pages
- Image alt-text quality (missing alt vs. flagged-for-review, with a sample table)
- Agentic readiness breakdown by category and by page

Regenerate it any time from existing CSV/JSON data (useful after manual edits or with updated branding):

```bash
node scripts/generate-a11y-visual-report.mjs --run-dir reports/<run-folder> --site https://www.example.com
node scripts/generate-a11y-visual-report.mjs --run-dir reports/<run-folder> --site https://www.example.com --brand-config ./branding.json
```

### Branding

Copy `branding.example.json` to `branding.json` and customize it to white-label the dashboard for a client or stakeholder audience:

```json
{
  "companyName": "JustWhat.net",
  "logo": "./assets/logo.png",
  "primaryColor": "#7c3aed",
  "secondaryColor": "#111827",
  "accentColor": "#22c55e",
  "reportTitle": "Accessibility & WCAG Compliance Audit",
  "author": "Justin Adams",
  "footerText": "Confidential — Prepared by JustWhat.net"
}
```

Pass it with `--brand-config ./branding.json` on `audit` or `visual-report`. Use `--no-visual-report` on `audit` to skip HTML/PDF generation.

## What a full audit runs

The `audit` workflow runs five steps:

1. Discover URLs from the sitemap, unless `--urls-file` is provided.
2. Scan pages with Playwright, axe-core, image-alt inventory, and Agentic Lighthouse scoring.
3. Generate a Google Docs-ready Markdown summary.
4. Generate a GitHub/backlog-ready ticket CSV, unless `--no-tickets` is used.
5. Generate the branded HTML dashboard and PDF report, unless `--no-visual-report` is used.

The scan is intentionally two-layered:

- **WCAG/axe layer**: finds accessibility violations and affected DOM nodes.
- **Agentic Lighthouse layer**: scores how well AI/browser agents can understand, call, and safely operate functional page surfaces.

## Importance and out-of-control flags

Violation output includes an **importance** field in addition to impact/priority for triage in ticketing systems.

The scan also flags issues that are **likely out of direct control** when they appear inside iframes, embedded media players, third-party widgets, or externally hosted embeds.

### Violation output fields

- `importance`, `likely_out_of_control`, `control_notes`

### Ticket/backlog fields

- `importance`, `likely_out_of_control`, `control_notes`, `ticket_notes`

The out-of-control detection is a **best-effort heuristic** designed to surface likely iframe/embed issues for manual review.

## Agentic Lighthouse scoring

Each scan includes an agent-readiness score modeled after Lighthouse-style category scoring, separate from axe/WCAG violations.

### Categories

| Category | What it checks |
|----------|---------------|
| **WebMCP Protocol** | WebMCP-style manifests, page-level registration signals, named functional surfaces (cart, checkout, search, filter, sort, login, booking) |
| **Accessibility Trees** | Whether form controls and clickable components expose precise accessible names through labels, text, ARIA, titles, or placeholders |
| **Semantic Data Formatting** | Machine-readable discovery files: `/llms.txt`, `/robots.txt`, `/sitemap.xml`, `/.well-known/ai-plugin.json` |
| **Layout Stability** | Observed cumulative layout shift and whether interactive controls move after page load |

### Score thresholds

- `90–100`: pass
- `70–89`: needs review
- `0–69`: fail

Agentic tickets are generated for category scores below `90`.

## Additional scripts

### Build a URL list from a sitemap

Discover and export all URLs from a site's sitemap without running an audit:

```bash
node scripts/build-urls-from-sitemap.mjs --site https://www.example.com --out ./reports/urls.txt
```

### Scan an existing URL list

Run the Playwright + axe-core + agentic scan against a pre-built URL list:

```bash
node scripts/a11y-audit.mjs --urls-file ./reports/urls.txt --out-dir ./reports --run-id <run-id>
```

### Scan by crawling from a start URL

```bash
node scripts/a11y-audit.mjs --crawl --start https://www.example.com --out-dir ./reports
```

By default `--crawl` has no page limit — it keeps following same-origin links until it runs out of new pages to discover. On sites with large amounts of dynamically-generated content (per-user fundraiser pages, per-event pages, per-listing pages, etc.), this can explode into tens of thousands of unique URLs that all render from the same template and all fail/timeout the same way, making the crawl take hours. Use the crawl-limiting flags below to control this.

| Flag | Description |
|------|-------------|
| `--max-pages <n>` | Stop discovery once this many pages have been found |
| `--max-depth <n>` | Only follow links up to this many hops from the start URL |
| `--top-level` | Keep homepage and one-segment paths only |
| `--max-path-depth <n>` | Keep URLs with path depth `n` or shallower |
| `--max-per-pattern <n>` | Cap how many pages get crawled per URL "template" (see below) |
| `--nav-timeout-ms <ms>` | Per-page navigation timeout during crawling (default `60000`) |
| `--exclude-path <filter>` | Comma-separated substrings — skip any discovered URL containing one |
| `--include-path <filter>` | Comma-separated substrings — only follow URLs containing one |
| `--quick` | Fast top-level first-pass preset |
| `--lite` | Preset for a fast, representative scan (see below) |

`--max-per-pattern` groups URLs by "template": path segments that look like an id, hash, or per-record slug (e.g. numeric segments, long alphanumeric ids) are collapsed to `:id` before comparing. So `/participants/mypage/1178067/2026` and `/participants/mypage/1186529/2026` are treated as the same template, and only the first `<n>` pages found for that template are crawled — the rest are skipped instead of queued. This is usually the single biggest lever for taming crawls on sites with unlimited per-record pages.

```bash
# Cap total pages
node scripts/a11y-audit.mjs --crawl --start https://www.example.com --max-pages 50 --out-dir ./reports

# Skip an entire section of dynamically-generated pages
node scripts/a11y-audit.mjs --crawl --start https://www.example.com \
  --exclude-path "/participants/mypage/,/events/,/donors" --out-dir ./reports

# Only crawl 3 pages per URL template, 2 hops deep
node scripts/a11y-audit.mjs --crawl --start https://www.example.com \
  --max-depth 2 --max-per-pattern 3 --out-dir ./reports
```

#### Lite scan

`--lite` bundles sane defaults for a quick, representative audit instead of an exhaustive crawl: `--max-pages 40 --max-depth 2 --max-per-pattern 3 --nav-timeout-ms 20000` (any of these can still be overridden individually). It also works with `--urls-file` and with `run-audit.mjs` (as a page-count cap), since it just narrows what gets scanned rather than being crawl-only.

```bash
node scripts/a11y-audit.mjs --crawl --start https://www.example.com --lite --out-dir ./reports
node scripts/run-audit.mjs --site https://www.example.com --lite
```

#### Quick scan

`--quick` is the package-friendly first-pass preset. It uses lite scan settings, keeps top-level URLs only, and caps the default full workflow at 25 pages.

```bash
universal-a11y-audit quick --site https://www.example.com
universal-a11y-audit audit --site https://www.example.com --quick
universal-a11y-audit scan --crawl --start https://www.example.com --quick --out-dir ./reports
```

### Generate only the Markdown summary

```bash
node scripts/generate-google-doc-report.mjs --run-dir ./reports/<run-id> --site https://www.example.com
```

### Generate only the ticket/backlog CSV

```bash
node scripts/generate-ticket-csv.mjs --run-dir ./reports/<run-id>
```

### Regenerate the visual dashboard

```bash
node scripts/generate-a11y-visual-report.mjs --run-dir ./reports/<run-id> --site https://www.example.com
node scripts/generate-a11y-visual-report.mjs --run-dir ./reports/<run-id> --site https://www.example.com --brand-config ./branding.json
```

### Convert a saved sitemap XML to a URL list

Extract URLs from a locally saved sitemap XML file:

```bash
node scripts/convert-sitemap-xml-to-urls.mjs --input ./saved-sitemap.xml --out ./reports/urls.txt
```

## CLI commands reference

When installed globally via npm, all commands are available through the `universal-a11y-audit` or `uaaudit` CLI:

| Command | Description |
|---------|-------------|
| `audit --site <url>` | Full workflow: build URLs, scan, summary, ticket CSV, visual dashboard |
| `quick --site <url>` | Fast top-level first pass using lite limits |
| `build-urls --site <url> --out <path>` | Build a URL list from sitemap discovery |
| `scan --urls-file <path> --out-dir <path>` | Run Playwright + axe-core + agentic scan |
| `report --run-dir <path>` | Generate the docs-ready Markdown summary |
| `tickets --run-dir <path>` | Generate the GitHub/backlog ticket CSV |
| `visual-report --run-dir <path>` | Generate the branded HTML dashboard + PDF report |
| `sitemap-xml-to-urls --input <path> --out <path>` | Convert a saved sitemap XML into `urls.txt` |
| `help` | Show CLI help |
| `version` | Show package version |

```bash
universal-a11y-audit audit --site https://www.example.com
universal-a11y-audit quick --site https://www.example.com
universal-a11y-audit audit --site https://www.example.com --slow --respect-robots --cloudflare-aware
universal-a11y-audit audit --site https://www.example.com --brand-config ./branding.json
universal-a11y-audit build-urls --site https://www.example.com --out ./reports/urls.txt
universal-a11y-audit scan --urls-file ./reports/urls.txt --out-dir ./reports
universal-a11y-audit report --run-dir ./reports/<run-id>
universal-a11y-audit tickets --run-dir ./reports/<run-id>
universal-a11y-audit visual-report --run-dir ./reports/<run-id> --brand-config ./branding.json
universal-a11y-audit sitemap-xml-to-urls --input ./saved-sitemap.xml --out ./reports/urls.txt
```

## pnpm / npm scripts

| Script | Description |
|--------|-------------|
| `pnpm audit` | Full audit against example.com |
| `pnpm audit:quick` | Quick top-level first pass against example.com |
| `pnpm audit:crawl` | Crawl-based audit (max 50 pages) |
| `pnpm audit:urls` | Scan from a pre-built URL list |
| `pnpm audit:slow` | Full audit in slow/protected-site mode |
| `pnpm build:urls` | Build URLs from sitemap only |
| `pnpm report` | Generate summary from latest run |
| `pnpm report:visual` | Generate the HTML dashboard + PDF from latest run |
| `pnpm sitemap:xml-to-urls` | Convert saved sitemap XML to URL list |
| `pnpm pack:check` | Dry-run npm pack to verify package contents |

## Public repo safety

This repo is intended to stay public. Do **not** commit:

- `.npmrc` with real tokens
- npm or GitHub access tokens
- `.env` files with secrets
- generated real-world reports under `reports/`
- saved sitemap XML files from client sites
- internal or staging URLs
- browser/session files
- a real `branding.json` with a client's logo path, name, or footer text (use `branding.example.json` as the template)

### Quick checks before pushing

```bash
git status
git ls-files
git grep -n "_authToken"
git grep -n "BEGIN PRIVATE KEY"
git grep -n "github_pat_"
git grep -n "ghp_"
```

## Publishing

This project publishes as a public npm CLI package with optional GitHub Actions auto-publish on version tags. See **PUBLISHING.md** for the exact release steps.

## License

MIT
