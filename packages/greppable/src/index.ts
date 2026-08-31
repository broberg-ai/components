// @broberg/greppable — find the tracked text files your grep silently skips.
//
// THE DEFECT. In a cc session `grep` is not /usr/bin/grep. It is a bash function
// the harness installs, which execs the claude binary in ugrep mode with the
// flag `-I` (ignore binary). On a file it decides is binary it prints NOTHING
// and exits 1 — indistinguishable from "no matches". So every grep-based sweep
// over that file is falsely green: testid audits, secret scans, convention
// checks, all of them, and nothing says a file was skipped.
//
// Real cost, not hypothetical: in `buddy` a 1963-line file was invisible to
// every sweep for 58 days. In `components`, `grep -c export` on a 112-line file
// with 6 exports returned nothing.
//
// THE PREDICATE IS A UNION: a raw NUL byte **OR** not valid UTF-8. Both halves
// are load-bearing, and each looks like the fix for the other — which is why
// three of the nine repos that hand-rolled this check got it wrong on
// 2026-08-11, in both directions:
//
//   contains a NUL      misses a latin-1 file (`ø` = 0xF8, no NUL anywhere)
//   not valid UTF-8     misses a NUL file — **U+0000 is legal UTF-8**, so the
//                       decoder accepts it and the guard clears the very file
//                       the investigation started from
//
// `-I` IS NOT ONE BEHAVIOUR either, which is why two sessions measured this and
// got opposite answers — both were right about their own binary:
//
//                      grep(shim)   /usr/bin/grep   grep -I   LC_ALL=C   rg
//   NUL byte           MISSES       1               MISSES    1          1
//   latin-1, no NUL    MISSES       1               1         1          1
//
// GNU/BSD `-I` keys on NUL alone; ugrep `-I` keys on UTF-8 validity as well.
// Checking the union means this package does not need to know which binary is
// in front on a given machine.
//
// WHO IS EXPOSED: the interactive session, not the pipeline. CI jobs, shell
// scripts and hooks calling the system grep were never affected. To verify a
// negative result by hand, use `rg` — not `command grep`, which on a Mac with
// Homebrew's ugrep first in PATH lands on the very tool being escaped.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";

export interface GreppableOffender {
  /** Repo-relative path, as `git ls-files` reports it. */
  file: string;
  /** Which half of the union caught it. */
  kind: "nul" | "utf8";
  /** Byte offset of the first offending sequence, or null if it could not be
   *  located. Never guessed — a made-up position is worse than none. */
  at: number | null;
  size: number;
  /** A binary signature the leading bytes matched, if any. Present on an
   *  offender means a text file was wearing a signature — the near-miss case. */
  format: string | null;
  /** Fraction of bytes that are not ordinary text. */
  ratio: number;
}

export interface GreppableExemption {
  file: string;
  format: string;
  ratio: number;
}

export interface GreppableReport {
  /** Files git has under version control. */
  tracked: number;
  /** Files that exist and are NOT ignored, but have not been `git add`ed yet.
   *  Included since F068.3 — in a pre-commit hook the file that matters is new,
   *  so a guard that skipped these was blind exactly where it is called. */
  untracked: number;
  /** The universe actually walked: tracked + untracked. `.gitignore` is honoured,
   *  so node_modules/ and dist/ are in neither number. */
  candidates: number;
  /** Files actually read. */
  scanned: number;
  /** Files that could not be read, each with the reason. NEVER silent: a file
   *  nobody read is not a file that greps clean. */
  skipped: string[];
  /** Recognised binaries, printed rather than dropped — an exemption you cannot
   *  see is indistinguishable from a file that was never looked at. */
  exempt: GreppableExemption[];
  offenders: GreppableOffender[];
  /** candidates - scanned - skipped. Non-zero means the run cannot account for
   *  every file, so "0 offenders" cannot be trusted from it. */
  coverageGap: number;
  /** True only when every tracked file was accounted for, at least one file was
   *  actually READ, and none is invisible. A run with a coverage gap, an
   *  unreadable file, or ZERO files scanned is NOT ok even with zero offenders —
   *  that is the exact failure this package exists to expose. The `scanned > 0`
   *  clause is separate on purpose: the coverage sum alone holds on an empty
   *  list (0 + 0 === 0), so it cannot catch a run that never looked. */
  ok: boolean;
}

