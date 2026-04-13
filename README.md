# Universal Accessibility Audit

**Package:** `@pbpyrojust/universal-accessibility-audit`  
**CLI commands:** `universal-a11y-audit`, `uaaudit`  
**Version:** 0.2.2

A CLI toolkit for accessibility audits with:

- sitemap discovery for WordPress, Yoast, Drupal, and standard sitemap.xml setups
- Playwright + axe-core scanning
- manual browser-saved sitemap XML fallback for protected sites
- CSV, JSON, markdown, and backlog/ticket-ready outputs
- image alt text inventory reporting

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


## Long-running scans, warnings, ETA, and heartbeat progress

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

### Large-scan warning
When the URL list is large, the tool prints a warning that the scan may take a while. This is especially useful for sitemap-driven sites with hundreds of pages.

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


## Output

Each run writes to a **site-name + timestamp folder** so reports are easy to identify later and never collide across different sites:

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

Convert browser-saved sitemap XML into `urls.txt`:

```bash
node scripts/convert-sitemap-xml-to-urls.mjs \
  --input ./saved-sitemap.xml \
  --out ./reports/<run-id>/urls.txt
```

---

## License

MIT
