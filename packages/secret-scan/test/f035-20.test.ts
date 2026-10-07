// F035.20 — Mistral's prefixed key («mstrl_…»), recognised from the value alone.
//
// The shape was measured by cardmem on the stored key, without the value:
// `mstrl_` + 32 base62 + `_` + 6 base62 = 45 characters. Every value below is
// SYNTHETIC — never a real key in a fixture.
import { describe, expect, it } from 'vitest';
import { classify, redactSecrets } from '../src/index.js';

const body = 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv'; // 32 base62
const key = `mstrl_${body}_Wx1Yz2`; // 45 chars

describe('F035.20 — mstrl_ key, no context', () => {
  it('the synthetic value has the measured shape', () => {
    expect(key.length).toBe(45);
  });

  it('classify labels the bare value, with no valueOnly flag', () => {
    expect(classify(key)?.label).toBe('mistral-api-key');
  });

  it('redacts it inside prose', () => {
    expect(redactSecrets(`nøglen er ${key} ok`).redacted).toBe('nøglen er [REDACTED:mistral-api-key] ok');
  });
});

describe('F035.20 — negative controls', () => {
  it.each([
    ['tail one short', `mstrl_${body}_Wx1Yz`],
    ['tail one long', `mstrl_${body}_Wx1Yz23`],
    ['body one short', `mstrl_${body.slice(1)}_Wx1Yz2`],
    ['body one long', `mstrl_${body}a_Wx1Yz2`],
    ['a dash in the body', `mstrl_${body.slice(0, 31)}-_Wx1Yz2`],
    ['the guessed 4-letter prefix', `mstr_${body}_Wx1Yz2`],
    ['no second separator', `mstrl_${body}Wx1Yz2`],
  ])('not mistral: %s', (_, v) => {
    expect(classify(v)?.label).not.toBe('mistral-api-key');
  });

  it('not inside a longer word', () => {
    expect(redactSecrets(`xmstrl_${body}_Wx1Yz2`).findings.map((f) => f.label)).not.toContain('mistral-api-key');
  });

  it('the context-only Mistral pattern still works', () => {
    expect(classify(`MISTRAL_API_KEY=${body}`)?.label).toBe('mistral-api-key');
    expect(classify(body)).toBeNull();
  });
});
