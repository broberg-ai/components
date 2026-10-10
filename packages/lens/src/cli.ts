// F036.7 — `testid-gaps <dir>`: the CI half of the F086 rule (every interactive
// element carries a data-testid). The same scanner as the daemon's
// POST /lens/testid-gaps (cardmem), so a gate in CI and a self-check on a Mac
// cannot disagree about what a gap is.
//
// Exit codes: 0 = files scanned, no gaps · 1 = gaps (one `file:line` each) ·
// 2 = usage error, or ZERO source files scanned. The last is deliberate (cardmem
// #2489): a wrong path or an empty checkout must not turn the gate green in
// silence.
import { existsSync, statSync } from "node:fs";
import { inventoryInteractiveGaps } from "./testid-gaps.js";

export function runTestidGaps(args: string[], log: (s: string) => void = console.log, err: (s: string) => void = console.error): number {
  const dir = args[0];
  if (!dir || args.length > 1 || dir === "-h" || dir === "--help") {
    err("usage: testid-gaps <dir>   — exit 1 on gaps, 2 when nothing was scanned");
    return 2;
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    err(`testid-gaps: not a directory: ${dir}`);
    return 2;
  }
  const r = inventoryInteractiveGaps(dir);
  for (const g of r.gaps) log(`${g.file}:${g.line}  <${g.element}> without data-testid  ${g.snippet}`);
  // Not a gap by cardmem's rules, but a file the scanner could not see into while
  // it carries handlers — printed so it is not mistaken for clean.
  for (const f of r.unseen_interactive) err(`${f}  not examined: has handlers but no markup the scanner can read (hyperscript?)`);
  if (r.files_scanned === 0) {
    err(`testid-gaps: 0 source files scanned under ${dir} — refusing to report clean.`);
    return 2;
  }
  log(`testid-gaps: ${r.files_scanned} files scanned, ${r.total_gaps} gaps in ${r.files_with_gaps} files.`);
  return r.total_gaps > 0 ? 1 : 0;
}
