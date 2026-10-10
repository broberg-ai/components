// F036.7 — the interactive-testid gap scanner, moved VERBATIM from cardmem
// (apps/agent/src/lens/manifest.ts @ cc3ad9e, lines 343–355 and 422–657) so the
// daemon's POST /lens/testid-gaps and a CI gate run ONE scanner, not two that
// drift (appkit #2487, cardmem #2489).
//
// The RULES are cardmem's — what counts as interactive, which dirs are skipped,
// what "not examined" means. Do not change them here without cardmem: a rule
// change in only one of the two places is exactly the drift this file exists to
// end. The only edit to the moved code: inventoryInteractiveGaps takes a resolved
// root instead of calling cardmem's resolveSandboxedPath — the sandbox is the
// daemon's concern, and the daemon keeps it by resolving before it calls here.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

export const SOURCE_EXTS = new Set(['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.html', '.astro']);
// `worktrees` holds throwaway copies of the WHOLE repo (the Agent tool's
// isolation:"worktree" mode leaves them under .claude/worktrees). They are real
// source files, so the walk happily read them — and 63% of the gaps this gate
// reported for cardmem came from two abandoned ones, at whatever commit they
// were cut from. Measured 2026-08-06: 548 reported, 346 from worktrees, 202
// real. A gate whose number is mostly noise teaches people to ignore it, and it
// nearly sent me to add testids to code that ships nowhere.
//
// Same family as the other false-greens today, inverted: a guard reading a real
// source that is not the one the system runs. There it hid a failure; here it
// manufactures phantom ones. Both make the number untrustworthy.
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage', '.cache', 'worktrees']);

export interface TestIdGap {
  file: string;
  line: number;
  element: string;
  snippet: string;
}

const TAG_START_RE = /<([A-Za-z][\w.]*)\b/g;
const NATIVE_INTERACTIVE = new Set(['button', 'input', 'select', 'textarea', 'a']);
// F074.58 — ONE definition of "an interactive handler", used by BOTH the gap
// matcher and the blind-spot probe below, so the probe that reports what we could
// not see can never fall behind the matcher it reports for. The `[=:]` form is
// deliberate: `onClick={fn}` is JSX and `onClick: fn` is the SAME handler in
// hyperscript (`h('button', { onClick: fn })`), createElement, or a Vue props
// object — the syntaxes this probe exists to notice.
const HANDLER_NAMES = 'Click|Change|Input|Submit';
const HANDLER_ATTR_RE = new RegExp(`\\bon(?:${HANDLER_NAMES})\\s*=`);
const HANDLER_ANY_RE = new RegExp(`\\bon(?:${HANDLER_NAMES})\\s*[=:]`, 'g');

// F074.22b — the real end of a JSX opening tag is the first '>' that is NOT
// inside a {…} expression or a string/template literal. The old /<tag[^>]*>/
// stopped at the '>' in an arrow handler (`onChange={e => …}`), truncating the
// attribute scan BEFORE a data-testid that followed the handler — so every
// interactive element with an arrow handler before its testid was a
// false-positive gap (fleet-wide; it broke the F086 self-check). Brace + quote
// aware finds the true tag end. Returns the index of the closing '>' or -1.
function openingTagEnd(content: string, from: number): number {
  let depth = 0;
  for (let i = from; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      if (depth > 0) depth--;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') i++;
        i++;
      }
    } else if (ch === '>' && depth === 0) {
      return i;
    }
  }
  return -1;
}

// upmetrics (F074.11 closeout) — a comment line that MENTIONS a native control
// ("// Custom date picker — never a native <input type='date'>") must not count
// as a gap. Blank /* */ blocks + start-of-line // comments to spaces (keeping
// newlines, so reported line numbers stay correct) before matching.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
}

// F074.58 (second cut) — "does this file contain markup?" cannot be answered by
// "does it contain a '<' followed by a letter". trail measured the escape on their
// REAL popup (#21962) after the first cut shipped:
//
//   line   3:  // F086 + house rule: no native <select>.   ← a COMMENT
//   line 161:  useState<Config | null>(null)               ← TS GENERICS
//
// Either one alone was enough to call the file examined, so its nine hyperscript
// handlers stayed invisible. Generics appear in nearly every TypeScript file, which
// makes the first probe close to a no-op: measured on cardmem, 310 files it called
// examined contain no markup at all. The old probe answered "this file contains a
// pair of angle brackets", not "this file contains markup".
//
// A generic's '<' always follows an identifier, ')' or ']' (`useState<`, `Array<`,
// `foo()<`). A JSX element's '<' never does — it follows whitespace, '(', '{', ','
// or '>'. That one character is the whole discriminator, and it is syntax-agnostic:
// hyperscript, createElement and Vue render functions all score 0 without needing a
// parser for any of them. Measured on the real file: 7 generic-shaped, 0 element-shaped.
export function elementLikeCount(rawContent: string): number {
  const content = stripComments(rawContent);
  let n = 0;
  for (const m of content.matchAll(TAG_START_RE)) {
    const i = m.index ?? 0;
    if (i > 0 && /[A-Za-z0-9_$)\]]/.test(content[i - 1]!)) continue;
    n++;
  }
  return n;
}

