#!/usr/bin/env node
// A raw NUL byte in a text file makes grep and ripgrep treat the whole file as
// binary: they report NO MATCH and exit 1, WITHOUT an error. Every grep-based
// sweep over that file is then silently green — testid audits, secret scans,
// convention checks, all of them, and nothing says the file was skipped.
//
// Found in components 2026-08-11 within minutes of cardmem describing the class:
// packages/lens-engine/src/coverage.ts assigned a group-key separator as a
// literal NUL. `grep -c export src/coverage.ts` returned nothing on a 112-line
// file with 6 exports. In buddy the same thing hid a 1963-line file from every
// sweep for 58 days.
//
// The value is the ENCODING, not the byte: written as the six-character escape
// sequence, the runtime string is identical and the file stays greppable.
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
 * is rule 1: it is consulted ONLY for files already found to contain a NUL, so a
 * gap here shows up as noise, never as silence. Exempted files are printed, so
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
  if (m4 === 'PK') return 'zip';
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
  // add an exception — and the exception is then where a real NUL can hide.
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

  const at = buf.indexOf(0);
  if (at < 0) continue;

  const format = binaryFormat(buf);
  if (format) {
    exempt.push(`${file} (${format})`);
    continue;
  }
  offenders.push({ file, at, size: buf.length });
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
  console.error(`::error::${skipped.length} tracked file(s) could not be scanned. A file nobody read is not a file with no NUL:`);
  for (const s of skipped) console.error(`  ${s}`);
  process.exit(1);
}

if (offenders.length) {
  console.error('::error::raw NUL byte in a text file — grep/rg will skip it SILENTLY, so every grep-based audit over it is falsely green.');
  for (const o of offenders) console.error(`  ${o.file} @ byte ${o.at} of ${o.size}`);
  console.error('Fix: write the value as the six-character escape sequence instead of a literal NUL. Identical at runtime, and the file stays greppable.');
  process.exit(1);
}

console.log('No raw NUL bytes in tracked text files.');
