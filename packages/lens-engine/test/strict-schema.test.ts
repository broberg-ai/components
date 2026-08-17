// F071.1 — a schema that refuses instead of dropping.
//
// Zod's DEFAULT for an object is `.strip()`: an unknown key is deleted, silently,
// before anything downstream ever sees it. Nobody chose that for this grammar,
// which is exactly why nobody caught it. Measured on 0.6.1:
//
//   flowStepSchema.safeParse({ action:'click', target:'#save', timeout_ms:1000 })
//     ok: true
//     survived: {"action":"click","target":"#save"}     <- the field is just gone
//
// cardmem's formulation, adopted: a missing capability fails visibly; an ignored
// field lies. storeform lost two days to the daemon-level twin of this
// (timeout_ms accepted and ignored → "Timeout 15000ms exceeded" for a 1000ms
// request). These tests are written to fail against the pre-fix build.
import { describe, it, expect } from 'vitest';
import { flowBodySchema, flowStepSchema } from '../src/schema.js';

/** One minimal VALID step per action. Deliberately NOT the source of truth for
 *  which actions exist — the union is (see "every member" below), and this map
 *  is checked against it. A hand-written list that silently shrinks what gets
 *  looked at is the same failure this whole story is about. */
const VALID: Record<string, Record<string, unknown>> = {
  goto: { action: 'goto', url: '/x' },
  click: { action: 'click', target: '#a' },
  fill: { action: 'fill', target: '#a', value: 'v' },
  type: { action: 'type', target: '#a', text: 't' },
  press: { action: 'press', key: 'Enter' },
  select: { action: 'select', target: '#a', value: 'v' },
  upload: { action: 'upload', target: '#a', files: [{ name: 'f.png', url: 'https://example.com/f.png' }] },
  waitFor: { action: 'waitFor' },
  assert: { action: 'assert', js: 'true' },
  expectText: { action: 'expectText', target: '#a', text: 't' },
  expectVisible: { action: 'expectVisible', target: '#a' },
  expectEditable: { action: 'expectEditable', target: '#a' },
  screenshot: { action: 'screenshot' },
};

/** The actions the union actually declares — read from the schema, not typed out. */
const ACTIONS = flowStepSchema.options.map((o) => o.shape.action.value as string);

const body = (steps: unknown[], extra: Record<string, unknown> = {}) => ({
  base_url: 'https://example.com',
  steps,
  ...extra,
});

describe('an unknown key is refused, not deleted', () => {
  it('rejects the exact case cardmem reported', () => {
    // The original report, verbatim. Pre-fix this parses ok:true and BOTH extra
    // fields are absent from the result — a caller asking for a 1s timeout is
    // told yes and given 30s.
    const r = flowStepSchema.safeParse({ action: 'click', target: '#save', timeout_ms: 1000, timeout: 1000 });
    expect(r.success).toBe(false);
  });

  it('names the offending key in the error, so the fix is mechanical', () => {
    // success:false alone would let a schema that rejects for the WRONG reason
    // pass this suite. The consumer needs to be told which key, by name.
    const r = flowStepSchema.safeParse({ action: 'click', target: '#save', tiemout_ms: 1000 });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(JSON.stringify(r.error.issues)).toContain('tiemout_ms');
  });

  it('rejects an unknown key on the body too', () => {
    const r = flowBodySchema.safeParse(body([VALID.click!], { wat: true }));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(JSON.stringify(r.error.issues)).toContain('wat');
  });

  it('…and a valid body still parses (the guard must not reject everything)', () => {
    // Without this control, `z.never()` would satisfy every test above.
    expect(flowBodySchema.safeParse(body([VALID.goto!, VALID.click!])).success).toBe(true);
  });
});

describe('every member of the union, not just the one that was reported', () => {
  it('the fixture map covers exactly the actions the union declares', () => {
    // The coverage assertion. A 14th action added without a fixture fails HERE,
    // rather than quietly not being tested by the loop below.
    expect(Object.keys(VALID).sort()).toEqual([...ACTIONS].sort());
  });

  it.each(ACTIONS)('%s refuses an unknown key', (action) => {
    const valid = VALID[action]!;
    expect(flowStepSchema.safeParse(valid).success).toBe(true); // the fixture is genuinely valid
    const r = flowStepSchema.safeParse({ ...valid, definitely_not_a_field: 1 });
    expect(r.success).toBe(false);
  });

  it('is structurally strict — a 14th branch cannot ship as .strip()', () => {
    // The behavioural loop above needs a fixture per action. This one needs
    // nothing: it reads the union's own members and asserts the property
    // directly, so it holds even for a branch nobody wrote a fixture for.
    const strip = flowStepSchema.options
      .filter((o) => o._def.unknownKeys !== 'strict')
      .map((o) => o.shape.action.value);
    expect(strip).toEqual([]);
    expect(flowBodySchema._def.unknownKeys).toBe('strict');
  });
});

describe('the discriminator is deliberately NOT touched (finding 3, a non-goal)', () => {
  it('a `type`-keyed step is still rejected', () => {
    // cardmem's third finding, which we are NOT fixing and they agree: it fails
    // VISIBLY. Changing the discriminator would break every flow in the fleet to
    // spare people an error message they already get. Pinned so the next reader
    // does not "fix" it.
    expect(flowStepSchema.safeParse({ type: 'click', target: '#x' }).success).toBe(false);
  });
});
