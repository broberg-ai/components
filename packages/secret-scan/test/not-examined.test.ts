// components-F079.6 — the result says what it NEVER examines. The fixture is the
// Danish support message measured on the card: CPR, e-mail, phone and a name.
import { describe, expect, it } from 'vitest';
import { redactSecrets, redactPersonalData, SECRETS_NOT_EXAMINED, PERSONAL_DATA_NOT_EXAMINED } from '../src/index';

const MSG = 'Hej, jeg hedder Mette Jensen, CPR 110583-1235, mail mette.jensen@example.dk, tlf. 22 33 44 55. Jeg har ondt i lænden.';

describe('F079.6 — "nothing found" and "never looked" are no longer the same object', () => {
  it('redactSecrets on a message FULL of personal data: findings empty, text unchanged — and personal-data reported as NOT EXAMINED', () => {
    const r = redactSecrets(MSG);
    expect(r).toEqual({ redacted: MSG, findings: [], scanned: ['format'], notExamined: ['personal-data'] });
  });
  it('it is the same answer on empty and on announced-mode calls — a statement about the package, not the input', () => {
    expect(redactSecrets('').notExamined).toEqual(['personal-data']);
    expect(redactSecrets(MSG, { announced: true }).notExamined).toEqual(['personal-data']);
    expect(SECRETS_NOT_EXAMINED).toEqual(['personal-data']);
  });
  it('redactPersonalData finds CPR, e-mail and phone — and says NAMES are not examined (Mette Jensen stays)', () => {
    const r = redactPersonalData(MSG);
    expect(r.findings.map((f) => f.kind).sort()).toEqual(['cpr', 'email', 'phone']);
    expect(r.redacted).toContain('Mette Jensen');
    expect(r.redacted).not.toContain('110583');
    expect(r.notExamined).toEqual(['names', 'addresses', 'health-details']);
    expect(PERSONAL_DATA_NOT_EXAMINED).toEqual(r.notExamined);
  });
});
