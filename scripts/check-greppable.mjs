#!/usr/bin/env node
// A tracked text file that a cc session's `grep` SILENTLY SKIPS. Every
// grep-based sweep over that file is then falsely green — testid audits, secret
// scans, convention checks — and nothing says the file was skipped.
//
// WHAT ACTUALLY CAUSES IT — measured 2026-08-11, four isolated cells:
//
//   In a cc session `grep` is not /usr/bin/grep. It is a bash FUNCTION the
//   harness installs, which execs the claude binary in ugrep mode with the flag
//   `-I` (ignore binary files). Same binary, same file, only -I differs:
//
//     file with a NUL      + -I  → exit 1, no output      ← blind
//     file with a NUL      - -I  → 1
//     valid UTF-8 file     + -I  → 1
//     valid UTF-8 file     - -I  → 1
//
//   `/usr/bin/grep`, `command grep` and `rg` ALL find the match. Only the shim
//   every agent reaches for by default goes blind, and it does so with no error.
//
// AND "CONTAINS A NUL" IS ONLY HALF THE CLASS. The shim is ugrep, and ugrep's
// -I calls a file binary if it is not valid UTF-8 — not only if it holds a NUL.
// So a Danish text file saved as latin-1 (`ø` as the single byte 0xF8, no NUL
// anywhere) is invisible to every cc session's grep too. In a fleet whose repos
// are full of Danish strings, legacy exports and CSVs from Danish systems, that
// is the likelier half, and a NUL-only guard passes all of it.
//
// -I IS NOT ONE BEHAVIOUR. It means different things in different programs, and
// that is why two sessions measured this and got opposite answers — both were
// right about their own binary. Full matrix on this machine, ugrep 7.5.0,
// LANG=da_DK.UTF-8, pattern on a line of its own and on the bad line, same
// result either way:
//
//                      grep(shim)   /usr/bin/grep   grep -I   LC_ALL=C   rg
//   NUL byte           MISSES       1               MISSES    1          1
//   latin-1, no NUL    MISSES       1               1         1          1
//
// GNU/BSD -I keys on NUL alone; ugrep -I keys on UTF-8 validity as well. Hence
// the predicate here is the UNION — NUL **or** invalid UTF-8. Building it on
// UTF-8 validity alone would exempt the very file we started from, because a
// NUL is perfectly valid UTF-8 (U+0000 is a legal code point, measured: the NUL
// file decodes cleanly and is still invisible). Two ways to get this wrong, and
// each looks like the fix for the other.
//
// WHO IS ACTUALLY EXPOSED — worth stating, so nobody audits the wrong thing:
// this is the INTERACTIVE session's reflex, not the pipeline. CI jobs, shell
// scripts and hooks that call the system grep were never affected. The blind
// spot is in the chat window.
//
// TO VERIFY A NEGATIVE RESULT, USE `rg` — not `command grep`. That was the first
// advice and it is not safe: on a Mac with Homebrew's ugrep first in PATH, the
// plain `grep` a session bypasses the shim to reach IS ugrep, so the fallback
// has the exact property it was meant to escape. A recommendation cannot see
// which binary is in front on someone else's machine. `rg` found every case in
// every cell of the matrix above; `grep -a` also works on a known GNU/BSD grep.
//
// Found in components within minutes of cardmem describing the class:
// packages/lens-engine/src/coverage.ts assigned a group-key separator as a
// literal NUL, and `grep -c export src/coverage.ts` returned nothing on a
// 112-line file with 6 exports. In buddy the same thing hid a 1963-line file
// from every sweep for 58 days.
//
// This guard flagged ITS OWN SOURCE on first CI run, because the comment above
// originally contained a literal NUL while explaining literal NULs. Left in the
// record: the class is easy to reintroduce precisely because nothing renders it.
//
// THREE RULES, all consumer-filed, all load-bearing:
//
//  1. NO EXCEPTION LIST UP FRONT — cardmem. Scan everything tracked, classify
//     AFTER. An extension allow-list silently shrinks what you looked at (their
//     first version listed .svg as binary; 31 files went unmeasured and the run
//     still said "clean"). Classification here only ever INTERPRETS a hit that
//     has already been measured, so an unknown format can produce a false alarm
//     — loud, self-correcting — and never a silent skip.
//
//  2. THE CHECK PROVES ITS OWN COVERAGE — buddy. scanned + skipped === tracked.
//     Without it, "0 findings" and "0 files examined" are the same output, which
//     is the exact failure being guarded against.
//
//  3. NON-REGULAR FILES ARE COUNTED AND NAMED, NOT SWALLOWED — fds. `git
//     ls-files` also lists symlinks and submodule pointers; reading them throws
//     or returns something other than you think. A guard that skips something
//     quietly has the very property it exists to expose.
import { execSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';

const tracked = execSync('git ls-files', { maxBuffer: 64 * 1024 * 1024 })
  .toString()
  .split('\n')
  .filter(Boolean);

/**
 * Recognised binary containers, decided from the file's own leading bytes rather
 * than from its name. buddy's fair objection: this is still a dictionary, just
 * of signatures instead of extensions. It is — the difference is only that it
 * does not need updating when someone invents a file name. What keeps it honest
 * is rule 1: it is consulted ONLY for files already found to be unsearchable, so
 * a gap here shows up as noise, never as silence. Exempted files are printed, so
 * an exemption is always visible.
 */
function binaryFormat(buf) {
  const b = buf.subarray(0, 8);
  const m4 = buf.subarray(0, 4).toString('latin1');
  const ftyp = buf.subarray(4, 12).toString('latin1');
  if (b[0] === 0x89 && m4.slice(1) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (m4 === 'wOFF' || m4 === 'wOF2') return 'woff';
  if (m4 === 'glTF') return 'glb';
  if (m4 === 'OTTO' || (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00)) return 'font';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'ico';
  if (ftyp.startsWith('ftyp')) return 'isobmff'; // heic/mp4/mov
  if (m4 === 'RIFF') return 'riff'; // wav/webp/avi
  if (m4 === 'PK') return 'zip';
  if (buf.subarray(0, 6).toString('latin1') === 'SQLite') return 'sqlite';
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
  // DOS EPS binary header — filed by fds, whose Illustrator export was otherwise
  // reported as a suspicious text file. A false positive in a CI guard becomes
  // "known noise" and is then ignored on the day it is right.
  if (b[0] === 0xc5 && b[1] === 0xd0 && b[2] === 0xd3 && b[3] === 0xc6) return 'eps';
  // %PDF — filed by upmetrics, whose .ai logo is a PDF inside. `.ai` appears on
  // no ordinary binary-extension list, so an extension-based guard would have
  // called it a suspicious text file. That is the expensive kind of noise: a
  // false positive in a hygiene check is what makes someone switch it off, or
  // add an exception — and the exception is then where a real defect can hide.
  if (m4 === '%PDF') return 'pdf';
  if (m4.startsWith('ID3')) return 'mp3';
  // Raw MPEG frame-sync — an mp3 with NO ID3 tag, which is what Azure TTS and
  // most streaming endpoints return. Filed by ai-sdk, whose ten committed voice
  // samples were all reported as suspicious text files by a list that had ID3
  // and stopped there. 11 bits of sync (FF Ex/Fx) rather than a fixed byte pair,
  // so it covers MPEG-1/2/2.5 at any layer.
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mpeg-audio';
  // OLE2 compound file — every .doc/.xls/.ppt saved before 2007, plus a lot of
  // exported assets. Filed by xrt81 after three of their song documents came
  // back as false positives.
  if (
    b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 &&
    b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1
  ) return 'ole2';
  return null;
}

/**
 * Fraction of bytes that are not ordinary text (printable ASCII + tab/LF/CR).
 *
 * THE SIGNATURE TABLE ALONE IS NOT ENOUGH, and this is the hole ai-sdk's rule
 * predicted: an exemption decided by FORM (leading bytes) does not measure the
 * SUBSTANCE (is this a searchable text file). Measured here — a latin-1 note
 * about PDF headers, whose first four bytes are literally `%PDF`, was silently
 * exempted as a pdf while a cc-session grep could not read it, and the guard
 * still printed "every tracked text file is searchable".
 *
 * So a file must fail BOTH tests to be exempt: a binary signature AND actually
 * looking like binary. Measured over this repo's real binaries and the
 * lookalike — 56.5% / 56.6% / 63.8% / 77.4% against 1.85%, a factor of 30. The
 * threshold sits far from both edges of that gap rather than being chosen by
 * feel.
 *
 * Known and accepted consequence: an UNCOMPRESSED pdf is largely ASCII and will
 * be flagged. That is noise, which rule 1 exists to prefer — a false alarm is
 * loud and self-correcting, a silent skip is neither.
 */
function nonTextRatio(buf) {
  let n = 0;
  for (const b of buf) {
    if (b === 9 || b === 10 || b === 13) continue;
    if (b >= 0x20 && b <= 0x7e) continue;
    n += 1;
  }
  return n / (buf.length || 1);
}

const BINARY_RATIO = 0.1;

/**
 * Byte index of the first sequence that is not valid UTF-8, or -1.
 *
 * The VERDICT comes from TextDecoder, which is the platform's own decoder and
 * cannot drift from what "valid UTF-8" means. This walker exists only to say
 * WHERE, because "somewhere in a 3000-line file" is not actionable. If the two
 * ever disagree the position is reported as unknown rather than guessed — a
 * position I made up would be worse than none.
 */
function firstInvalidUtf8(buf) {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b < 0x80) { i += 1; continue; }
    let need;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) need = 2;
    else if (b >= 0xf0 && b <= 0xf4) need = 3;
    else return i; // 0x80–0xc1 and 0xf5–0xff are never a lead byte
    if (i + need >= buf.length) return i; // sequence truncated at EOF
    for (let k = 1; k <= need; k += 1) {
      const c = buf[i + k];
      if (c < 0x80 || c > 0xbf) return i;
    }
    const c1 = buf[i + 1];
    if (b === 0xe0 && c1 < 0xa0) return i; // overlong
    if (b === 0xed && c1 > 0x9f) return i; // UTF-16 surrogate half
    if (b === 0xf0 && c1 < 0x90) return i; // overlong
    if (b === 0xf4 && c1 > 0x8f) return i; // beyond U+10FFFF
    i += need + 1;
  }
  return -1;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

