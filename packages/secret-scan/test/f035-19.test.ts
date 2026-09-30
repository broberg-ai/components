// F035.19 — `announced: 'code'`: the announced axis for SOURCE CODE.
//
// Filed by pitch: GitGuardian flagged «Generic Password» on the first line
// below, and 0.11.1 with `{ announced: true }` returned `findings: []` on it —
// while flagging `apiKey: nanoid(32)`. Every assertion is STRICT equality on
// the redacted string: a `toContain` would pass on a half-redacted line.
import { describe, expect, it } from 'vitest';
import { hasAnnouncedSecret, hasSecret, redactSecrets } from '../src/index.js';

const M = '[REDACTED:announced-secret]';
const code = (s: string) => redactSecrets(s, { announced: 'code' });

describe("announced: 'code' catches what GitGuardian caught (pitch d18b93e)", () => {
  it("redacts newPassword: 'abcdefgh' and leaves 'a' (under 4) alone", () => {
    const r = code("body: JSON.stringify({ currentPassword: 'a', newPassword: 'abcdefgh' })");
    expect(r.redacted).toBe(`body: JSON.stringify({ currentPassword: 'a', newPassword: '${M}' })`);
    expect(r.findings).toEqual([{ label: 'announced-secret', count: 1, confidence: 'announced' }]);
    expect(r.scanned).toEqual(['format', 'announced']);
  });

  it('the prose rule still misses it — the two modes really differ', () => {
    const line = "newPassword: 'abcdefgh'";
    expect(redactSecrets(line, { announced: true }).findings).toEqual([]);
  });

  const positives: Array<[string, string]> = [
    [`const DB_PASSWORD = "hunter22"`, `const DB_PASSWORD = "${M}"`],
    [`clientSecret: 'correcthorse'`, `clientSecret: '${M}'`],
    [`{ "password": "abcd" }`, `{ "password": "${M}" }`],
    ['apiKey: `k3y-value`', 'apiKey: `' + M + '`'],
    [`KODEORD = "fikstur-99"`, `KODEORD = "${M}"`],
    [`api_key='abcdefgh'`, `api_key='${M}'`],
    // 0.12.0 excluded every quote kind from the value, so these leaked whole.
    [`password: "ab'cd99"`, `password: "${M}"`],
    [`pwd: 'x"yz12'`, `pwd: '${M}'`],
  ];
  it.each(positives)('%s', (input, expected) => {
    expect(code(input).redacted).toBe(expected);
    expect(hasAnnouncedSecret(input, 'code')).toBe(true);
    expect(hasSecret(input, { announced: 'code' })).toBe(true);
  });

  it('a format hit keeps its specific label — the code rule does not flatten it', () => {
    const r = code(`apiKey: "sk-ant-api03-${'a'.repeat(90)}"`);
    expect(r.findings.map((f) => f.label)).not.toContain('announced-secret');
    expect(r.findings.length).toBe(1);
  });
});

describe("announced: 'code' leaves expressions and measured noise alone", () => {
  const clean = [
    // pitch's false positives: an unquoted value is an expression.
    'apiKey: nanoid(32)',
    'apiKey: process.env.RESEND_API_KEY',
    'password: someVar',
    'const secret = await vault.get("x y")',
    // a literal under a label that names no credential
    `const name = 'abcdefgh'`,
    `title: "hunter22"`,
    // comparisons are not assignments
    `if (password === 'hunter22') {}`,
    `const f = (password) => 'abcdefgh'`,
    // the measured noise shapes (1/10 2026)
    `password: "Adgangskode"`,
    `password: "Password"`,
    `PASSWORD_TOO_SHORT: "password_too_short"`,
    `secretPath: ".lens/mint-secret"`,
    `passwordPlaceholder: 'Indtast-kode'`,
    `const code = err === "x" ? "wrong_password" : "enable_failed"`,
    `export type SecretConfidence = 'format' | 'announced';`,
    // templates, whitespace, short
    'password: `${prefix}-abc`',
    `password: 'two words'`,
    `pwd: 'abc'`,
    '',
  ];
  it.each(clean)('%j', (input) => {
    const r = code(input);
    expect(r.redacted).toBe(input);
    expect(r.findings).toEqual([]);
    expect(hasAnnouncedSecret(input, 'code')).toBe(false);
    expect(hasSecret(input, { announced: 'code' })).toBe(false);
  });
});

describe('hasAnnouncedSecret(code) never promises a redaction that does not happen', () => {
  const inputs = [
    "newPassword: 'abcdefgh'",
    'apiKey: nanoid(32)',
    `password: "Adgangskode"`,
    `apiKey: "sk-ant-api03-${'a'.repeat(90)}"`,
  ];
  it.each(inputs)('%j', (input) => {
    if (hasAnnouncedSecret(input, 'code')) expect(code(input).redacted).not.toBe(input);
  });
});

// The first draft (`[\w$]*password[\w$]*`) backtracked quadratically inside one
// long identifier: 'password' × 50,000 did not finish in two minutes.
describe("announced: 'code' stays linear on adversarial input", () => {
  it.each([
    ['one 400k identifier made of credential words', 'password'.repeat(50_000)],
    ['400k of label-separator pairs', 'password:'.repeat(44_000)],
    ['400k of ternary-quote noise', "? '".repeat(133_000)],
  ])('%s in under 3 s', (_name, input) => {
    const t = performance.now();
    code(input);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});
