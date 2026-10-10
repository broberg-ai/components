// F036.7 — moved from cardmem apps/agent/src/lens/not-examined.test.ts @ cc3ad9e, assertions unchanged:
// the package must prove the SAME behaviour the daemon had. Only the runner (bun:test →
// vitest), the import path and inventoryInteractiveGaps' sandbox argument differ.
// F074.58 — "0 gaps" and "0 elements found" were the same answer.
//
// trail (#21959) proved it with a mutation: their hyperscript popup answered 0
// gaps, and STILL answered 0 with a data-testid removed. The detector matches
// JSX tag-starts, so a file written as h('button', {…}) was never examined — and
// "never examined" was indistinguishable from "clean".
import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryInteractiveGaps, elementLikeCount, interactiveHandlerCount } from '../src/testid-gaps';

let root: string;
// realpathSync: on macOS /var is a symlink to /private/var, and the sandbox
// check compares resolved paths — without it every test dies on SandboxError.
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'f07458-'))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const write = (rel: string, body: string) => {
  const p = join(root, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body);
};
const run = () => inventoryInteractiveGaps(root);

describe('F074.58 — a file the matcher cannot see is reported, not counted clean', () => {
  test("THE REPORTED CASE: a hyperscript file lands in not_examined", () => {
    write('popup.tsx', "export const P = () => h('button', { onClick: go }, 'Save');\n");
    const r = run();
    expect(r.not_examined).toContain('popup.tsx');
    // …and it is NOT a gap. It is "I could not see", not "you have a defect".
    expect(r.total_gaps).toBe(0);
  });

  test('an UNREADABLE file is the same class — no longer a silent skip', () => {
    write('locked.tsx', '<button onClick={x}>hi</button>');
    chmodSync(join(root, 'locked.tsx'), 0o000);
    const r = run();
    // On a root-ish CI the read may succeed; assert the DISJUNCTION rather than
    // pretending the permission bit is portable.
    expect(r.not_examined.includes('locked.tsx') || r.gaps.some((g) => g.file === 'locked.tsx')).toBe(true);
  });
});

describe('F074.58 — the negative controls that stop it being noise', () => {
  test('NEGATIVE CONTROL: a normal JSX file is NOT in not_examined', () => {
    // Without this, "report every file as not_examined" would satisfy the tests above.
    write('ok.tsx', '<button data-testid="ok-btn" onClick={x}>hi</button>');
    const r = run();
    expect(r.not_examined).not.toContain('ok.tsx');
  });

  test('a REAL gap is still found and still counted', () => {
    write('bad.tsx', '<button onClick={x}>no anchor</button>');
    const r = run();
    expect(r.total_gaps).toBeGreaterThan(0);
    expect(r.gaps.some((g) => g.file === 'bad.tsx')).toBe(true);
    expect(r.not_examined).not.toContain('bad.tsx');
  });

  test('not_examined and gaps are DISJOINT — a file is one or the other', () => {
    write('a.tsx', "h('button', { onClick: go })");
    write('b.tsx', '<button onClick={x}>x</button>');
    const r = run();
    const gapFiles = new Set(r.gaps.map((g) => g.file));
    for (const f of r.not_examined) expect(gapFiles.has(f)).toBe(false);
  });
});

// ── Second cut (trail #21962) ─────────────────────────────────────────────────
// The fixture above is synthetic and PASSED while the real file kept escaping in
// the field. Two features it lacked did the damage — a comment that mentions a
// native control, and TypeScript generics — and either alone was enough to call
// the file examined. Generics are in nearly every .ts file, so the first probe was
// close to a no-op. These fixtures carry the real shape.
const REAL_SHAPE = `// F086 + house rule: no native <select>.
import { h } from 'preact';
import { useState } from 'preact/hooks';
async function loadConfig(): Promise<Config | null> { return null; }
export function Popup() {
  const [config, setConfig] = useState<Config | null>(null);
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  return h('div', { 'data-testid': 'clipper-root' }, [
    h('button', { onClick: () => save(config) }, 'Save'),
    h('input', { onInput: (e) => setKbs(e) }),
  ]);
}
`;

describe('F074.58 — the real file, not the fixture that flattered us', () => {
  test('THE ESCAPE: a comment mentioning <select> AND generics no longer count as markup', () => {
    write('Popup.tsx', REAL_SHAPE);
    const r = run();
    expect(r.not_examined).toContain('Popup.tsx');
    expect(r.total_gaps).toBe(0); // still "I could not see", never a fabricated defect
  });

  test('THE ACTIONABLE HALF: it is interactive-and-unseen, not merely element-less', () => {
    write('Popup.tsx', REAL_SHAPE);
    expect(run().unseen_interactive).toContain('Popup.tsx');
  });

  test('a comment alone cannot rescue a file — the whole first-cut failure in one line', () => {
    write('quiet.ts', '// never use a native <select> here\nexport const N = 1;\n');
    expect(run().not_examined).toContain('quiet.ts');
  });

  test('generics alone cannot rescue it either — this is what hit EVERY .ts file', () => {
    write('store.ts', 'export const load = async (): Promise<Config | null> => null;\n');
    expect(run().not_examined).toContain('store.ts');
  });
});