/**
 * Recognised binary containers, decided from a file's own leading bytes rather
 * than from its name. This is still a dictionary, just of signatures instead of
 * extensions — the difference is that it needs no updating when someone invents
 * a file name, and that it is consulted ONLY for files already measured as
 * unsearchable. A gap here therefore shows up as noise, never as silence.
 *
 * Every entry after the first eight was filed by a repo whose real asset was
 * reported as a suspicious text file. That history is the argument for one
 * shared list: a false positive in a CI guard becomes "known noise", and known
 * noise gets ignored on the day it is right.
 */
export function binaryFormat(buf: Buffer): string | null {
  const b = buf.subarray(0, 8);
  const m4 = buf.subarray(0, 4).toString("latin1");
  const ftyp = buf.subarray(4, 12).toString("latin1");
  if (b[0] === 0x89 && m4.slice(1) === "PNG") return "png";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (m4 === "wOFF" || m4 === "wOF2") return "woff";
  if (m4 === "glTF") return "glb";
  if (m4 === "OTTO" || (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00)) return "font";
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return "ico";
  if (ftyp.startsWith("ftyp")) return "isobmff"; // heic/mp4/mov
  if (m4 === "RIFF") return "riff"; // wav/webp/avi
  if (m4 === "PK") return "zip";
  if (buf.subarray(0, 6).toString("latin1") === "SQLite") return "sqlite";
  if (b[0] === 0x1f && b[1] === 0x8b) return "gzip";
  // DOS EPS header — filed by fds, whose Illustrator export was otherwise
  // reported as suspicious.
  if (b[0] === 0xc5 && b[1] === 0xd0 && b[2] === 0xd3 && b[3] === 0xc6) return "eps";
  // %PDF — filed by upmetrics, whose .ai logo is a PDF inside. `.ai` appears on
  // no ordinary binary-extension list.
  if (m4 === "%PDF") return "pdf";
  if (m4.startsWith("ID3")) return "mp3";
  // Raw MPEG frame-sync — an mp3 with NO ID3 tag, which is what Azure TTS and
  // most streaming endpoints return. Filed by ai-sdk, whose ten committed voice
  // samples were all flagged by a list that had ID3 and stopped there. 11 bits
  // of sync rather than a fixed byte pair, so it covers MPEG-1/2/2.5 any layer.
  if (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return "mpeg-audio";
  // OLE2 compound file — every .doc/.xls/.ppt saved before 2007. Filed by xrt81
  // after three of their song documents came back as false positives.
  if (
    b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 &&
    b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1
  ) return "ole2";
  return null;
}

/**
 * Fraction of bytes that are not ordinary text (printable ASCII + tab/LF/CR).
 *
 * THE SIGNATURE TABLE ALONE IS NOT ENOUGH. An exemption decided by FORM (leading
 * bytes) does not measure the SUBSTANCE (is this a searchable text file).
 * Measured: a latin-1 note about PDF headers, whose first four bytes are
 * literally `%PDF`, was exempted as a pdf while grep could not read it — and the
 * guard still reported that every file was searchable.
 *
 * So a file must fail BOTH tests to be exempt. Threshold from measurement rather
 * than feel: real binaries in a fleet repo measured 56.5 / 56.6 / 63.8 / 77.4
 * percent non-text against the lookalike's 1.85 — a factor of thirty, and the
 * line sits far from either edge of that gap.
 */
export function nonTextRatio(buf: Buffer): number {
  let n = 0;
  for (const b of buf) {
    if (b === 9 || b === 10 || b === 13) continue;
    if (b >= 0x20 && b <= 0x7e) continue;
    n += 1;
  }
  return n / (buf.length || 1);
}

/** Below this, a binary signature is not believed. See nonTextRatio. */
export const BINARY_RATIO = 0.1;

/**
 * Byte index of the first sequence that is not valid UTF-8, or -1.
 *
 * The VERDICT comes from TextDecoder, which is the platform's own decoder and
 * cannot drift from what "valid UTF-8" means. This walker exists only to say
 * WHERE, because "somewhere in a 3000-line file" is not actionable. If the two
 * ever disagree the position is reported as unknown rather than guessed.
 */
export function firstInvalidUtf8(buf: Buffer): number {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i]!;
    if (b < 0x80) {
      i += 1;
      continue;
    }
    let need: number;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) need = 2;
    else if (b >= 0xf0 && b <= 0xf4) need = 3;
    else return i; // 0x80–0xc1 and 0xf5–0xff are never a lead byte
    if (i + need >= buf.length) return i; // sequence truncated at EOF
    for (let k = 1; k <= need; k += 1) {
      const c = buf[i + k]!;
      if (c < 0x80 || c > 0xbf) return i;
    }
    const c1 = buf[i + 1]!;
    if (b === 0xe0 && c1 < 0xa0) return i; // overlong
    if (b === 0xed && c1 > 0x9f) return i; // UTF-16 surrogate half
    if (b === 0xf0 && c1 < 0x90) return i; // overlong
    if (b === 0xf4 && c1 > 0x8f) return i; // beyond U+10FFFF
    i += need + 1;
  }
  return -1;
}

