#!/usr/bin/env node
// i18n-fill <base.json> <target.json> --from da --to en [--write]
// Fills ONLY the keys missing in target, via @broberg/ai-sdk on the EU route.
// Without --write it prints what it would add and changes nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { fillMissing } from "../dist/llm.js";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const [basePath, targetPath] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const from = flag("--from"), to = flag("--to");
if (!basePath || !targetPath || !from || !to) {
  console.error("usage: i18n-fill <base.json> <target.json> --from <lang> --to <lang> [--write]");
  process.exit(2);
}
let createAI;
try {
  ({ createAI } = await import("@broberg/ai-sdk"));
} catch {
  console.error("i18n-fill needs @broberg/ai-sdk installed in this project (npm i @broberg/ai-sdk).");
  process.exit(2);
}
const base = JSON.parse(readFileSync(basePath, "utf8"));
const target = JSON.parse(readFileSync(targetPath, "utf8"));
const { result, filled, rejected } = await fillMissing({ base, target, from, to, ai: createAI() });
console.log(`filled ${filled.length}: ${filled.join(", ") || "-"}`);
for (const r of rejected) console.log(`rejected ${r.key}: ${r.reason}${r.got ? ` (got: ${r.got})` : ""}`);
if (args.includes("--write")) writeFileSync(targetPath, JSON.stringify(result, null, 2) + "\n");
else if (filled.length) console.log("(dry run — pass --write to save)");
process.exit(rejected.length ? 1 : 0);
