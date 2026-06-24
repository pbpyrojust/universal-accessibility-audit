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

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', italic: '\x1b[3m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
  bgRed: '\x1b[41m', bgGreen: '\x1b[42m', bgYellow: '\x1b[43m', bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m', bgCyan: '\x1b[46m',
  brightRed: '\x1b[91m', brightGreen: '\x1b[92m', brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m', brightMagenta: '\x1b[95m', brightCyan: '\x1b[96m',
};
const rainbowColors = [c.brightRed, c.brightYellow, c.brightGreen, c.brightCyan, c.brightBlue, c.brightMagenta];
function rainbow(text) {
  return [...text].map((ch, i) => ch === ' ' ? ch : `${rainbowColors[i % rainbowColors.length]}${ch}`).join('') + c.reset;
}
function rainbowBar(filled, empty) {
  const chars = [];
  for (let i = 0; i < filled; i++) {
    chars.push(`${rainbowColors[i % rainbowColors.length]}█`);
  }
  return chars.join('') + `${c.dim}${'░'.repeat(empty)}${c.reset}`;
}
const spinnerFrames = ['◐', '◓', '◑', '◒'];
let spinnerIdx = 0;
function spinner() { return rainbowColors[spinnerIdx % rainbowColors.length] + spinnerFrames[spinnerIdx++ % spinnerFrames.length] + c.reset; }
function progressLine(current, total, label, extra = '') {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const barWidth = 30;
  const filled = total > 0 ? Math.round((current / total) * barWidth) : 0;
  const bar = rainbowBar(filled, barWidth - filled);
  const pctStr = pct === 100 ? `${c.brightGreen}${pct}%${c.reset}` : `${c.brightCyan}${pct}%${c.reset}`;
  const spin = current < total ? spinner() : `${c.brightGreen}✔${c.reset}`;
  process.stdout.write(`\r  ${spin} ${bar} ${c.bold}${current}${c.reset}${c.dim}/${total}${c.reset} ${pctStr} ${c.dim}${label}${c.reset}${extra ? ' ' + extra : ''}`.padEnd(160) + '\r');
}
function phaseHeader(label, icon = '▸') {
  console.log('');
  console.log(`  ${rainbow(icon)} ${c.bold}${c.brightCyan}${label}${c.reset} ${c.dim}${'─'.repeat(Math.max(0, 52 - label.length))}${c.reset}`);
}
function phaseDone(label, elapsed) {
  console.log(`    ${c.brightGreen}✔${c.reset} ${label} ${c.dim}in${c.reset} ${c.brightYellow}${formatDuration(elapsed)}${c.reset}`);
}
function statusMsg(icon, color, msg) {
  console.log(`    ${color}${icon}${c.reset} ${msg}`);
}
function severityColor(count, threshold = 0) {
  if (count === 0) return `${c.brightGreen}${count}${c.reset}`;
  if (count > threshold) return `${c.brightRed}${count}${c.reset}`;
  return `${c.brightYellow}${count}${c.reset}`;
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
  console.log(`    ${c.brightMagenta}🔐${c.reset} Attempting form login at ${c.bold}${formAuth.loginUrl}${c.reset}`);
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
  console.log(`    ${c.brightGreen}✔${c.reset} Form login completed.`);
  return true;
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatElapsed(startedAt) {
  return formatDuration(Date.now() - startedAt);
}

function avg(arr) {
  return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
}

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

function scoreStatus(score) {
  if (score >= 90) return "pass";
  if (score >= 70) return "needs-review";
  return "fail";
}

function agenticPriority(score) {
  if (score < 50) return "P1-High";
  if (score < 70) return "P2-Medium";
  if (score < 90) return "P3-Low";
  return "P3-Low";
}

function agenticImportance(score) {
  if (score < 50) return "High";
  if (score < 70) return "Medium";
  return "Low";
}

function summarizeAgenticFindings(findings = []) {
  return findings.slice(0, 5).join(" | ");
}

function estimateRemaining(completedDurations, completedCount, totalCount) {
  if (completedCount <= 0) return "estimating…";
  const remaining = Math.max(0, totalCount - completedCount);
  return formatDuration(avg(completedDurations) * remaining);
}

function createHeartbeat(label, intervalMs = 10000, etaLabel = "") {
  const started = Date.now();
  const timer = setInterval(() => {
    const spin = spinner();
    process.stdout.write(`    ${spin} ${c.dim}still working on${c.reset} ${label} ${c.dim}|${c.reset} ${c.brightYellow}${formatElapsed(started)}${c.reset}${etaLabel ? ` ${c.dim}|${c.reset} ${etaLabel}` : ""}\n`);
  }, intervalMs);
  return () => clearInterval(timer);
}

function printStartupAdvisories({ urlCount, slowMode, cfAware, crawlDelayMs, retries, backoffMs, batchSize = 0, hasAuth = false }) {
  const estPerPage = slowMode ? 15000 : 8000;
  const estTotal = urlCount * estPerPage;
  statusMsg('⏱️', c.brightMagenta, `Estimated: ${c.bold}~${formatDuration(estTotal)}${c.reset} ${c.dim}(${urlCount} pages${slowMode ? ', slow mode' : ''})${c.reset}`);
  if (urlCount >= 100) statusMsg('📋', c.brightYellow, `Large scan detected (${c.bold}${urlCount}${c.reset}${c.brightYellow} pages). This may take a while.${c.reset}`);
  if (urlCount >= 500) statusMsg('⚠', c.brightRed, `Very large scan. Consider smaller batches if the site is sensitive or rate-limited.`);
  if (batchSize > 0) statusMsg('📦', c.cyan, `Small-batch mode enabled (${c.bold}${batchSize}${c.reset} page max for this run).`);
  if (hasAuth) statusMsg('🔐', c.brightMagenta, `Authenticated mode enabled for protected/staging/dev sites.`);
  if (slowMode) statusMsg('🐢', c.brightYellow, `Running in ${c.bold}--slow${c.reset}${c.brightYellow} mode (conservative timing + retries).${c.reset}`);
  if (cfAware) statusMsg('🛡️', c.brightYellow, `Cloudflare-aware detection enabled. Heartbeat lines will show progress.`);
  if (crawlDelayMs > 0) statusMsg('⏳', c.cyan, `Crawl delay: ${c.bold}${Math.ceil(crawlDelayMs/1000)}s${c.reset} between pages.`);
  if (retries > 1 || backoffMs >= 5000) statusMsg('🔄', c.cyan, `Retry policy: ${c.bold}${retries}${c.reset} retries, ${c.bold}${Math.ceil(backoffMs/1000)}s${c.reset} base backoff.`);
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
          console.warn(`    ${c.brightYellow}⚠${c.reset} Bot protection detected ${c.dim}(${bot.type}, status ${bot.status})${c.reset}. Backing off ${c.bold}${Math.ceil(delay/1000)}s${c.reset}...`);
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
        console.warn(`    ${c.brightYellow}⚠${c.reset} Navigation failed ${c.dim}(${String(e?.message || e).slice(0, 60)})${c.reset}. Backing off ${c.bold}${Math.ceil(delay/1000)}s${c.reset}...`);
        await sleep(delay);
      }
    }
  }
  throw lastErr || new Error("navigation_failed");
}

async function getOriginAgentResources(url, cache) {
  let origin = "";
  try { origin = new URL(url).origin; } catch { return {}; }
  if (cache.has(origin)) return cache.get(origin);

  async function probe(pathname, timeoutMs = 15000) {
    const target = new URL(pathname, origin).toString();
    const res = await fetchText(target, timeoutMs);
    const text = normalizeWhitespace(res.text || "");
    return {
      url: target,
      ok: Boolean(res.ok && text),
      status: res.status || 0,
      bytes: Buffer.byteLength(res.text || "", "utf8"),
      textSample: text.slice(0, 500),
    };
  }

  const resources = {
    llmsTxt: await probe("/llms.txt"),
    robotsTxt: await probe("/robots.txt"),
    sitemapXml: await probe("/sitemap.xml"),
    webMcpManifest: await probe("/.well-known/webmcp.json"),
    webMcpRootManifest: await probe("/webmcp.json"),
    aiPluginManifest: await probe("/.well-known/ai-plugin.json"),
  };
  cache.set(origin, resources);
  return resources;
}

function scoreSemanticData(resources = {}) {
  const findings = [];
  let score = 0;
  if (resources.llmsTxt?.ok) score += 60;
  else findings.push("Missing or unreachable /llms.txt for LLM-facing platform overview, rules, and limits.");
  if (resources.robotsTxt?.ok) score += 15;
  else findings.push("Missing or unreachable /robots.txt.");
  if (resources.sitemapXml?.ok) score += 15;
  else findings.push("Missing or unreachable /sitemap.xml.");
  if (resources.aiPluginManifest?.ok) score += 10;
  else findings.push("No /.well-known/ai-plugin.json discovered.");

  return {
    category: "semantic_data_formatting",
    label: "Semantic Data Formatting",
    score: clampScore(score),
    weight: 0.2,
    status: scoreStatus(score),
    findings,
    evidence: {
      llms_txt: resources.llmsTxt?.ok ? "found" : "missing",
      robots_txt: resources.robotsTxt?.ok ? "found" : "missing",
      sitemap_xml: resources.sitemapXml?.ok ? "found" : "missing",
      ai_plugin_manifest: resources.aiPluginManifest?.ok ? "found" : "missing",
    },
    recommendation: "Publish and maintain machine-readable discovery files, especially /llms.txt, so AI agents can quickly understand site rules, limits, and key resources.",
  };
}

function scoreWebMcp(resources = {}, pageSignals = {}) {
  const findings = [];
  const manifestFound = Boolean(resources.webMcpManifest?.ok || resources.webMcpRootManifest?.ok || pageSignals.webMcpLinks > 0 || pageSignals.webMcpScripts > 0 || pageSignals.windowRegistries > 0);
  const functionalSurfaceCount = Number(pageSignals.functionalSurfaceCount || 0);
  let score = 0;

  if (manifestFound) score += 65;
  else findings.push("No WebMCP manifest, link, script, or browser-exposed registry was detected.");

  if (functionalSurfaceCount === 0) {
    score += 25;
    findings.push("No obvious functional controls were detected on this page, so tool registration may be less applicable here.");
  } else if (manifestFound) {
    score += 25;
  } else {
    score += Math.min(20, Math.round(functionalSurfaceCount * 2));
    findings.push(`${functionalSurfaceCount} functional surface(s) detected without a matching WebMCP-style registration signal.`);
  }

  if (pageSignals.namedFunctionalSurfaces >= Math.max(1, Math.ceil(functionalSurfaceCount * 0.8))) score += 10;
  else findings.push("Some functional controls do not expose stable names, labels, or data attributes agents can map to actions.");

  return {
    category: "webmcp_protocol",
    label: "WebMCP Protocol",
    score: clampScore(score),
    weight: 0.3,
    status: scoreStatus(score),
    findings,
    evidence: {
      manifest: manifestFound ? "found" : "missing",
      functional_surface_count: functionalSurfaceCount,
      named_functional_surfaces: pageSignals.namedFunctionalSurfaces || 0,
      webmcp_links: pageSignals.webMcpLinks || 0,
      webmcp_scripts: pageSignals.webMcpScripts || 0,
      window_registries: pageSignals.windowRegistries || 0,
    },
    recommendation: "Register important user actions such as cart, checkout, search, filtering, sorting, and account flows in a browser-native agent/tool manifest with stable names and input schemas.",
  };
}

function scoreAccessibilityTree(pageSignals = {}) {
  const total = Number(pageSignals.interactiveCount || 0);
  const named = Number(pageSignals.namedInteractiveCount || 0);
  const formTotal = Number(pageSignals.formControlCount || 0);
  const formNamed = Number(pageSignals.namedFormControlCount || 0);
  const findings = [];

  const interactiveRatio = total ? named / total : 1;
  const formRatio = formTotal ? formNamed / formTotal : 1;
  let score = (interactiveRatio * 60) + (formRatio * 30) + 10;

  if (total && interactiveRatio < 0.9) findings.push(`${total - named} clickable/control element(s) lack a reliable accessible name.`);
  if (formTotal && formRatio < 0.95) findings.push(`${formTotal - formNamed} form control(s) lack a label, aria-label, aria-labelledby, title, or placeholder.`);
  if (pageSignals.genericButtonTextCount > 0) {
    score -= Math.min(20, pageSignals.genericButtonTextCount * 5);
    findings.push(`${pageSignals.genericButtonTextCount} control(s) use generic text such as "click here", "more", or "submit".`);
  }

  return {
    category: "accessibility_trees",
    label: "Accessibility Trees",
    score: clampScore(score),
    weight: 0.3,
    status: scoreStatus(score),
    findings,
    evidence: {
      interactive_count: total,
      named_interactive_count: named,
      form_control_count: formTotal,
      named_form_control_count: formNamed,
      generic_button_text_count: pageSignals.genericButtonTextCount || 0,
    },
    recommendation: "Give every clickable component and form field a precise accessible name using visible labels, associated <label> elements, or aria-labelledby where appropriate.",
  };
}

function scoreLayoutStability(pageSignals = {}) {
  const moved = Number(pageSignals.movedInteractiveCount || 0);
  const total = Number(pageSignals.interactiveCount || 0);
  const maxDelta = Number(pageSignals.maxInteractiveDeltaPx || 0);
  const cls = Number(pageSignals.cumulativeLayoutShift || 0);
  const findings = [];
  let score = 100;

  if (cls > 0.25) score -= 45;
  else if (cls > 0.1) score -= 25;
  else if (cls > 0.02) score -= 10;

  if (moved > 0) {
    const movedRatio = total ? moved / total : 0;
    score -= Math.min(45, Math.round(movedRatio * 60) + Math.min(20, Math.round(maxDelta / 4)));
    findings.push(`${moved} interactive element(s) shifted more than 3px after load; max observed movement ${maxDelta.toFixed(1)}px.`);
  }
  if (cls > 0.02) findings.push(`Observed cumulative layout shift: ${cls.toFixed(4)}.`);

  return {
    category: "layout_stability",
    label: "Layout Stability",
    score: clampScore(score),
    weight: 0.2,
    status: scoreStatus(score),
    findings,
    evidence: {
      cumulative_layout_shift: cls.toFixed(4),
      moved_interactive_count: moved,
      max_interactive_delta_px: maxDelta.toFixed(1),
    },
    recommendation: "Reserve stable dimensions for images, ads, async content, and controls so agent/test harness clicks do not target elements that move after render.",
  };
}

async function collectAgenticPageSignals(page) {
  return await page.evaluate(async () => {
    const textOf = (el) => {
      const id = el.getAttribute("aria-labelledby");
      const labelledBy = id ? id.split(/\s+/).map((part) => document.getElementById(part)?.textContent || "").join(" ") : "";
      const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent || "" : "";
      const wrapped = el.closest("label")?.textContent || "";
      return [
        el.getAttribute("aria-label"),
        labelledBy,
        label,
        wrapped,
        el.getAttribute("alt"),
        el.getAttribute("title"),
        el.getAttribute("placeholder"),
        el.value && ["button", "submit", "reset"].includes(String(el.type || "").toLowerCase()) ? el.value : "",
        el.textContent,
      ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    };
    const hasName = (el) => textOf(el).length > 1;
    const controls = Array.from(document.querySelectorAll("a[href], button, input, select, textarea, [role='button'], [role='link'], [role='menuitem'], [role='checkbox'], [role='radio'], [role='switch'], [tabindex]:not([tabindex='-1'])"));
    const formControls = Array.from(document.querySelectorAll("input:not([type='hidden']), select, textarea"));
    const genericRe = /^(click here|more|learn more|submit|go|read more|button)$/i;
    const functionalRe = /(cart|checkout|buy|purchase|filter|sort|search|login|sign in|sign up|subscribe|book|reserve|add|remove|wishlist|compare|quantity|apply|save|download)/i;
    const namedControls = controls.filter(hasName);
    const namedForms = formControls.filter(hasName);
    const functionalSurfaces = controls.filter((el) => {
      const hay = `${textOf(el)} ${el.id || ""} ${el.className || ""} ${el.getAttribute("name") || ""} ${el.getAttribute("data-action") || ""} ${el.getAttribute("data-testid") || ""}`;
      return functionalRe.test(hay);
    });
    const namedFunctionalSurfaces = functionalSurfaces.filter((el) => hasName(el) || el.getAttribute("data-action") || el.getAttribute("data-testid"));
    const before = controls.slice(0, 80).map((el, index) => {
      const r = el.getBoundingClientRect();
      return { index, x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const after = controls.slice(0, 80).map((el, index) => {
      const r = el.getBoundingClientRect();
      return { index, x: r.x, y: r.y, width: r.width, height: r.height };
    });
    let movedInteractiveCount = 0;
    let maxInteractiveDeltaPx = 0;
    for (const a of after) {
      const b = before.find((item) => item.index === a.index);
      if (!b) continue;
      const delta = Math.hypot(a.x - b.x, a.y - b.y);
      if (delta > 3) movedInteractiveCount++;
      if (delta > maxInteractiveDeltaPx) maxInteractiveDeltaPx = delta;
    }
    const layoutShiftEntries = performance.getEntriesByType ? performance.getEntriesByType("layout-shift") : [];
    const cumulativeLayoutShift = layoutShiftEntries
      .filter((entry) => !entry.hadRecentInput)
      .reduce((sum, entry) => sum + (entry.value || 0), 0);
    const webMcpLinks = document.querySelectorAll("link[rel*='webmcp' i], link[type='application/webmcp+json' i]").length;
    const webMcpScripts = document.querySelectorAll("script[type='application/webmcp+json' i], script[data-webmcp]").length;
    const windowRegistries = [
      window.webMCP,
      window.webmcp,
      window.WebMCP,
      window.navigator && window.navigator.webMCP,
    ].filter(Boolean).length;

    return {
      interactiveCount: controls.length,
      namedInteractiveCount: namedControls.length,
      formControlCount: formControls.length,
      namedFormControlCount: namedForms.length,
      genericButtonTextCount: controls.filter((el) => genericRe.test(textOf(el))).length,
      functionalSurfaceCount: functionalSurfaces.length,
      namedFunctionalSurfaces: namedFunctionalSurfaces.length,
      movedInteractiveCount,
      maxInteractiveDeltaPx,
      cumulativeLayoutShift,
      webMcpLinks,
      webMcpScripts,
      windowRegistries,
    };
  });
}

async function runAgenticLighthouseAudit(page, url, resourceCache) {
  const resources = await getOriginAgentResources(url, resourceCache);
  const pageSignals = await collectAgenticPageSignals(page);
  const categories = [
    scoreWebMcp(resources, pageSignals),
    scoreAccessibilityTree(pageSignals),
    scoreSemanticData(resources),
    scoreLayoutStability(pageSignals),
  ];
  const weighted = categories.reduce((sum, item) => sum + item.score * item.weight, 0);
  const totalWeight = categories.reduce((sum, item) => sum + item.weight, 0);
  return {
    page_url: url,
    score: clampScore(weighted / totalWeight),
    status: scoreStatus(weighted / totalWeight),
    categories,
    pageSignals,
  };
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

  console.log('');
  console.log(`  ${rainbow('╔══════════════════════════════════════════════════════════╗')}`);
  console.log(`  ${rainbow('║')}  ${c.bold}${c.brightCyan}♿ Universal Accessibility Audit${c.reset}                       ${rainbow('║')}`);
  console.log(`  ${rainbow('║')}  ${c.dim}WCAG · axe-core · Agentic Lighthouse · Alt Text${c.reset}        ${rainbow('║')}`);
  console.log(`  ${rainbow('╚══════════════════════════════════════════════════════════╝')}`);
  console.log('');

  if (respectRobots) statusMsg('🤖', c.cyan, `Respecting ${c.bold}robots.txt${c.reset} Disallow rules.`);
  if (auth.httpCredentials) statusMsg('🔑', c.brightMagenta, `HTTP/basic auth credentials configured.`);
  if (auth.formAuth) statusMsg('🔐', c.brightMagenta, `Form-login auth config detected.`);

  phaseHeader('URL Discovery', '🗺️');
  const discoveryStart = Date.now();
  let urls = [];
  if (args.crawl) {
    statusMsg('🕷️', c.cyan, 'Browser crawl mode');
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
    statusMsg('🌐', c.brightGreen, `Crawled ${c.bold}${urls.length}${c.reset} URL(s)`);
  } else if (args["urls-file"]) {
    urls = loadUrlsFromFile(path.resolve(process.cwd(), args["urls-file"]));
    if (robotsCfg.isAllowedUrl) urls = urls.filter((u) => robotsCfg.isAllowedUrl(u));
    statusMsg('📄', c.cyan, `URL file: ${c.bold}${args["urls-file"]}${c.reset} ${c.dim}(${urls.length} URLs)${c.reset}`);
  } else {
    urls = [startUrl];
    statusMsg('🎯', c.cyan, `Single URL: ${c.bold}${startUrl}${c.reset}`);
  }

  if (batchSize > 0 && urls.length > batchSize) {
    urls = urls.slice(0, batchSize);
  }
  phaseDone('URLs ready', Date.now() - discoveryStart);

  phaseHeader('Scan Configuration', '⚙️');
  console.log(`  ${c.brightMagenta}🎯${c.reset} ${c.bold}Start URL:${c.reset}  ${c.brightCyan}${startUrl}${c.reset}`);
  console.log(`  ${c.brightMagenta}📄${c.reset} ${c.bold}Pages:${c.reset}      ${c.brightGreen}${urls.length}${c.reset}`);
  console.log(`  ${c.brightMagenta}📁${c.reset} ${c.bold}Output:${c.reset}     ${c.dim}${outDir}${c.reset}`);
  printStartupAdvisories({ urlCount: urls.length, slowMode, cfAware, crawlDelayMs, retries, backoffMs, batchSize, hasAuth: Boolean(auth.httpCredentials || auth.formAuth) });

  phaseHeader('Page Scanning', '🔍');
  const scanStart = Date.now();
  statusMsg('◐', c.cyan, 'Launching headless browser...');
  const browser = await chromium.launch({ headless: true });
  const contextOptions = { userAgent: "Universal-A11y-Audit (Playwright + axe-core)" };
  if (auth.httpCredentials) contextOptions.httpCredentials = auth.httpCredentials;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  if (auth.formAuth) {
    await maybePerformFormLogin(page, auth.formAuth, slowMode);
  }
  phaseDone('Browser ready', Date.now() - scanStart);
  console.log('');

  const siteResults = [];
  const csvRows = [];
  const imageAltRows = [];
  const agenticRows = [];
  const agenticResults = [];
  const agentResourceCache = new Map();
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
    const shortUrl = decodeUrlForDisplay(url).length > 55 ? decodeUrlForDisplay(url).slice(0, 52) + '...' : decodeUrlForDisplay(url);
    progressLine(idx, urls.length, shortUrl, `${c.dim}ETA:${c.reset} ${c.brightYellow}~${etaBefore}${c.reset}`);
    console.log('');
    const pageResult = { url, ok: true, error: null, axe: null, timestamp: new Date().toISOString() };

    try {
      const nav = await gotoWithRetry(page, url, { slow: slowMode, retries, backoffMs, timeoutMs: 90000, cfAware });
      if (nav.bot && nav.bot.detected) throw new Error(`bot_protection:${nav.bot.type}`);
      if (crawlDelayMs > 0) await sleep(crawlDelayMs);

      try {
        const agentic = await runAgenticLighthouseAudit(page, url, agentResourceCache);
        agenticResults.push(agentic);
        pageResult.agenticLighthouse = agentic;
        for (const category of agentic.categories) {
          agenticRows.push({
            page_url: url,
            overall_score: agentic.score,
            overall_status: agentic.status,
            category: category.category,
            category_label: category.label,
            category_score: category.score,
            category_status: category.status,
            weight: category.weight,
            findings: summarizeAgenticFindings(category.findings),
            evidence: JSON.stringify(category.evidence || {}),
            priority: agenticPriority(category.score),
            importance: agenticImportance(category.score),
            recommendation: category.recommendation,
          });
        }
      } catch (e) {
        console.warn(`    ${c.brightYellow}⚠${c.reset} Agentic scoring skipped ${c.dim}(${String(e?.message || e).slice(0, 60)})${c.reset}`);
      }

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
        console.warn(`    ${c.brightYellow}⚠${c.reset} Alt report skipped ${c.dim}(${String(e?.message || e).slice(0, 60)})${c.reset}`);
      }

      const stopAxeHeartbeat = createHeartbeat(`${c.dim}${decodeUrlForDisplay(url)}${c.reset} ${c.brightCyan}(axe analysis)${c.reset}`, 10000, `${c.dim}ETA:${c.reset} ${c.brightYellow}~${estimateRemaining(completedDurations, i, urls.length)}${c.reset}`);
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
      console.log(`    ${c.brightGreen}✔${c.reset} Done in ${c.brightYellow}${formatElapsed(pageStart)}${c.reset} ${c.dim}|${c.reset} violations: ${pageViolationNodes > 0 ? c.brightRed : c.brightGreen}${pageViolationNodes}${c.reset} ${c.dim}|${c.reset} total: ${c.bold}${totalViolationNodes}${c.reset} ${c.dim}|${c.reset} elapsed: ${c.brightYellow}${formatElapsed(startedAt)}${c.reset}`);
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
      console.log(`    ${c.brightRed}✘${c.reset} Error in ${c.brightYellow}${formatElapsed(pageStart)}${c.reset} ${c.dim}|${c.reset} ${c.brightRed}${pageResult.error.slice(0, 80)}${c.reset} ${c.dim}|${c.reset} elapsed: ${c.brightYellow}${formatElapsed(startedAt)}${c.reset}`);
    }
    siteResults.push(pageResult);
  }

  await browser.close();
  phaseDone('Page scanning', Date.now() - scanStart);

  phaseHeader('Writing Reports', '📝');
  const reportWriteStart = Date.now();
  fs.writeFileSync(path.join(outDir, "a11y-report.json"), JSON.stringify({ runId, scanned: urls, results: siteResults }, null, 2));
  fs.writeFileSync(path.join(outDir, "a11y-violations.csv"), stringify(csvRows, { header: true, columns: [
    "scope","page_url","rule_id","impact","priority","importance","wcag_refs","help","help_url","description","failure_summary","selector_target","html_snippet","is_global_candidate","suggested_github_issue","rule_filter_url","impact_filter_url","page_filter_url","likely_out_of_control","control_notes","recommendation"
  ]}));
  fs.writeFileSync(path.join(outDir, "a11y-image-alts.csv"), stringify(imageAltRows, { header: true, columns: [
    "page_url","image_url","alt_present","alt_text","title_text","locator","readability_score","readability_rating","issues","suggested_alt"
  ]}));
  fs.writeFileSync(path.join(outDir, "agentic-lighthouse-scores.csv"), stringify(agenticRows, { header: true, columns: [
    "page_url","overall_score","overall_status","category","category_label","category_score","category_status","weight","findings","evidence","priority","importance","recommendation"
  ]}));
  fs.writeFileSync(path.join(outDir, "agentic-lighthouse-report.json"), JSON.stringify({ runId, scanned: urls, results: agenticResults }, null, 2));

  const agenticCategoryScores = new Map();
  for (const result of agenticResults) {
    for (const category of result.categories || []) {
      if (!agenticCategoryScores.has(category.category)) agenticCategoryScores.set(category.category, []);
      agenticCategoryScores.get(category.category).push(category.score);
    }
  }
  const agenticSummary = {
    overallScore: clampScore(avg(agenticResults.map((r) => r.score))),
    pagesScored: agenticResults.length,
    categories: Object.fromEntries(Array.from(agenticCategoryScores.entries()).map(([category, scores]) => [category, {
      averageScore: clampScore(avg(scores)),
      minScore: scores.length ? Math.min(...scores) : 0,
      failingPages: scores.filter((score) => score < 70).length,
    }])),
  };

  const meta = {
    runId,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    pagesScanned: urls.length,
    pageErrors,
    violationNodes: csvRows.filter((r) => r.rule_id !== "page_error" && r.rule_id !== "bot_protection").length,
    agenticLighthouse: agenticSummary,
    byImpact: Object.fromEntries(byImpact),
    byRule: Object.fromEntries(byRule),
    topPages: Array.from(byPage.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([url, count]) => ({ url, count })),
  };
  fs.writeFileSync(path.join(outDir, "a11y-run-metadata.json"), JSON.stringify(meta, null, 2));
  try { fs.writeFileSync(path.join(baseOutDir, "latest"), runId, "utf8"); } catch {}

  phaseDone('Reports written', Date.now() - reportWriteStart);

  const totalElapsed = Date.now() - startedAt;
  console.log('');
  console.log(`  ${rainbow('╔══════════════════════════════════════════════════════════╗')}`);
  console.log(`  ${rainbow('║')}  ${c.bold}${c.brightGreen}✨ Scan Complete!${c.reset}                                     ${rainbow('║')}`);
  console.log(`  ${rainbow('╚══════════════════════════════════════════════════════════╝')}`);
  console.log('');
  console.log(`  ${c.brightCyan}📄${c.reset} ${c.bold}Pages${c.reset}         ${c.brightGreen}${urls.length}${c.reset}`);
  console.log(`  ${c.brightCyan}⚠️${c.reset}  ${c.bold}Violations${c.reset}    ${severityColor(meta.violationNodes, 50)}`);
  console.log(`  ${c.brightCyan}🖼️${c.reset}  ${c.bold}Images${c.reset}        ${c.brightGreen}${imageAltRows.length}${c.reset} ${c.dim}alt texts audited${c.reset}`);
  console.log(`  ${c.brightCyan}🤖${c.reset} ${c.bold}Agentic${c.reset}       ${c.brightGreen}${agenticResults.length}${c.reset} ${c.dim}pages scored${c.reset} ${agenticSummary.overallScore >= 0 ? `${c.dim}| avg:${c.reset} ${agenticSummary.overallScore >= 90 ? c.brightGreen : agenticSummary.overallScore >= 70 ? c.brightYellow : c.brightRed}${agenticSummary.overallScore}${c.reset}` : ''}`);
  if (pageErrors) console.log(`  ${c.brightCyan}❌${c.reset} ${c.bold}Errors${c.reset}        ${c.brightRed}${pageErrors}${c.reset} ${c.dim}pages failed${c.reset}`);
  console.log(`  ${c.brightCyan}⏱️${c.reset}  ${c.bold}Time${c.reset}          ${c.brightYellow}${formatDuration(totalElapsed)}${c.reset}`);
  console.log(`  ${c.brightCyan}📁${c.reset} ${c.bold}Output${c.reset}        ${c.dim}${outDir}${c.reset}`);
  console.log('');
  console.log(`  ${rainbow('★ ★ ★')} ${c.dim}Happy auditing!${c.reset} ${rainbow('★ ★ ★')}`);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