/** Why a cc-session grep would skip this file, or null if it would read it. */
function unsearchableReason(buf) {
  const nul = buf.indexOf(0);
  if (nul >= 0) return { kind: 'nul', at: nul };
  try {
    decoder.decode(buf);
    return null;
  } catch {
    const at = firstInvalidUtf8(buf);
    return { kind: 'utf8', at: at >= 0 ? at : null };
  }
}

let scanned = 0;
const skipped = [];
const exempt = [];
const offenders = [];

for (const file of tracked) {
  let stat;
  try {
    stat = lstatSync(file);
  } catch (err) {
    skipped.push(`${file} (lstat: ${err.code ?? err.message})`);
    continue;
  }
  if (!stat.isFile()) {
    skipped.push(`${file} (not a regular file — symlink or submodule pointer)`);
    continue;
  }

  let buf;
  try {
    buf = readFileSync(file);
  } catch (err) {
    skipped.push(`${file} (read: ${err.code ?? err.message})`);
    continue;
  }
  scanned += 1;

  const reason = unsearchableReason(buf);
  if (!reason) continue;

  const format = binaryFormat(buf);
  const ratio = nonTextRatio(buf);
  if (format && ratio >= BINARY_RATIO) {
    // The ratio is printed, not just used: a reader can see how far from the
    // line each exemption sits, and a signature match that squeaked past on a
    // thin margin is visible instead of implied.
    exempt.push(`${file} (${format}, ${(ratio * 100).toFixed(1)}% non-text)`);
    continue;
  }
  offenders.push({ file, ...reason, size: buf.length, format, ratio });
}

