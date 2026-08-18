// F071.3 — the rejection is correct; the message was incomplete.
//
// cardmem's cloud path sent its own routing field `project` straight into
// flowBodySchema and 0.7.0's strict schema refused it — correctly. The README
// had carried a prominent "unknown keys are now REJECTED" section since that
// release, naming `project` among the caught bugs and showing .extend() as the
// supported home for a consumer-owned key. It did not help, because they arrived
// from a failing run.
//
// Their sentence, and it is the whole story: a consumer running `pnpm update`
// does not read release notes. The person who needs the .extend() line is
// holding a stack trace.
//
// So: do not change what the schema DOES. Change what the failure SAYS.
import { describe, it, expect } from 'vitest';
import { flowBodySchema, flowStepSchema } from '../src/schema.js';

const body = (over: Record<string, unknown> = {}) => ({
  base_url: 'https://example.test',
  steps: [{ action: 'goto', url: '/' }],
  ...over,
});

function messageOf(result: { success: boolean; error?: { issues: unknown[] } }): string {
  expect(result.success).toBe(false);
  return JSON.stringify(result.error!.issues);
}

describe('F071.3 — a rejected body key names .extend()', () => {
  it('names the key AND the escape hatch', () => {
    const msg = messageOf(flowBodySchema.safeParse(body({ project: 'cardmem' })));
    expect(msg).toContain("'project'");           // still names the offender
    expect(msg).toContain('.extend(');            // ...and now the alternative
    expect(msg).toContain('flowBodySchema.extend({ project:');
  });

  it('the suggestion uses the key the caller actually typed', () => {
    // A hardcoded example key would be worse than none — the reader would copy
    // it verbatim. Deliberate nonsense so it cannot match a constant.
    const msg = messageOf(flowBodySchema.safeParse(body({ zzq_routing_hint: 1 })));
    expect(msg).toContain('flowBodySchema.extend({ zzq_routing_hint:');
  });

  it('names every offending key, not just the first', () => {
    const msg = messageOf(flowBodySchema.safeParse(body({ project: 1, baseUrl: 2 })));
    expect(msg).toContain("'project'");
    expect(msg).toContain("'baseUrl'");
  });
});

describe('F071.3 — a rejected STEP key gets the honest advice, not the same advice', () => {
  // A discriminated union cannot be .extend()ed, so telling a reader to extend
  // the step would send them somewhere that does not exist. The truthful answer is
  // that a consumer-owned field belongs on the body.
  const stepMsg = (extra: Record<string, unknown>) =>
    messageOf(flowStepSchema.safeParse({ action: 'click', target: '#save', ...extra }));

  it('points at the BODY, and does not claim a step can be extended', () => {
    const msg = stepMsg({ project: 'x' });
    expect(msg).toContain("'project'");
    expect(msg).toContain('flowBodySchema.extend()');
    expect(msg).not.toContain('flowStepSchema.extend(');
  });

  it('mentions timeout_ms, because the likeliest step-level typo is that one', () => {
    // F071.1 shipped timeout_ms; timeoutMs / timeout / timeout_s are the misses.
    expect(stepMsg({ timeoutMs: 1000 })).toContain('timeout_ms');
  });

  it.each(['goto', 'fill', 'expectVisible', 'upload', 'assert'])(
    'fires on the %s branch too — a 14th action must not ship without it',
    (action) => {
      const base: Record<string, Record<string, unknown>> = {
        goto: { action: 'goto', url: '/' },
        fill: { action: 'fill', target: '#a', value: 'x' },
        expectVisible: { action: 'expectVisible', target: '#a' },
        upload: { action: 'upload', target: '#a', files: [{ name: 'a.png', url: 'https://e.test/a.png' }] },
        assert: { action: 'assert', js: 'return { pass: true }' },
      };
      const msg = messageOf(flowStepSchema.safeParse({ ...base[action]!, zzq: 1 }));
      expect(msg).toContain('.extend()');
    },
  );

  it('every member of the union carries it — read from the union itself', () => {
    // Not a hand-written list: the domain comes from the schema, so a branch
    // added later is covered or the test fails.
    const actions = (flowStepSchema as unknown as { options: Array<{ shape: { action: { value: string } } }> })
      .options.map((o) => o.shape.action.value);
    expect(actions.length).toBeGreaterThan(10);
    for (const a of actions) {
      const r = flowStepSchema.safeParse({ action: a, zzq_unknown: 1 });
      expect(r.success).toBe(false);
      // Some branches also miss required fields — the unknown-key issue must
      // still be among them, carrying the hint.
      expect(JSON.stringify(r.error!.issues)).toContain('.extend()');
    }
  });
});

