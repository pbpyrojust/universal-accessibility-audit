#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

function run(script, args) {
  const scriptPath = path.join(root, "scripts", script);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

function printHelp() {
  console.log(`universal-a11y-audit

Usage:
  universal-a11y-audit <command> [options]

Commands:
  audit                 Full workflow: build URLs, scan, summary, ticket/backlog CSV
  build-urls            Build a URL list from sitemap discovery
  scan                  Run the Playwright + axe-core scan from a URL list or crawl mode
  report                Generate the docs-ready summary report
  tickets               Generate the ticket/backlog CSV
  sitemap-xml-to-urls   Convert a browser-saved sitemap XML file into urls.txt
  help                  Show this help
  version               Show package version

Examples:
  universal-a11y-audit audit --site https://www.example.com
  universal-a11y-audit build-urls --site https://www.example.com --out ./reports/urls.txt
  universal-a11y-audit scan --urls-file ./reports/urls.txt --out-dir ./reports
  universal-a11y-audit sitemap-xml-to-urls --input ./saved-sitemap.xml --out ./reports/urls.txt

If no command is provided, the CLI defaults to 'audit'.
`);
}

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "audit";
const rest = command === "audit" ? (argv[0] === "audit" ? argv.slice(1) : argv) : argv.slice(1);

switch (command) {
  case "audit":
    run("run-audit.mjs", rest);
    break;
  case "build-urls":
    run("build-urls-from-sitemap.mjs", rest);
    break;
  case "scan":
    run("a11y-audit.mjs", rest);
    break;
  case "report":
    run("generate-google-doc-report.mjs", rest);
    break;
  case "tickets":
    run("generate-ticket-csv.mjs", rest);
    break;
  case "sitemap-xml-to-urls":
    run("convert-sitemap-xml-to-urls.mjs", rest);
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  case "version":
  case "--version":
  case "-v":
    console.log("0.2.0");
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
