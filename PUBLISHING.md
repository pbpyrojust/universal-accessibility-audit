# Publishing Guide

This repo is configured so you can:

1. keep it as a normal public GitHub repo
2. publish it as a public npm CLI package
3. optionally publish it to GitHub Packages later
4. automate npm publishing from GitHub Actions on version tags

## Package details

- **npm package:** `@pbpyrojust/universal-accessibility-audit`
- **CLI commands:** `universal-a11y-audit`, `uaaudit`
- **Current version:** `0.2.1`

---

## Before you publish

### 1) Confirm the public repo
Your repository should be:

```text
https://github.com/pbpyrojust/universal-accessibility-audit
```

### 2) Verify package metadata
Make sure these fields are correct in `package.json`:

- `name`
- `version`
- `description`
- `repository`
- `homepage`
- `bugs`
- `license`

### 3) Install dependencies
```bash
npm install
npx playwright install --with-deps chromium
```

### 4) Run a package check
```bash
npm pack --dry-run
```

That lets you verify exactly what will be published.

### 5) Make sure no secrets are present
Do **not** publish:

- `.npmrc` with a real token
- `.env` files
- generated reports
- client sitemap XML exports
- internal/staging URLs

---

## First publish to npmjs.org

Log in locally:

```bash
npm login
```

Then publish the package manually once:

```bash
npm publish --access public
```

Because this is a **scoped public package**, `--access public` is required for the first public publish.

---

## Set up automatic npm publishing from GitHub Actions

This repo includes a workflow that publishes to npmjs.org on tags like:

```text
v0.2.1
```

### Recommended: npm trusted publishing
After the first manual publish, configure **Trusted Publisher** for this package on npmjs.com so GitHub Actions can publish without a long-lived npm token.

On npm package settings:
1. open the package page
2. go to package settings
3. add a **Trusted Publisher**
4. choose **GitHub Actions**
5. connect the repository:
   - `pbpyrojust/universal-accessibility-audit`

After that, future publishes can happen from GitHub Actions on version tags.

---

## Release flow for npmjs.org

### 1) Bump the version
Edit `package.json` or use your own version bump flow.

### 2) Commit and push main
```bash
git add .
git commit -m "Prepare v0.2.1 release"
git push origin main
```

### 3) Push a version tag
Use the version from `package.json`:

```bash
git tag v0.2.1
git push origin v0.2.1
```

The npm publish workflow will run automatically.

---

## Optional: publish to GitHub Packages later

This repo also includes a GitHub Packages workflow.

### GitHub Packages registry
```text
https://npm.pkg.github.com
```

### Trigger it with a tag
```bash
git tag ghpkg-v0.2.1
git push origin ghpkg-v0.2.1
```

Or run it manually from GitHub Actions if you prefer.

---

## Install commands users will use

### From npmjs.org
```bash
npm install -g @pbpyrojust/universal-accessibility-audit
npx playwright install --with-deps chromium
universal-a11y-audit audit --site https://www.example.com
```

### From source
```bash
git clone https://github.com/pbpyrojust/universal-accessibility-audit.git
cd universal-accessibility-audit
npm install
npx playwright install --with-deps chromium
node scripts/run-audit.mjs --site https://www.example.com
```

---

## Recommended first sequence

Run these in order:

```bash
npm login
npm install
npx playwright install --with-deps chromium
npm pack --dry-run
npm publish --access public
git add .
git commit -m "Prepare npm CLI package for release"
git push origin main
git tag v0.2.1
git push origin v0.2.1
```

After the first manual publish, switch to **trusted publishing** for future automated npm releases.

---

## Public repo checklist

Before each public release:

```bash
git status
git ls-files
git grep -n "_authToken"
git grep -n "BEGIN PRIVATE KEY"
git grep -n "github_pat_"
git grep -n "ghp_"
npm pack --dry-run
```
