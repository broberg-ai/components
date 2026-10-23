#!/usr/bin/env node
// Thin CLI over checkGreppable: format the report, set the exit code. All the
// judgement lives in the library so a repo can call it from its own test suite
// and get the same verdict.
import { checkGreppable } from "../dist/index.js";

// Unknown flags used to be ignored SILENTLY, so `--cwd /somewhere` ran against
// the CURRENT directory instead — a confident answer about the wrong repo, which
// is this package's own failure class in its own front door. Filed by sanne and
// by our own dogfooding. There are no options; say so and stop.
const args = process.argv.slice(2);
if (args.length) {
  const wantsHelp = args.some((a) => a === "-h" || a === "--help");
  const stream = wantsHelp ? console.log : console.error;
  stream("greppable — is every text file here searchable by a cc-session grep?");
  stream("");
  stream("  Usage: greppable            (run from the repo root, no arguments)");
  stream("");
  stream("  It takes NO options. Directory comes from the current working");
  stream("  directory; use the checkGreppable({ cwd }) library call to point it");
  stream("  elsewhere.");
  if (!wantsHelp) {
    console.error("");
    console.error(`::error::unknown argument(s): ${args.join(" ")} — refusing to run.`);
    console.error("Ignoring them would answer confidently about a directory you did not ask for.");
    process.exit(2);
  }
  process.exit(0);
}

let report;
try {
  report = checkGreppable();
} catch (err) {
  // Outside a git repo this used to throw a raw Node stack with a byte-array
  // dump. The reader needs one sentence, not a core dump.
  const msg = err instanceof Error ? err.message : String(err);
  if (/not a git repository/i.test(msg)) {
    console.error("::error::not a git repository — greppable asks git which files are tracked.");
    console.error("Run it from the root of a git repo.");
    process.exit(2);
  }
  console.error(`::error::could not list tracked files: ${msg.split("\n")[0]}`);
  process.exit(2);
}

// A run that read NOTHING must not report clean (torrent-search-api). The
// coverage sum holds on an empty list, so this is its own check.
if (report.scanned === 0) {
  console.error(
    `::error::read 0 files (${report.candidates} candidates: ${report.tracked} tracked + ${report.untracked} untracked) — refusing to report clean. ` +
      `A green check that never looked is worse than no check, because it closes the question.`,
  );
  console.error("Most likely: run from a directory git does not track, or an empty repo.");
  process.exit(1);
}

// The universe is stated on the SUCCESS line, not only on failure. Before F068.3
// this said "of N tracked files" and was accurate — the word `tracked` carried the
// entire limitation and nobody read it as one. Naming both halves means a reader
// can tell which universe a run walked without consulting a changelog.
console.log(
  `scanned ${report.scanned} of ${report.candidates} files ` +
    `(${report.tracked} tracked + ${report.untracked} untracked, .gitignore honoured)`,
);

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
    "::error::text file(s) that a cc session's grep skips SILENTLY — " +
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

console.log("Every text file here — tracked or not yet added — is searchable by a cc-session grep.");
