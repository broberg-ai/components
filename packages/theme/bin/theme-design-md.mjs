#!/usr/bin/env node
/**
 * @broberg/theme design-md CLI — fills the Tailwind v4 gap in @google/design.md.
 *   theme-design-md css   [DESIGN.md]   → prints a Tailwind v4 @theme baseline
 *   theme-design-md check [DESIGN.md]   → WCAG-AA contrast check (exit 1 on fail)
 */
import { readFileSync } from "node:fs";
import { designMdToTailwindV4, checkContrastAA } from "../dist/design-md.js";

const [, , cmd, file = "DESIGN.md"] = process.argv;

function read() {
  try {
    return readFileSync(file, "utf8");
  } catch {
    console.error(`theme-design-md: cannot read ${file}`);
    process.exit(2);
  }
}

if (cmd === "css") {
  process.stdout.write(designMdToTailwindV4(read()));
} else if (cmd === "check") {
  const issues = checkContrastAA(read());
  if (issues.length) {
    console.error("WCAG-AA contrast FAIL:");
    console.error(JSON.stringify(issues, null, 2));
    process.exit(1);
  }
  console.log("WCAG-AA contrast: pass");
} else {
  console.error("usage: theme-design-md css|check [DESIGN.md]");
  process.exit(2);
}