describe('F071.3 — the negative controls: other errors are untouched', () => {
  // A hint on every validation error is noise, and noise stops being read.
  //
  // THE ONE THAT DISCRIMINATES IS THE FIRST. The three below it do NOT: measured,
  // a missing field and a wrong type are raised by the FIELD's schema (ZodString
  // et al.), which carries no errorMap of ours, so they never reach this map at
  // all and would read identically with the guard deleted. They document that
  // ordinary errors still read normally; they cannot prove the guard exists.
  // Only an invalid_type on the OBJECT ITSELF is raised by the schema that holds
  // the map — so that is the case where dropping the guard is visible.
  //
  // Found by the mutation pass, not by review: 'the hint fires on EVERY issue'
  // came back UNCAUGHT against the first version of this block. Three tests that
  // could not fail, sitting under a heading that said they were the controls.
  it('a non-object body gets NO hint — the case that actually reaches this errorMap', () => {
    for (const bad of [null, 'not an object', 42, []]) {
      const r = flowBodySchema.safeParse(bad);
      expect(r.success).toBe(false);
      const msg = JSON.stringify(r.error!.issues);
      expect(msg).not.toContain('.extend(');
      expect(msg).toContain('invalid_type');
    }
  });

  it('a missing required field gets no hint', () => {
    const msg = messageOf(flowBodySchema.safeParse({ steps: [{ action: 'goto', url: '/' }] }));
    expect(msg).toContain('Required');
    expect(msg).not.toContain('.extend(');
  });

  it('a wrong type gets no hint', () => {
    const msg = messageOf(flowBodySchema.safeParse(body({ base_url: 42 })));
    expect(msg).not.toContain('.extend(');
  });

  it('a bad discriminator gets no hint', () => {
    const msg = messageOf(flowStepSchema.safeParse({ type: 'click', target: '#x' }));
    expect(msg).not.toContain('.extend(');
  });

  it('a bad timeout_ms value gets no hint — it is a KNOWN key with a bad value', () => {
    const msg = messageOf(flowStepSchema.safeParse({ action: 'click', target: '#x', timeout_ms: 0 }));
    expect(msg).not.toContain('.extend(');
  });
});

describe('F071.3 — behaviour is UNCHANGED (this is a message change, not a contract change)', () => {
  it('the same bodies are still accepted', () => {
    expect(flowBodySchema.safeParse(body()).success).toBe(true);
    expect(flowBodySchema.safeParse(body({ timeout_ms: 5000 })).success).toBe(true);
  });

  it('the same bodies are still rejected', () => {
    expect(flowBodySchema.safeParse(body({ project: 'x' })).success).toBe(false);
  });

  it('.extend() still admits the key it now advertises — the advice is not a lie', () => {
    // The message tells the reader to do this. If it did not work, the hint
    // would be worse than silence.
    const extended = flowBodySchema.extend({ project: (flowBodySchema.shape.name) });
    expect(extended.safeParse(body({ project: 'cardmem' })).success).toBe(true);
    expect(extended.safeParse(body({ junk: 1 })).success).toBe(false);
  });
});
