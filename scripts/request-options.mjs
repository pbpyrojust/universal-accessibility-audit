/**
 * Request options shared by the sitemap fetch and the browser scan, read
 * from the environment so every sub-command picks them up without flags.
 *
 * A11Y_EXTRA_HEADERS  Extra HTTP headers sent with every request: a JSON
 *                     object, or "Name: value" pairs separated by newlines
 *                     or semicolons. For protected previews, e.g. Vercel's
 *                     `x-vercel-protection-bypass`.
 * A11Y_WCAG_VERSION   WCAG version for the axe run: "2.2" (default since
 *                     0.3.0), "2.1" or "2.0". Levels A and AA.
 * A11Y_STANDARDS      Extra rule sets on top, comma separated:
 *                       aaa            WCAG level AAA rules axe can test
 *                       section508     US Section 508
 *                       en301549       EN 301 549 (European Accessibility Act)
 *                       best-practice  axe best practices (not WCAG)
 */
export function extraHeaders() {
  const raw = (process.env.A11Y_EXTRA_HEADERS || "").trim();
  if (!raw) return {};
  if (raw.startsWith("{")) {
    try {
      const obj = JSON.parse(raw);
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [String(k).toLowerCase(), String(v)]));
    } catch {
      return {};
    }
  }
  const out = {};
  for (const part of raw.split(/[\n;]+/)) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

const EXTRA_STANDARDS = {
  aaa: ["wcag2aaa", "wcag21aaa"],
  section508: ["section508"],
  en301549: ["EN-301-549"],
  "best-practice": ["best-practice"],
};

/** The WCAG version in effect ("2.0", "2.1" or "2.2"). */
export function wcagVersion() {
  const v = String(process.env.A11Y_WCAG_VERSION || "").trim();
  return v === "2.0" || v === "2.1" ? v : "2.2";
}

/** Extra standards requested in A11Y_STANDARDS (unknown names are ignored). */
export function extraStandards() {
  return String(process.env.A11Y_STANDARDS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s in EXTRA_STANDARDS);
}

/** axe-core rule tags for the chosen WCAG version plus any extra standards. */
export function wcagTags() {
  const version = wcagVersion();
  const tags = ["wcag2a", "wcag2aa"];
  if (version !== "2.0") tags.push("wcag21a", "wcag21aa");
  if (version === "2.2") tags.push("wcag22a", "wcag22aa");
  for (const s of extraStandards()) tags.push(...EXTRA_STANDARDS[s]);
  return [...new Set(tags)];
}