/**
 * Why a session's grep would skip this content, or null if it would read it.
 *
 * ORDER MATTERS AND IS NOT COSMETIC: the NUL check runs FIRST, because the
 * decoder accepts a NUL (U+0000 is a legal code point) and would hand back a
 * false all-clear on exactly the file this package was built for. The reverse
 * does not hold — a latin-1 file is caught only by the decoder. Neither check is
 * redundant and neither is sufficient alone.
 */
export function unsearchableReason(buf: Buffer): { kind: "nul" | "utf8"; at: number | null } | null {
  const nul = buf.indexOf(0);
  if (nul >= 0) return { kind: "nul", at: nul };
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return null;
  } catch {
    const at = firstInvalidUtf8(buf);
    return { kind: "utf8", at: at >= 0 ? at : null };
  }
}

export interface CheckGreppableOptions {
  /** Repo root. Defaults to the current working directory. */
  cwd?: string;
}

/**
 * Scan every file `git ls-files` reports and return what a session's grep cannot
 * see.
 *
 * THREE RULES BAKED IN, all consumer-filed, all load-bearing:
 *
 *  1. NO EXCEPTION LIST UP FRONT. Scan everything tracked, classify AFTER. An
 *     extension allow-list silently shrinks what you looked at — cardmem's first
 *     version listed .svg as binary, 31 files went unmeasured, and the run still
 *     said "clean". Classification here only ever INTERPRETS a hit that has
 *     already been measured.
 *
 *  2. THE CHECK PROVES ITS OWN COVERAGE. scanned + skipped === tracked. Without
 *     it, "0 findings" and "0 files examined" are the same output, which is the
 *     exact failure being guarded against.
 *
 *  3. NON-REGULAR FILES ARE COUNTED AND NAMED, NOT SWALLOWED. `git ls-files`
 *     also lists symlinks and submodule pointers; reading them throws or returns
 *     something other than you think. A guard that skips something quietly has
 *     the very property it exists to expose.
 */
