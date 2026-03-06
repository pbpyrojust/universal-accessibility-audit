#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { stringify } from "csv-stringify/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--crawl") args.crawl = true;
    else if (a.startsWith("--")) {
      const key = a.replace(/^--/, "");
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i++; }
    }
  }
  return args;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    url.hash = "";
    return url.toString();
  } catch {
    return String(u || "").trim();
  }
}

function loadUrlsFromFile(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/g)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !s.startsWith("#"))
    .map(normalizeUrl);
}

function isSameOrigin(u, origin) {
  try { return new URL(u).origin === origin; } catch { return false; }
}

function normalizeWhitespace(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function detectBotChallengeHtml(html = "", status = 0) {
  const s = String(html || "").toLowerCase();
  return {
    detected:
      [403, 429, 503].includes(Number(status)) ||
      s.includes("cf-browser-verification") ||
      s.includes("just a moment") ||
      s.includes("attention required") ||
      s.includes("verify you are human") ||
      s.includes("cloudflare") ||
      s.includes("captcha"),
    type: s.includes("cloudflare") || s.includes("cf-browser-verification") || s.includes("just a moment")
      ? "cloudflare"
      : s.includes("captcha") ? "captcha"
      : [403,429,503].includes(Number(status)) ? `http_${status}` : "unknown",
    status: Number(status) || 0,
  };
}

async function fetchText(url, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "user-agent": "Universal-A11y-Audit",
        "accept": "text/plain, text/html, application/xml, text/xml, */*",
      },
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, text: "", error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function buildRobotsMatcher(startUrl) {
  try {
    const robotsUrl = new URL("/robots.txt", startUrl).toString();
    const res = await fetchText(robotsUrl, 20000);
    if (!res.ok || !res.text) return { isAllowedUrl: null, crawlDelayMs: 0 };
    const disallows = [];
    let crawlDelayMs = 0;
    for (const line of res.text.split(/\r?\n/g)) {
      const trimmed = line.trim();
      const m = /^disallow:\s*(.+)$/i.exec(trimmed);
      if (m) disallows.push(m[1].trim());
      const cd = /^crawl-delay:\s*(\d+)$/i.exec(trimmed);
      if (cd && !crawlDelayMs) crawlDelayMs = Number(cd[1]) * 1000;
    }
    function isAllowedUrl(url) {
      try {
        const u = new URL(url);
        const pathWithQuery = `${u.pathname}${u.search || ""}`;
        for (const rule of disallows) {
          if (!rule || rule === "/") continue;
          const normalized = rule.replace(/\*$/,"");
          if (pathWithQuery.startsWith(normalized) || pathWithQuery.includes(normalized.replace(/\*/g, ""))) return false;
        }
        return true;
      } catch { return true; }
    }
    return { isAllowedUrl, crawlDelayMs };
  } catch {
    return { isAllowedUrl: null, crawlDelayMs: 0 };
  }
}

async function crawlInternalLinks(page, startUrl, maxPages, opts = {}) {
  const { isAllowedUrl = null, slow = false, crawlDelayMs = 0 } = opts;
  const origin = new URL(startUrl).origin;
  const queue = [normalizeUrl(startUrl)];
  const seen = new Set(queue);

  while (queue.length && seen.size < maxPages) {
    const current = queue.shift();
    try {
      await page.goto(current, { waitUntil: slow ? "domcontentloaded" : "networkidle", timeout: 60000 });
      if (crawlDelayMs > 0) await sleep(crawlDelayMs);
      const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")).filter(Boolean));
      for (const href of hrefs) {
        let abs;
        try { abs = new URL(href, current).toString(); } catch { continue; }
        abs = normalizeUrl(abs);
        if (!isSameOrigin(abs, origin)) continue;
        const u = new URL(abs);
        const p = u.pathname.toLowerCase();
        if (p.endsWith(".pdf") || p.endsWith(".png") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".zip")) continue;
        if (isAllowedUrl && !isAllowedUrl(abs)) continue;
        if (!seen.has(abs) && seen.size < maxPages) {
          seen.add(abs);
          queue.push(abs);
        }
      }
    } catch {}
  }
  return Array.from(seen);
}

async function runAxe(page) {
  await page.addScriptTag({ path: axePath });
  return await page.evaluate(async () => {
    return await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      resultTypes: ["violations", "incomplete", "passes"],
    });
  });
}

function mapImpactToPriority(impact) {
  if (impact === "critical") return "P0-Critical";
  if (impact === "serious") return "P1-High";
  if (impact === "moderate") return "P2-Medium";
  if (impact === "minor") return "P3-Low";
  return "P2-Medium";
}

function extractWcagRefs(tags = []) {
  const sc = tags.filter((t) => /^wcag\d+/.test(t));
  return sc.length ? sc.join(" | ") : "";
}