describe('F074.58 — the shared globals stay stateless across calls', () => {
  // The seal on the class that bit this card TWICE: a global regex carries lastIndex,
  // and the second reader inherits wherever the first one stopped. Both probes reuse
  // module-level globals, so "same input, same answer, every time" is the property —
  // and it is not visible in any single-file test.
  test('INTERLEAVED, and on exact counts — the only shape that can see state', () => {
    // Asserting count(A) twice is too weak: an implementation that leaks lastIndex,
    // or one that returns a constant, both pass it. Interleaving two inputs with
    // DIFFERENT true counts is what discriminates. (My first two mutations here were
    // no-ops that passed for the wrong reason; this is the shape that caught the third.)
    const three = "h('button', { onClick: a });\nh('input', { onInput: b });\n<b onSubmit={c}>x</b>\n";
    const one = "h('div', { onChange: z })";
    expect([
      interactiveHandlerCount(three),
      interactiveHandlerCount(one),
      interactiveHandlerCount(three),
    ]).toEqual([3, 1, 3]);
    expect([elementLikeCount(three), elementLikeCount(one), elementLikeCount(three)]).toEqual([1, 0, 1]);
  });

  test('a whole-tree scan is reproducible — two runs, same three lists', () => {
    write('a.tsx', "h('button', { onClick: go })");
    write('b.tsx', '<button onClick={x}>x</button>');
    write('c.ts', 'export const n = 1;\n');
    const one = run(), two = run();
    expect(two.not_examined).toEqual(one.not_examined);
    expect(two.unseen_interactive).toEqual(one.unseen_interactive);
    expect(two.gaps.map((g) => `${g.file}:${g.line}`)).toEqual(one.gaps.map((g) => `${g.file}:${g.line}`));
  });
});

describe('F074.58 — the second cut must not blind the detector it fixes', () => {
  test('NEGATIVE CONTROL: real JSX that ALSO contains generics is still examined', () => {
    // If the generic rule were applied too broadly, every modern component would
    // fall into not_examined and the gap list would quietly empty itself.
    write('form.tsx', 'const [v, set] = useState<string>("");\n<button data-testid="go" onClick={x}>go</button>\n');
    const r = run();
    expect(r.not_examined).not.toContain('form.tsx');
    expect(r.unseen_interactive).not.toContain('form.tsx');
  });

  test('NEGATIVE CONTROL: a real gap inside a generics-carrying file is still FOUND', () => {
    write('leak.tsx', 'const [v] = useState<Config>(null);\n<button onClick={x}>no anchor</button>\n');
    const r = run();
    expect(r.gaps.some((g) => g.file === 'leak.tsx')).toBe(true);
    expect(r.not_examined).not.toContain('leak.tsx');
  });

  test('element-less AND inert is not actionable — the distinction that keeps the list readable', () => {
    // cardmem's own idle-cue-watcher.tsx: a legitimately markup-free effect module.
    write('watcher.ts', 'export function useIdleCue() { /* effect only */ }\n');
    const r = run();
    expect(r.not_examined).toContain('watcher.ts');
    expect(r.unseen_interactive).not.toContain('watcher.ts');
  });

  test('NARROWNESS IS THE POINT: a Drizzle schema is element-less but NOT unseen-interactive', () => {
    // Measured, not chosen: a wider `on[A-Z]\\w+` scored 140 "signals" on
    // packages/db/src/schema.ts — every onDelete/onUpdate — which would have
    // buried the one file that matters under database plumbing.
    write('schema.ts', "export const c = t('c', { p: text().references(() => u.id, { onDelete: 'cascade' }) });\n");
    const r = run();
    expect(r.not_examined).toContain('schema.ts');
    expect(r.unseen_interactive).not.toContain('schema.ts');
  });

  test('unseen_interactive is a SUBSET of not_examined — never a third, contradicting list', () => {
    write('Popup.tsx', REAL_SHAPE);
    write('form.tsx', '<button data-testid="go" onClick={x}>go</button>');
    write('watcher.ts', 'export const x = 1;\n');
    const r = run();
    for (const f of r.unseen_interactive) expect(r.not_examined).toContain(f);
  });
});
