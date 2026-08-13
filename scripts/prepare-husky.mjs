#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const gitConfigPath = path.resolve(process.cwd(), ".git", "config");

function canWriteGitConfig() {
  try {
    fs.accessSync(gitConfigPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

if (process.env.CI || !fs.existsSync(path.resolve(process.cwd(), ".git")) || !canWriteGitConfig()) {
  console.log("Skipping Husky setup outside a writable local git checkout.");
  process.exit(0);
}

const result = spawnSync("husky", { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