function sheetFilterUrl(sheetId, gid, column, value) {
  const safeId = sheetId || "SHEET_ID";
  const safeGid = gid || "0";
  return `https://docs.google.com/spreadsheets/d/${safeId}/edit#gid=${safeGid}&q=${column}%3A${encodeURIComponent(String(value))}`;
}

function looksLikeFilename(s) {
  const v = (s || "").toLowerCase();
  if (!v) return false;
  if (/(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg)$/i.test(v)) return true;
  if (/^(img|dsc|pxl|image)[-_\s]?\d+/.test(v)) return true;
  return /[_-]/.test(v) && !/\s/.test(v) && /[a-z]/.test(v) && v.length >= 8;
}

function suggestedAltFromSrc(src) {
  try {
    const u = new URL(src);
    const base = (u.pathname.split("/").pop() || "").split("?")[0].split("#")[0];
    const noExt = base.replace(/\.[a-z0-9]+$/i, "");
    const cleaned = noExt.replace(/[-_]+/g, " ").replace(/\b\d{2,}\b/g, " ").replace(/\s+/g, " ").trim();
    return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "";
  } catch { return ""; }
}

function rateAltText(alt, src) {
  const a = normalizeWhitespace(alt);
  const issues = [];
  let score = 100;
  if (a === "") {
    issues.push("alt_empty");
    const sug = suggestedAltFromSrc(src);
    return {
      score: 80,
      rating: "Needs review",
      issues: issues.join("|"),
      suggested_alt: sug ? `If informative, use something like: ${sug}` : "If informative, add a short descriptive alt. If decorative, keep empty alt (alt='').",
    };
  }
  if (!a) { issues.push("alt_missing"); score = 0; }
  if (a && a.length < 4) { issues.push("too_short"); score -= 30; }
  if (a && a.length > 125) { issues.push("too_long"); score -= 20; }
  if (looksLikeFilename(a)) { issues.push("looks_like_filename"); score -= 60; }
  if (/\b(copy|image|photo|picture)\b/i.test(a) && a.length <= 12) { issues.push("too_generic"); score -= 25; }
  score = Math.max(0, Math.min(100, score));
  const rating = score >= 85 ? "Good" : score >= 60 ? "OK" : score >= 35 ? "Poor" : "Bad";
  const suggested = (issues.includes("alt_missing") || issues.includes("looks_like_filename") || issues.includes("too_generic")) ? (suggestedAltFromSrc(src) || "") : "";
  return { score, rating, issues: issues.join("|"), suggested_alt: suggested };
}

async function gotoWithRetry(page, url, opts = {}) {
  const { slow = false, retries = 1, backoffMs = 3000, timeoutMs = 90000, cfAware = false } = opts;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await page.goto(url, { waitUntil: slow ? "domcontentloaded" : "networkidle", timeout: timeoutMs });
      await page.waitForTimeout(slow ? 2000 : 800);
      const html = await page.content();
      const bot = cfAware ? detectBotChallengeHtml(html, response?.status?.() || 0) : { detected: false, type: "", status: 0 };
      if (bot.detected) {
        lastErr = new Error(`bot_protection:${bot.type}`);
        if (attempt < retries) {
          const delay = backoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
          console.warn(`   ⚠ Bot protection detected (${bot.type}, status ${bot.status}). Backing off ${Math.ceil(delay/1000)}s then retrying...`);
          await sleep(delay);
          continue;
        }
        throw lastErr;
      }
      return { response, bot };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        const delay = backoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
        console.warn(`   ⚠ Navigation failed (${String(e?.message || e)}). Backing off ${Math.ceil(delay/1000)}s then retrying...`);
        await sleep(delay);
      }
    }
  }
  throw lastErr || new Error("navigation_failed");
}

