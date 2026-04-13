# Universal Accessibility Audit

**Package:** `@pbpyrojust/universal-accessibility-audit`  
**CLI commands:** `universal-a11y-audit`, `uaaudit`  
**Version:** 0.2.1

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