export function checkGreppable(options: CheckGreppableOptions = {}): GreppableReport {
  const cwd = options.cwd ?? process.cwd();
  // `-z` + split on NUL, NOT newline. Filed by fd-sundhed against 0.1.0 with a
  // complete correlation: 1130 tracked files, exactly 2 with a non-ASCII name,
  // exactly those 2 failed.
  //
  // git's default `core.quotepath=true` C-QUOTES any path containing a non-ASCII
  // byte — INCLUDING the surrounding double quotes. So a Danish filename came
  // back as the literal 15-character-longer string
  //     "pitch/…/AAK_logo_RGB_Bl\303\245.eps"
  // and lstat on that (quotes and backslashes and all) is ENOENT while the file
  // sits happily on disk.
  //
  // It was NOT a normalisation problem, which was their first hypothesis and
  // would have been mine: one of the two files is NFD on disk and the other NFC,
  // and BOTH failed — so normalisation cannot be the cause. The measurement
  // killed the plausible explanation.
  //
  // `-z` is the stronger fix rather than `-c core.quotepath=false`: it also
  // survives a filename containing a newline, which no amount of quoting config
  // helps with. In a Danish fleet a path with æ/ø/å is the norm, not an edge
  // case, so this made the package unable to complete a clean run on most repos.
  // `--cached --others --exclude-standard` — the universe includes files that
  // exist but have not been `git add`ed yet (F068.3, filed by beacon).
  //
  // `git ls-files -z` alone lists only TRACKED files, and this package's most
  // obvious use is a pre-commit hook, where the interesting file is NEW BY
  // DEFINITION. So the guard was blind exactly where it is called. beacon's own
  // guard proved it: they ran it (313 files, all visible), staged AFTERWARDS, and
  // the one file the commit was about — carrying a real NUL — was the only one it
  // never looked at. Their sentence for it: a counter that does not count what you
  // are making is a counter confirming a state you left a minute ago.
  //
  // `--exclude-standard` is LOAD-BEARING, not tidiness: without it .gitignore is
  // ignored too, and node_modules/ + dist/ walk straight in. That would be a worse
  // regression than the bug — so it has its own test and its own mutation.
  const listFiles = (args: string[]) =>
    execFileSync("git", ["ls-files", "-z", ...args], { cwd, maxBuffer: 64 * 1024 * 1024 })
      .toString()
      .split("\0")
      .filter(Boolean);

  const trackedFiles = listFiles(["--cached"]);
  const untrackedFiles = listFiles(["--others", "--exclude-standard"]);
  // Named `candidates`, not `tracked`. It holds BOTH lists, and calling it
  // `tracked` is the exact naming sin this card exists to fix — one word carrying
  // a limitation that stopped being true.
  const candidates = [...trackedFiles, ...untrackedFiles];

  let scanned = 0;
  const skipped: string[] = [];
  const exempt: GreppableExemption[] = [];
  const offenders: GreppableOffender[] = [];

  for (const file of candidates) {
    const abs = `${cwd}/${file}`;
    let stat;
    try {
      stat = lstatSync(abs);
    } catch (err) {
      skipped.push(`${file} (lstat: ${(err as NodeJS.ErrnoException).code ?? String(err)})`);
      continue;
    }
    if (!stat.isFile()) {
      skipped.push(`${file} (not a regular file — symlink or submodule pointer)`);
      continue;
    }

    let buf: Buffer;
    try {
      buf = readFileSync(abs);
    } catch (err) {
      skipped.push(`${file} (read: ${(err as NodeJS.ErrnoException).code ?? String(err)})`);
      continue;
    }
    scanned += 1;

    const reason = unsearchableReason(buf);
    if (!reason) continue;

    const format = binaryFormat(buf);
    const ratio = nonTextRatio(buf);
    if (format && ratio >= BINARY_RATIO) {
      exempt.push({ file, format, ratio });
      continue;
    }
    offenders.push({ file, ...reason, size: buf.length, format, ratio });
  }

  const coverageGap = candidates.length - scanned - skipped.length;
  return {
    tracked: trackedFiles.length,
    untracked: untrackedFiles.length,
    candidates: candidates.length,
    scanned,
    skipped,
    exempt,
    offenders,
    coverageGap,
    // `scanned > 0` is a SEPARATE condition, not a nicety — filed by
    // torrent-search-api, who sharpened our own rule against us. The coverage
    // sum alone still holds on an EMPTY file list (0 + 0 === 0), so a run that
    // read nothing at all reported "0 findings" and exited 0. Measured on 0.1.1:
    //
    //   scanned 0 of 0 tracked files
    //   Every tracked text file is searchable by a cc-session grep.   exit 0
    //
    // The overwhelmingly likely cause is a wrong cwd or a directory git does not
    // track — i.e. exactly when a confident all-clear is most wrong. A green
    // check that never looked is worse than no check, because it closes the
    // question. That is this package's own thesis, and it was sitting inside it.
    ok:
      offenders.length === 0 && skipped.length === 0 && coverageGap === 0 && scanned > 0,
  };
}
