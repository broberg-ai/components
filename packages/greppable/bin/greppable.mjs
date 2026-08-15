#!/usr/bin/env node
// Thin CLI over checkGreppable: format the report, set the exit code. All the
// judgement lives in the library so a repo can call it from its own test suite
// and get the same verdict.
import { checkGreppable } from "../dist/index.js";

const report = checkGreppable();

console.log(`scanned ${report.scanned} of ${report.tracked} tracked files`);

if (report.exempt.length) {
  // Printed, never silent: an exemption you cannot see is indistinguishable
  // from a file that was never looked at. The ratio is shown so a signature
  // match that squeaked past on a thin margin is visible rather than implied.
  console.log(`exempt as recognised binary (${report.exempt.length}):`);
  for (const e of report.exempt) {
    console.log(`  ${e.file} (${e.format}, ${(e.ratio * 100).toFixed(1)}% non-text)`);
  }
}

if (report.coverageGap !== 0) {
  console.error(
    `::error::coverage gap — ${report.coverageGap} tracked file(s) were neither scanned nor reported. ` +
      `"0 findings" cannot be trusted from this run.`,
  );
  process.exit(1);
}

if (report.skipped.length) {
  console.error(
    `::error::${report.skipped.length} tracked file(s) could not be scanned. ` +
      `A file nobody read is not a file that greps clean:`,
  );
  for (const s of report.skipped) console.error(`  ${s}`);
  // Two different problems needing two different actions, split because a
  // reader who cannot tell them apart cannot act (fd-sundhed, on 0.1.0): a file
  // we FAILED TO READ is a bug or a permissions problem, while a NON-REGULAR
  // entry is something committed that is not a file — usually a stray gitlink.
  const unreadable = report.skipped.filter((s) => !s.includes("not a regular file")).length;
  const notFiles = report.skipped.length - unreadable;
  if (unreadable) {
    console.error(
      `  → ${unreadable} could not be READ. That is a bug or a permission problem, not your repo's fault.`,
    );
  }
  if (notFiles) {
    console.error(
      `  → ${notFiles} are tracked but are NOT regular files (symlink / submodule / stray gitlink). ` +
        `Remove them from the index, or point them at something real.`,
    );
  }
  process.exit(1);
}

if (report.offenders.length) {
  console.error(
    "::error::tracked text file(s) that a cc session's grep skips SILENTLY — " +
      "every grep-based audit over them is falsely green.",
  );
  for (const o of report.offenders) {
    const where = o.at === null ? "position unknown" : `byte ${o.at} of ${o.size}`;
    const what = o.kind === "nul" ? "raw NUL byte" : "not valid UTF-8 (latin-1?)";
    // Name the near-miss explicitly. A file whose signature says binary but
    // whose bytes say text is the case that used to pass silently, and the
    // reader needs to know which of the two tests disagreed.
    const lookalike = o.format
      ? ` — leading bytes look like ${o.format}, but only ${(o.ratio * 100).toFixed(1)}% of it is` +
        ` non-text, so it is a text file wearing a signature`
      : "";
    console.error(`  ${o.file} — ${what} @ ${where}${lookalike}`);
  }
  console.error(
    "Fix, NUL: write the value as the six-character escape sequence. " +
      "Identical at runtime, and the file stays greppable.",
  );
  console.error(
    "Fix, encoding: re-save as UTF-8 (`iconv -f latin1 -t utf8`). The bytes change; the text does not.",
  );
  process.exit(1);
}

console.log("Every tracked text file is searchable by a cc-session grep.");
