// F081.1 — a mutated working tree must announce itself.
//
// A mutation harness deliberately puts BROKEN code on disk for a few seconds at
// a time: a security branch rewritten to `if (false)`, a fallback deleted, a
// threshold moved. Then it restores it. While it runs, the working tree is not a
// source of truth — and until this file existed, nothing said so.
//
// Two failures this closes, and they are different sizes:
//
//   THE SMALL ONE (cost: time). Someone reads `git diff` mid-run and sees a
//   defect that is not there. Measured 2026-09-01: I chased a disabled
//   `valueOnly` branch in secret-scan for several minutes. Neither commit in the
//   window captured it, and one that had would have gone red in CI.
//
//   THE LARGE ONE (cost: a green run over a broken tree). A restore that FAILS
//   is indistinguishable from a restore that was not needed. buddy's harness did
//   exactly this on its very first run (2026-08-14): a `cd` inside the test
//   command moved the working directory, the restore's relative path pointed at
//   nothing, and the alarm went to stderr and vanished into the test output. The
//   script committed the error it exists to prevent.
//
// So: the marker is a courtesy, and the READ-BACK is the guard. Do not mistake
// the first for the second.
//
// THE MARKER IS FOR A HUMAN OR AN AGENT WHO FALLS OVER IT — including one from
// another repo, which is buddy's point: when they read our diff, they are IN our
// repo, so the file is already visible to them while a commit hook's message is
// not. That is why the name is a fleet convention rather than our private
// detail, and why the contents name the harness, the file and the PID.
//
// WHY IT IS A DIRECTORY AND NOT A FILE — measured, after building it as a file
// first. `turbo run test` runs packages in PARALLEL, so several harnesses hold
// the marker at once. With one shared file, the FIRST to finish removed it for
// everyone still mutating, and the window silently reopened. One entry per PID
// has no such race and needs no locking. So the test is `-e .mutation-running`
// (exists), never `-f` — a reader checking for a regular file gets a false
// all-clear.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Same name in every repo, so a reader's check is one stat call. */
export const MARKER_NAME = ".mutation-running";

// ABSOLUTE, derived from this module's own location — never a relative path and
// never process.cwd(). A `cd` inside a test command moves the working directory
// under a running harness, and that is precisely how buddy lost a file.
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MARKER_PATH = join(REPO_ROOT, MARKER_NAME);

const entryPath = (pid = process.pid) => join(MARKER_PATH, String(pid));
const rel = (p) => relative(REPO_ROOT, p) || p;

/** Every entry currently in the marker, newest first. Used by the hook + tests. */
export function readMarker() {
  if (!existsSync(MARKER_PATH)) return [];
  return readdirSync(MARKER_PATH)
    .map((pid) => {
      try {
        return readFileSync(join(MARKER_PATH, pid), "utf8");
      } catch {
        return null; // it finished between the listing and the read
      }
    })
    .filter(Boolean);
}

/**
 * Write (or update) THIS process's entry. Call BEFORE the first mutation — an
 * entry written after it leaves open the exact window it exists to close.
 */
export function writeMarker({ harness, file, note }) {
  mkdirSync(MARKER_PATH, { recursive: true });
  const body =
    `A mutation harness is running in this repo RIGHT NOW.\n` +
    `\n` +
    `  harness  ${harness}\n` +
    `  file     ${rel(file)}\n` +
    `  pid      ${process.pid}\n` +
    `  since    ${new Date().toISOString()}\n` +
    (note ? `\n${note}\n` : "") +
    `\n` +
    `WHAT THIS MEANS FOR YOU: the file above may currently hold DELIBERATELY\n` +
    `BROKEN code — a guard rewritten to \`if (false)\`, a branch deleted. A diff\n` +
    `you read right now can show a defect that does not exist in the source.\n` +
    `It is restored when the harness finishes, and this entry goes with it.\n` +
    `\n` +
    `Commits are refused while this exists (.githooks/pre-commit).\n`;
  writeFileSync(entryPath(), body);
}

/**
 * Remove THIS process's entry, and the directory once it is the last one.
 *
 * Only its own — a harness that cleared the whole marker would un-announce every
 * OTHER harness still mutating, which is the race this design exists to avoid.
 */
export function clearMarker() {
  rmSync(entryPath(), { force: true });
  try {
    if (existsSync(MARKER_PATH) && readdirSync(MARKER_PATH).length === 0) {
      rmSync(MARKER_PATH, { recursive: true, force: true });
    }
  } catch {
    // Another harness wrote an entry between the read and the remove. Leaving
    // the directory standing is the safe direction: it keeps the block up.
  }
}

/**
 * The guard. Read the file back after restoring it and compare byte-for-byte to
 * what was read at the start.
 *
 * ON MISMATCH IT DOES NOT RETURN: it rewrites this process's entry to say the
 * restore FAILED (so the commit block stays up over a tree that is genuinely
 * broken), prints on STDOUT, and exits non-zero.
 *
 * STDOUT, deliberately. buddy's alarm went to stderr and was swallowed by the
 * test output — a failure that is written down and not read is the same as one
 * that was never written.
 */
export function assertRestored({ harness, file, expected }) {
  const actual = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (actual === expected) return;

  writeMarker({
    harness,
    file,
    note:
      `!! THE RESTORE FAILED. This is not a run in progress — the file above is\n` +
      `!! LEFT MUTATED on disk and no harness is coming back to fix it.\n` +
      `!!\n` +
      `!!   git checkout -- ${rel(file)}     (safe here: nothing was staged)\n` +
      `!!   rm -r ${MARKER_NAME}`,
  });

  console.log("");
  console.log(`::error::RESTORE FAILED — ${rel(file)} is still mutated on disk.`);
  console.log(`  harness : ${harness}`);
  console.log(
    actual === null
      ? "  the file does not exist after the restore"
      : `  ${actual.length} bytes on disk, ${expected.length} expected`,
  );
  console.log("");
  console.log("  A harness that cannot put the file back has done the exact damage");
  console.log("  it exists to prevent. Stopping here rather than reporting a result");
  console.log("  measured against a tree nobody can trust.");
  console.log("");
  console.log(`  git checkout -- ${rel(file)}`);
  console.log(`  rm -r ${MARKER_NAME}`);
  console.log("");
  process.exit(1);
}
