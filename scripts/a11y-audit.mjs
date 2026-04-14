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

function decodeUrlForDisplay(u) {
  try { return decodeURI(String(u || "")); } catch { return String(u || ""); }
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


function loadAuthConfig(filePath) {
  try {
    const resolved = path.resolve(process.cwd(), filePath);
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (e) {
    throw new Error(`Could not read auth config at ${filePath}: ${String(e?.message || e)}`);
  }
}

function getAuthSettings(args) {
  let cfg = {};
  if (args["auth-config"]) {
    cfg = loadAuthConfig(args["auth-config"]);
  }

  const httpUsername = args["http-username"] || process.env.A11Y_HTTP_USERNAME || cfg.httpUsername || cfg.basicAuthUsername || "";
  const httpPassword = args["http-password"] || process.env.A11Y_HTTP_PASSWORD || cfg.httpPassword || cfg.basicAuthPassword || "";

  const loginUrl = args["login-url"] || cfg.loginUrl || "";
  const username = args["username"] || process.env.A11Y_LOGIN_USERNAME || cfg.username || "";
  const password = args["password"] || process.env.A11Y_LOGIN_PASSWORD || cfg.password || "";
  const usernameSelector = args["username-selector"] || cfg.usernameSelector || "input[name='log'], input[name='username'], input[type='email']";
  const passwordSelector = args["password-selector"] || cfg.passwordSelector || "input[name='pwd'], input[name='password'], input[type='password']";
  const submitSelector = args["submit-selector"] || cfg.submitSelector || "button[type='submit'], input[type='submit']";
  const readySelector = args["ready-selector"] || cfg.readySelector || "";
  const postLoginWaitMs = Number(args["post-login-wait-ms"] || cfg.postLoginWaitMs || 2000);

  return {
    httpCredentials: httpUsername || httpPassword ? { username: httpUsername, password: httpPassword } : null,
    formAuth: loginUrl && username ? {
      loginUrl,
      username,
      password,
      usernameSelector,
      passwordSelector,
      submitSelector,
      readySelector,
      postLoginWaitMs,
    } : null,
  };
}

async function maybePerformFormLogin(page, formAuth, slowMode = false) {
  if (!formAuth) return false;
  console.log(`ℹ Attempting form login at ${formAuth.loginUrl}`);
  await page.goto(formAuth.loginUrl, { waitUntil: slowMode ? "domcontentloaded" : "networkidle", timeout: 90000 });
  await page.locator(formAuth.usernameSelector).first().fill(formAuth.username);
  await page.locator(formAuth.passwordSelector).first().fill(formAuth.password || "");
  if (formAuth.submitSelector) {
    await Promise.allSettled([
      page.waitForLoadState(slowMode ? "domcontentloaded" : "networkidle", { timeout: 20000 }),
      page.locator(formAuth.submitSelector).first().click(),
    ]);
  } else {
    await page.keyboard.press("Enter");
    await page.waitForLoadState(slowMode ? "domcontentloaded" : "networkidle", { timeout: 20000 }).catch(() => {});
  }
  if (formAuth.readySelector) {
    await page.locator(formAuth.readySelector).first().waitFor({ state: "visible", timeout: 20000 });
  } else {
    await page.waitForTimeout(formAuth.postLoginWaitMs || 2000);
  }
  console.log("ℹ Form login step completed.");
  return true;
}

function formatDuration(ms) {
  const sec = Math.max(0, ms / 1000);
  if (sec < 90) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  if (min < 90) return `${min.toFixed(1)}m`;
  const hr = min / 60;
  return `${hr.toFixed(2)}h`;
}

function formatElapsed(startedAt) {
  return formatDuration(Date.now() - startedAt);
}

function avg(arr) {
  return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
}

function estimateRemaining(completedDurations, completedCount, totalCount) {
  if (completedCount <= 0) return "estimating…";
  const remaining = Math.max(0, totalCount - completedCount);
  return formatDuration(avg(completedDurations) * remaining);
}

function createHeartbeat(label, intervalMs = 10000, etaLabel = "") {
  const started = Date.now();
  const timer = setInterval(() => {
    process.stdout.write(`   … still working on ${label} | elapsed ${formatElapsed(started)}${etaLabel ? ` | ${etaLabel}` : ""}\n`);
  }, intervalMs);
  return () => clearInterval(timer);
}

function printStartupAdvisories({ urlCount, slowMode, cfAware, crawlDelayMs, retries, backoffMs, batchSize = 0, hasAuth = false }) {
  if (urlCount >= 100) console.log(`ℹ Large scan detected (${urlCount} pages). This may take a while.`);
  if (urlCount >= 500) console.log("⚠ Very large scan. Consider smaller batches if the site is sensitive or rate-limited.");
  if (batchSize > 0) console.log(`ℹ Small-batch mode enabled (${batchSize} page max for this run).`);
  if (hasAuth) console.log("ℹ Authenticated mode enabled for protected/staging/dev sites.");
  if (slowMode) {
    console.log("ℹ Running in --slow mode (conservative scan: longer delays + retries).");
    console.log("ℹ Slow/protected-site scans can take significantly longer than normal runs.");
  }
  if (cfAware) {
    console.log("ℹ Cloudflare-aware challenge detection enabled (--cloudflare-aware).");
    console.log("ℹ Challenge pages, retries, and backoff can make scans look quiet for a while. Heartbeat lines will show progress.");
  }
  if (crawlDelayMs > 0) console.log(`ℹ Using crawl delay: ${Math.ceil(crawlDelayMs/1000)}s between pages.`);
  if (retries > 1 || backoffMs >= 5000) console.log(`ℹ Retry policy: ${retries} retries, base backoff ${Math.ceil(backoffMs/1000)}s.`);
  if (hasAuth) console.log("ℹ Auth enabled for this run.");
}

function mapImpactToPriority(impact) {
  if (impact === "critical") return "P0-Critical";
  if (impact === "serious") return "P1-High";
  if (impact === "moderate") return "P2-Medium";
  if (impact === "minor") return "P3-Low";
  return "P2-Medium";
}

function mapImpactToImportance(impact) {
  if (impact === "critical") return "Highest";
  if (impact === "serious") return "High";
  if (impact === "moderate") return "Medium";
  if (impact === "minor") return "Low";
  return "Medium";
}

function detectOutOfControlIssue({ selectorTarget = "", htmlSnippet = "", failureSummary = "", helpUrl = "" }) {
  const hay = `${selectorTarget} ${htmlSnippet} ${failureSummary} ${helpUrl}`.toLowerCase();
  const iframeLike =
    hay.includes("iframe") ||
    hay.includes("<frame") ||
    hay.includes("youtube.com/embed") ||
    hay.includes("player.vimeo.com") ||
    hay.includes("google.com/maps/embed") ||
    hay.includes("spotify.com/embed") ||
    hay.includes("soundcloud.com/player") ||
    hay.includes("widget") ||
    hay.includes("third-party") ||
    hay.includes("third party") ||
    hay.includes("embedded");
  return {
    likely_out_of_control: iframeLike ? "yes" : "no",
    control_notes: iframeLike
      ? "Likely embedded or iframe-based content. Confirm whether this is controlled by a third-party provider or external widget before assigning remediation."
      : "Appears to be in first-party markup unless manual review shows otherwise.",
  };
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
    const stopHeartbeat = createHeartbeat(`${decodeUrlForDisplay(url)} (navigation attempt ${attempt + 1}/${retries + 1})`, 10000);
    try {
      const response = await page.goto(url, { waitUntil: slow ? "domcontentloaded" : "networkidle", timeout: timeoutMs });
      await page.waitForTimeout(slow ? 2000 : 800);
      const html = await page.content();
      const bot = cfAware ? detectBotChallengeHtml(html, response?.status?.() || 0) : { detected: false, type: "", status: 0 };
      stopHeartbeat();
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
      stopHeartbeat();
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
  const batchSize = args["batch-size"] ? Number(args["batch-size"]) : 0;
  const auth = getAuthSettings(args);

  let robotsCfg = { isAllowedUrl: null, crawlDelayMs: 0 };
  if (respectRobots) robotsCfg = await buildRobotsMatcher(startUrl);
  const crawlDelayMs = args["crawl-delay-ms"] ? Number(args["crawl-delay-ms"]) : (robotsCfg.crawlDelayMs || (slowMode ? 1500 : 0));
  const hasAuth = Boolean(args["http-username"] || args["http-password"] || args["login-url"] || args["username"] || args["password"] || args["auth-config"] || process.env.A11Y_HTTP_USERNAME || process.env.A11Y_HTTP_PASSWORD || process.env.A11Y_LOGIN_USERNAME || process.env.A11Y_LOGIN_PASSWORD);

  if (respectRobots) console.log("ℹ Respecting robots.txt Disallow rules (--respect-robots).");
  if (auth.httpCredentials) console.log("ℹ HTTP/basic auth credentials configured for this run.");
  if (auth.formAuth) console.log("ℹ Form-login auth config detected for this run.");

  let urls = [];
  if (args.crawl) {
    const browser = await chromium.launch({ headless: true });
    const crawlContextOptions = {};
    if (auth.httpCredentials) crawlContextOptions.httpCredentials = auth.httpCredentials;
    const context = await browser.newContext(crawlContextOptions);
    const page = await context.newPage();
    if (auth.formAuth) {
      await maybePerformFormLogin(page, auth.formAuth, slowMode);
    }
    urls = await crawlInternalLinks(page, startUrl, maxPages, { isAllowedUrl: robotsCfg.isAllowedUrl, slow: slowMode, crawlDelayMs });
    await browser.close();
  } else if (args["urls-file"]) {
    urls = loadUrlsFromFile(path.resolve(process.cwd(), args["urls-file"]));
    if (robotsCfg.isAllowedUrl) urls = urls.filter((u) => robotsCfg.isAllowedUrl(u));
  } else {
    urls = [startUrl];
  }

  if (batchSize > 0 && urls.length > batchSize) {
    urls = urls.slice(0, batchSize);
  }

  printStartupAdvisories({ urlCount: urls.length, slowMode, cfAware, crawlDelayMs, retries, backoffMs, batchSize, hasAuth: Boolean(auth.httpCredentials || auth.formAuth) });

  const browser = await chromium.launch({ headless: true });
  const contextOptions = { userAgent: "Universal-A11y-Audit (Playwright + axe-core)" };
  if (auth.httpCredentials) contextOptions.httpCredentials = auth.httpCredentials;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  if (auth.formAuth) {
    await maybePerformFormLogin(page, auth.formAuth, slowMode);
  }

  const siteResults = [];
  const csvRows = [];
  const imageAltRows = [];
  const startedAt = Date.now();
  const completedDurations = [];
  let totalViolationNodes = 0;
  let pageErrors = 0;
  const byImpact = new Map();
  const byRule = new Map();
  const byPage = new Map();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const idx = i + 1;
    const pageStart = Date.now();
    const etaBefore = estimateRemaining(completedDurations, i, urls.length);
    console.log(`[${idx}/${urls.length}] Scanning: ${decodeUrlForDisplay(url)} | ETA remaining: ${etaBefore}`);
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

      const stopAxeHeartbeat = createHeartbeat(`${decodeUrlForDisplay(url)} (axe analysis)`, 10000, `ETA remaining: ${estimateRemaining(completedDurations, i, urls.length)}`);
      const axe = await runAxe(page);
      stopAxeHeartbeat();
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
            importance: mapImpactToImportance(v.impact),
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
            likely_out_of_control: detectOutOfControlIssue({
              selectorTarget: target,
              htmlSnippet: node.html || "",
              failureSummary: node.failureSummary || "",
              helpUrl: v.helpUrl || "",
            }).likely_out_of_control,
            control_notes: detectOutOfControlIssue({
              selectorTarget: target,
              htmlSnippet: node.html || "",
              failureSummary: node.failureSummary || "",
              helpUrl: v.helpUrl || "",
            }).control_notes,
            recommendation: "Fix the issue per axe guidance; ensure WCAG 2.1 Level AA compliance for this component/site-wide pattern.",
          });
        }
      }
      totalViolationNodes += pageViolationNodes;
      completedDurations.push(Date.now() - pageStart);
      console.log(`   ↳ Done in ${formatElapsed(pageStart)} | violation nodes: ${pageViolationNodes} | total: ${totalViolationNodes} | elapsed: ${formatElapsed(startedAt)} | ETA remaining: ${estimateRemaining(completedDurations, i + 1, urls.length)}`);
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
        importance: "High",
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
        likely_out_of_control: "review",
        control_notes: isBot ? "Bot protection prevented analysis. This is not necessarily a code issue in your control." : "Manual review needed to determine whether the failing element is first-party or embedded.",
        recommendation: isBot ? "Back off, wait before retrying, and consider smaller batches with --slow --respect-robots --cloudflare-aware." : "Confirm the page is publicly accessible without auth/bot protection. Re-run scan; if persistent, ticket separately.",
      });
      completedDurations.push(Date.now() - pageStart);
      console.log(`   ↳ ERROR in ${formatElapsed(pageStart)} | elapsed: ${formatElapsed(startedAt)} | ETA remaining: ${estimateRemaining(completedDurations, i + 1, urls.length)}`);
    }
    siteResults.push(pageResult);
  }

  await browser.close();

  fs.writeFileSync(path.join(outDir, "a11y-report.json"), JSON.stringify({ runId, scanned: urls, results: siteResults }, null, 2));
  fs.writeFileSync(path.join(outDir, "a11y-violations.csv"), stringify(csvRows, { header: true, columns: [
    "scope","page_url","rule_id","impact","priority","importance","wcag_refs","help","help_url","description","failure_summary","selector_target","html_snippet","is_global_candidate","suggested_github_issue","rule_filter_url","impact_filter_url","page_filter_url","likely_out_of_control","control_notes","recommendation"
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