async function main() {
  const args = parseArgs(process.argv);
  const baseOutDir = path.resolve(process.cwd(), args["out-dir"] || "reports");
  const runId = args["run-id"] ? String(args["run-id"]) : new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
  const outDir = path.join(baseOutDir, runId);
  ensureDir(outDir);

  const sheetId = args["sheet-id"] ? String(args["sheet-id"]) : "SHEET_ID";
  const sheetGid = args["sheet-gid"] ? String(args["sheet-gid"]) : "0";
  const startUrl = args.start ? normalizeUrl(args.start) : "https://example.com/";
  const slowMode = Boolean(args["slow"]);
  const cfAware = Boolean(args["cloudflare-aware"]);
  const retries = args["retries"] ? Number(args["retries"]) : (slowMode ? 2 : 1);
  const backoffMs = args["backoff-ms"] ? Number(args["backoff-ms"]) : (slowMode ? 8000 : 3000);
  const maxPages = args["max-pages"] ? Number(args["max-pages"]) : 50;
  const respectRobots = Boolean(args["respect-robots"]);

  let robotsCfg = { isAllowedUrl: null, crawlDelayMs: 0 };
  if (respectRobots) robotsCfg = await buildRobotsMatcher(startUrl);
  const crawlDelayMs = args["crawl-delay-ms"] ? Number(args["crawl-delay-ms"]) : (robotsCfg.crawlDelayMs || (slowMode ? 1500 : 0));

  if (slowMode) console.log("ℹ Running in --slow mode (conservative scan: longer delays + retries).");
  if (respectRobots) {
    console.log("ℹ Respecting robots.txt Disallow rules (--respect-robots).");
    if (crawlDelayMs > 0) console.log(`ℹ Using crawl delay: ${Math.ceil(crawlDelayMs/1000)}s.`);
  }
  if (cfAware) console.log("ℹ Cloudflare-aware challenge detection enabled (--cloudflare-aware).");

  let urls = [];
  if (args.crawl) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    urls = await crawlInternalLinks(page, startUrl, maxPages, { isAllowedUrl: robotsCfg.isAllowedUrl, slow: slowMode, crawlDelayMs });
    await browser.close();
  } else if (args["urls-file"]) {
    urls = loadUrlsFromFile(path.resolve(process.cwd(), args["urls-file"]));
    if (robotsCfg.isAllowedUrl) urls = urls.filter((u) => robotsCfg.isAllowedUrl(u));
  } else {
    urls = [startUrl];
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: "Universal-A11y-Audit (Playwright + axe-core)" });
  const page = await context.newPage();

  const siteResults = [];
  const csvRows = [];
  const imageAltRows = [];
  const startedAt = Date.now();
  let totalViolationNodes = 0;
  let pageErrors = 0;
  const byImpact = new Map();
  const byRule = new Map();
  const byPage = new Map();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const idx = i + 1;
    const pageStart = Date.now();
    console.log(`[${idx}/${urls.length}] Scanning: ${url}`);
    const pageResult = { url, ok: true, error: null, axe: null, timestamp: new Date().toISOString() };

    try {
      const nav = await gotoWithRetry(page, url, { slow: slowMode, retries, backoffMs, timeoutMs: 90000, cfAware });
      if (nav.bot && nav.bot.detected) throw new Error(`bot_protection:${nav.bot.type}`);
      if (crawlDelayMs > 0) await sleep(crawlDelayMs);

      try {
        const imgs = await page.evaluate(() => {
          const out = [];
          const els = Array.from(document.querySelectorAll("img"));
          for (const el of els) {
            const src = el.currentSrc || el.getAttribute("src") || "";
            const alt = el.getAttribute("alt");
            const title = el.getAttribute("title") || "";
            const id = el.id ? `#${el.id}` : "";
            const cls = (el.className && typeof el.className === "string") ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
            const locator = (id || cls) ? `img${id}${cls}` : "img";
            out.push({ src, alt: alt === null ? "" : alt, alt_present: alt !== null, title, locator });
          }
          return out;
        });
        for (const im of imgs) {
          if (!im.src) continue;
          let abs = im.src;
          try { abs = new URL(im.src, url).toString(); } catch {}
          let rated = { score: 0, rating: "Needs review", issues: "alt_unrated", suggested_alt: "" };
          try { rated = rateAltText(im.alt_present ? im.alt : "", abs); } catch (e) {}
          imageAltRows.push({
            page_url: url,
            image_url: abs,
            alt_present: im.alt_present ? "yes" : "no",
            alt_text: normalizeWhitespace(im.alt_present ? im.alt : ""),
            title_text: normalizeWhitespace(im.title || ""),
            locator: im.locator || "img",
            readability_score: rated.score,
            readability_rating: rated.rating,
            issues: rated.issues,
            suggested_alt: rated.suggested_alt,
          });
        }
      } catch (e) {
        console.warn(`   ↳ Alt report skipped for ${url}: ${String(e?.message || e)}`);
      }

      const axe = await runAxe(page);
      pageResult.axe = axe;
      let pageViolationNodes = 0;
      for (const v of axe.violations || []) {
        byRule.set(v.id, (byRule.get(v.id) || 0) + 1);
        byImpact.set(v.impact || "unknown", (byImpact.get(v.impact || "unknown") || 0) + 1);
        for (const node of v.nodes || []) {
          pageViolationNodes++;
          byPage.set(url, (byPage.get(url) || 0) + 1);
          const target = Array.isArray(node.target) ? node.target.join(" | ") : String(node.target || "");
          const wcagRefs = extractWcagRefs(v.tags || []);
          csvRows.push({
            scope: "Page",
            page_url: url,
            rule_id: v.id,
            impact: v.impact || "",
            priority: mapImpactToPriority(v.impact),
            wcag_refs: wcagRefs,
            help: v.help || "",
            help_url: v.helpUrl || "",
            description: v.description || "",
            failure_summary: node.failureSummary || "",
            selector_target: target,
            html_snippet: normalizeWhitespace((node.html || "").slice(0, 500)),
            is_global_candidate: ["color-contrast", "meta-viewport", "aria-prohibited-attr", "button-name", "link-name"].includes(v.id) ? "yes" : "no",
            suggested_github_issue: v.id,
            rule_filter_url: sheetFilterUrl(sheetId, sheetGid, "rule_id", v.id),
            impact_filter_url: sheetFilterUrl(sheetId, sheetGid, "impact", v.impact || ""),
            page_filter_url: sheetFilterUrl(sheetId, sheetGid, "page_url", url),
            recommendation: "Fix the issue per axe guidance; ensure WCAG 2.1 Level AA compliance for this component/site-wide pattern.",
          });
        }
      }
      totalViolationNodes += pageViolationNodes;
      const elapsed = ((Date.now() - pageStart) / 1000).toFixed(1);
      const totalElapsed = ((Date.now() - startedAt) / 60).toFixed(1);
      console.log(`   ↳ Done in ${elapsed}s | violation nodes: ${pageViolationNodes} | total: ${totalViolationNodes} | elapsed: ${totalElapsed}m`);
    } catch (err) {
      pageResult.ok = false;
      pageResult.error = String(err?.message || err);
      pageErrors++;
      const isBot = pageResult.error.startsWith("bot_protection:");
      csvRows.push({
        scope: "Page",
        page_url: url,
        rule_id: isBot ? "bot_protection" : "page_error",
        impact: "serious",
        priority: "P1-High",
        wcag_refs: "",
        help: isBot ? "Bot protection / WAF challenge detected" : "Page failed to load for scanning",
        help_url: "",
        description: isBot ? "Bot protection / WAF challenge detected" : "Playwright navigation error",
        failure_summary: pageResult.error,
        selector_target: "",
        html_snippet: "",
        is_global_candidate: "no",
        suggested_github_issue: isBot ? "bot_protection" : "page_error",
        rule_filter_url: sheetFilterUrl(sheetId, sheetGid, "rule_id", isBot ? "bot_protection" : "page_error"),
        impact_filter_url: sheetFilterUrl(sheetId, sheetGid, "impact", "serious"),
        page_filter_url: sheetFilterUrl(sheetId, sheetGid, "page_url", url),
        recommendation: isBot ? "Back off, wait before retrying, and consider smaller batches with --slow --respect-robots --cloudflare-aware." : "Confirm the page is publicly accessible without auth/bot protection. Re-run scan; if persistent, ticket separately.",
      });
      const elapsed = ((Date.now() - pageStart) / 1000).toFixed(1);
      const totalElapsed = ((Date.now() - startedAt) / 60).toFixed(1);
      console.log(`   ↳ ERROR in ${elapsed}s | elapsed: ${totalElapsed}m`);
    }
    siteResults.push(pageResult);
  }

  await browser.close();

  fs.writeFileSync(path.join(outDir, "a11y-report.json"), JSON.stringify({ runId, scanned: urls, results: siteResults }, null, 2));
  fs.writeFileSync(path.join(outDir, "a11y-violations.csv"), stringify(csvRows, { header: true, columns: [
    "scope","page_url","rule_id","impact","priority","wcag_refs","help","help_url","description","failure_summary","selector_target","html_snippet","is_global_candidate","suggested_github_issue","rule_filter_url","impact_filter_url","page_filter_url","recommendation"
  ]}));
  fs.writeFileSync(path.join(outDir, "a11y-image-alts.csv"), stringify(imageAltRows, { header: true, columns: [
    "page_url","image_url","alt_present","alt_text","title_text","locator","readability_score","readability_rating","issues","suggested_alt"
  ]}));

  const meta = {
    runId,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    pagesScanned: urls.length,
    pageErrors,
    violationNodes: csvRows.filter((r) => r.rule_id !== "page_error" && r.rule_id !== "bot_protection").length,
    byImpact: Object.fromEntries(byImpact),
    byRule: Object.fromEntries(byRule),
    topPages: Array.from(byPage.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([url, count]) => ({ url, count })),
  };
  fs.writeFileSync(path.join(outDir, "a11y-run-metadata.json"), JSON.stringify(meta, null, 2));
  try { fs.writeFileSync(path.join(baseOutDir, "latest"), runId, "utf8"); } catch {}

  console.log(`Scanned ${urls.length} page(s).`);
  console.log(`CSV rows (violating nodes): ${meta.violationNodes}`);
  if (pageErrors) console.log(`Pages with scan errors: ${pageErrors}`);
  console.log(`Run folder: ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