console.log(`scanned ${scanned} of ${tracked.length} tracked files`);
if (exempt.length) {
  // Printed, never silent: an exemption you cannot see is indistinguishable
  // from a file that was never looked at.
  console.log(`exempt as recognised binary (${exempt.length}):`);
  for (const e of exempt) console.log(`  ${e}`);
}

if (scanned + skipped.length !== tracked.length) {
  console.error(`::error::coverage gap — ${tracked.length - scanned - skipped.length} tracked files were neither scanned nor reported. "0 findings" cannot be trusted from this run.`);
  process.exit(1);
}
if (skipped.length) {
  console.error(`::error::${skipped.length} tracked file(s) could not be scanned. A file nobody read is not a file that greps clean:`);
  for (const s of skipped) console.error(`  ${s}`);
  process.exit(1);
}

if (offenders.length) {
  console.error("::error::tracked text file(s) that a cc session's grep skips SILENTLY — every grep-based audit over them is falsely green.");
  for (const o of offenders) {
    const where = o.at === null ? 'position unknown' : `byte ${o.at} of ${o.size}`;
    const what = o.kind === 'nul' ? 'raw NUL byte' : 'not valid UTF-8 (latin-1?)';
    // Name the near-miss explicitly. A file whose signature says binary but
    // whose bytes say text is the case that used to pass silently, and the
    // reader needs to know which of the two tests disagreed.
    const lookalike = o.format
      ? ` — leading bytes look like ${o.format}, but only ${(o.ratio * 100).toFixed(1)}% of it is non-text, so it is a text file wearing a signature`
      : '';
    console.error(`  ${o.file} — ${what} @ ${where}${lookalike}`);
  }
  console.error('Fix, NUL: write the value as the six-character escape sequence. Identical at runtime, and the file stays greppable.');
  console.error('Fix, encoding: re-save as UTF-8 (`iconv -f latin1 -t utf8`). The bytes change; the text does not.');
  process.exit(1);
}

console.log('Every tracked text file is searchable by a cc-session grep.');
