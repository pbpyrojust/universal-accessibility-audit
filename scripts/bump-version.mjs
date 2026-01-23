#!/usr/bin/env node
/**
 * Bump patch version in package.json (semver: MAJOR.MINOR.PATCH).
 * Intended to run via Husky pre-commit hook so each commit increments the version.
 */
import fs from "node:fs";
import path from "node:path";

const pkgPath = path.resolve(process.cwd(), "package.json");
const raw = fs.readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(raw);

const current = String(pkg.version || "0.1.0");
const m = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!m) {
  console.error(`Unsupported version format: "${current}". Expected MAJOR.MINOR.PATCH.`);
  process.exit(1);
}

const major = Number(m[1]);
const minor = Number(m[2]);
const patch = Number(m[3]) + 1;

const next = `${major}.${minor}.${patch}`;
pkg.version = next;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log(`Bumped version: ${current} -> ${next}`);