// F074.58 — the evidence that separates "element-less and inert" (cardmem's
// idle-cue-watcher, a genuinely markup-free effect component) from "interactive and
// UNSEEN" (trail's popup: nine handlers the matcher never met). Without it the third
// state is unreadable: on cardmem it names 491 files, nearly all of them .ts modules
// that were never expected to hold markup.
//
// The handler names are the matcher's OWN — deliberately narrow, and measured rather
// than chosen: a wider `on[A-Z]\w+` scored 140 "signals" on packages/db/src/schema.ts,
// which are Drizzle's onDelete/onUpdate, and `data-testid` as evidence added nine Lens
// tooling files that merely mention the string inside their own regexes. Narrow scores
// 0 on all of cardmem and exactly 1 on trail's web-clipper — the reported file.
export function interactiveHandlerCount(rawContent: string): number {
  return stripComments(rawContent).match(HANDLER_ANY_RE)?.length ?? 0;
}

export function gapsInFile(rawContent: string, rel: string, out: TestIdGap[]): void {
  const content = stripComments(rawContent);
  for (const m of content.matchAll(TAG_START_RE)) {
    const tag = m[1]!;
    const start = m.index ?? 0;
    // Attributes span from just after the tag name to the tag's TRUE '>' (skipping
    // '>' inside {…}/strings — an arrow handler's '>' must not truncate this).
    const end = openingTagEnd(content, start + m[0].length);
    if (end < 0) continue;
    const attrs = content.slice(start + m[0].length, end);
    const isNative = NATIVE_INTERACTIVE.has(tag.toLowerCase());
    const hasOnClick = HANDLER_ATTR_RE.test(attrs);
    // PascalCase / dotted tags (`<Select>`, `<FieldEditor>`, `<SelectPrimitive.Root>`)
    // are React COMPONENTS, not DOM elements. Their on*-handlers are PROPS passed
    // down — the real Lens anchor is the DOM the component renders (e.g. Select →
    // SelectTrigger), which is tagged in that component's own file. Radix
    // SelectPrimitive.Root renders no DOM and rejects data-testid, so flagging the
    // component itself produced an UNCLOSEABLE gap (no file with a <Select> could
    // ever reach 0). Only native DOM controls + lowercase tags with a handler count.
    // (Surfaced independently by the sa + fysiodk Lens sweeps, 2026-06-02.)
    const isComponent = /^[A-Z]/.test(tag) || tag.includes('.');
    if (isComponent) continue;
    // `<a>` only counts when it's clickable (href or onClick).
    if (tag.toLowerCase() === 'a' && !hasOnClick && !/\bhref\s*=/.test(attrs)) continue;
    if (!isNative && !hasOnClick) continue;
    if (/\bdata-testid\s*=/.test(attrs)) continue;
    const line = content.slice(0, start).split('\n').length;
    out.push({
      file: rel,
      line,
      element: tag,
      snippet: content.slice(start, end + 1).replace(/\s+/g, ' ').slice(0, 100),
    });
  }
}

export function inventoryInteractiveGaps(
  rootInput: string,
  maxFiles = 5000,
): {
  total_gaps: number;
  files_with_gaps: number;
  gaps: TestIdGap[];
  not_examined: string[];
  unseen_interactive: string[];
  /** F036.7 — added for the CLI (not a rule): how many source files the walk read. 0 must not read as clean. */
  files_scanned: number;
} {
  const root = resolve(rootInput);
  const gaps: TestIdGap[] = [];
  // F074.58 — a file we could not READ and a file we found no elements in are
  // both reported here, and neither is a gap. Reported by trail (#21959) with
  // the mutation that proves it: their hyperscript popup (`h('button', …)`,
  // Preact without JSX) answered 0 gaps, and still answered 0 with a
  // data-testid REMOVED. TAG_START_RE matches JSX tag-starts, so the file was
  // never examined — and "never examined" was indistinguishable from "clean".
  //
  // This repo already wrote the rule during the NUL-byte sweep: scan everything,
  // classify afterwards, and let the check prove its own coverage. A structured
  // "no problems" about a file nobody could read is the false green this closes.
  const notExamined: string[] = [];
  // The ACTIONABLE subset of not_examined: no elements visible, yet the file carries
  // handlers. "I could not read this, and there is something here to read."
  const unseenInteractive: string[] = [];
  const budget = { left: maxFiles };
  const walk = (dir: string): void => {
    if (budget.left <= 0) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (budget.left <= 0) return;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (SOURCE_EXTS.has(extname(name))) {
        budget.left -= 1;
        const rel = full.slice(root.length + 1);
        try {
          const text = readFileSync(full, 'utf-8');
          // Count elements BEFORE judging gaps: zero elements in a source file is
          // not a clean file, it is a file this matcher cannot see. It is NOT a
          // gap either — cardmem's own idle-cue-watcher.tsx is genuinely
          // element-less — so it is reported separately and a reader decides.
          // elementLikeCount is its own pass with its own non-global matching, so
          // the shared global TAG_START_RE's lastIndex is never advanced by the
          // coverage probe. The first cut called .test() on the global one, and
          // matchAll() inherits that index — gapsInFile then started mid-file and
          // missed the first element. My own negative control caught it: a file
          // with a real gap reported 0. The same class this card is about,
          // introduced by the fix for it.
          if (elementLikeCount(text) === 0) {
            notExamined.push(rel);
            if (interactiveHandlerCount(text) > 0) unseenInteractive.push(rel);
          }
          gapsInFile(text, rel, gaps);
        } catch {
          // Unreadable is the same class: say so instead of skipping silently.
          notExamined.push(rel);
        }
      }
    }
  };
  walk(root);
  const files = new Set(gaps.map((g) => g.file));
  return {
    total_gaps: gaps.length,
    files_with_gaps: files.size,
    gaps,
    not_examined: notExamined,
    unseen_interactive: unseenInteractive,
    files_scanned: maxFiles - budget.left,
  };
}
