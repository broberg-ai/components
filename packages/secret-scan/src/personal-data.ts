// F035.21 — personal data: Danish CPR numbers, phone numbers, email addresses.
//
// Asked for by scout (7/10 2026) on Christian's requirement that personal data
// must NEVER reach Trail: a write is refused when this finds anything. That
// purpose sets the trade-off. A refused write is the cheap error; a phone
// number in a knowledge base is the expensive one. So the phone detector FAILS
// CLOSED — any 8-digit Danish-shaped number counts, order numbers included. Do
// not "fix" that into a leak.

export type PersonalDataKind = 'cpr' | 'phone' | 'email';

export interface PersonalDataMatch {
  kind: PersonalDataKind;
  /** offset of the first character, as in String.prototype.slice */
  start: number;
  /** offset one past the last character */
  end: number;
}

export interface PersonalDataResult {
  /** input with every match replaced by `[REDACTED:<kind>]` */
  redacted: string;
  /** per-kind counts (empty = nothing found among the kinds in `scanned`) */
  findings: { kind: PersonalDataKind; count: number }[];
  /** which kinds this call examined — so an empty `findings` says what was asked */
  scanned: readonly PersonalDataKind[];
}

const SCANNED: readonly PersonalDataKind[] = ['cpr', 'phone', 'email'];

// ddmmyy-xxxx or ddmmyyxxxx, not inside a longer run of digits.
const CPR = /(?<![\d+])(\d{2})(\d{2})(\d{2})-?(\d)(\d{3})(?![\d])/g;

// Danish: optional +45 / 0045, then 8 digits starting 2-9 — contiguous, 2-2-2-2
// or 4-4 with a space or hyphen. E.164: + and 7-15 digits, first digit 1-9.
const PHONE_DK =
  /(?<![\d+])(?:(?:\+|00)45[ -]?)?(?:[2-9]\d{7}|[2-9]\d(?:[ -]\d{2}){3}|[2-9]\d{3}[ -]\d{4})(?!\d)/g;
const PHONE_E164 = /(?<![\d+])\+[1-9]\d{6,14}(?!\d)/g;

// Linear on purpose. The local part starts only at the beginning of its run (the
// lookbehind), and domain labels are split by dots alone, so neither half can
// backtrack. A naive form took 30 s on 50,000 characters. The TLD rule (letters,
// 2+) is checked in code.
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const TLD = /\.[A-Za-z]{2,}$/;

/** The CPR century rule: the 7th digit and the year decide which century. */
function cprYear(yy: number, seventh: number): number {
  if (seventh <= 3) return 1900 + yy;
  if (seventh === 4 || seventh === 9) return (yy <= 36 ? 2000 : 1900) + yy;
  return (yy <= 57 ? 2000 : 1800) + yy;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function collect(text: string): PersonalDataMatch[] {
  const out: PersonalDataMatch[] = [];
  for (const m of text.matchAll(CPR)) {
    const [, dd, mm, yy, seventh] = m;
    if (isRealDate(cprYear(Number(yy), Number(seventh)), Number(mm), Number(dd))) {
      out.push({ kind: 'cpr', start: m.index!, end: m.index! + m[0].length });
    }
  }
  for (const re of [PHONE_DK, PHONE_E164]) {
    for (const m of text.matchAll(re)) out.push({ kind: 'phone', start: m.index!, end: m.index! + m[0].length });
  }
  for (const m of text.matchAll(EMAIL)) {
    if (TLD.test(m[0])) out.push({ kind: 'email', start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

/** Every personal-data span in `text`, sorted and non-overlapping (earliest, then longest, wins). */
export function findPersonalData(text: string): PersonalDataMatch[] {
  const all = collect(text).sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: PersonalDataMatch[] = [];
  for (const m of all) {
    const last = kept[kept.length - 1];
    if (!last || m.start >= last.end) kept.push(m);
  }
  return kept;
}

export function redactPersonalData(text: string): PersonalDataResult {
  const matches = findPersonalData(text);
  const counts = new Map<PersonalDataKind, number>();
  let redacted = '';
  let at = 0;
  for (const m of matches) {
    redacted += text.slice(at, m.start) + `[REDACTED:${m.kind}]`;
    at = m.end;
    counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
  }
  redacted += text.slice(at);
  return { redacted, findings: [...counts].map(([kind, count]) => ({ kind, count })), scanned: SCANNED };
}

export function hasPersonalData(text: string): boolean {
  return findPersonalData(text).length > 0;
}
