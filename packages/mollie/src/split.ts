// F112.1 — the split engine. Provider-independent and pure: rules in, exact
// amounts per recipient out. THIS is where the platform controls who gets what —
// Mollie only executes the amounts it is given.
//
// Order of application, and it is load-bearing:
//   1. FIXED amounts come off the top (e.g. a fixed operations surcharge per app
//      to the platform).
//   2. PERCENT shares are taken of what is LEFT (e.g. 30 % platform / 70 % developer).
//   3. Rounding: every percent share is rounded DOWN to a whole minor unit; what
//      is left over — rounding crumbs, or the unallocated part when percents sum
//      to less than 100 — goes to `remainderTo`. The lines therefore always sum
//      to exactly `amount`. Not one øre appears or disappears.

export interface SplitRule {
  /** Who receives it — your own id (e.g. "platform", "dev:org_123", "clinic:org_456"). */
  recipient: string;
  /** Share of what is left after fixed amounts, 0–100, at most 2 decimals. */
  percent?: number;
  /** A fixed amount in minor units (øre/cents). */
  fixed?: number;
}

export interface SplitConfig {
  rules: SplitRule[];
  /** Receives rounding crumbs and any unallocated percent. Usually the platform. */
  remainderTo: string;
  /** If given, every recipient must be one of these — a typo is refused, not paid out. */
  knownRecipients?: string[];
}

export interface SplitLine {
  recipient: string;
  /** Minor units. Lines with 0 are left out. */
  amount: number;
}

export class SplitError extends Error {
  constructor(message: string) {
    super(`@broberg/mollie split: ${message}`);
    this.name = "SplitError";
  }
}

const isWhole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** Splits `amount` (minor units) by `config`. Throws SplitError on any invalid rule — before anything is paid. */
export function computeSplit(amount: number, config: SplitConfig): SplitLine[] {
  if (!isWhole(amount) || amount <= 0) throw new SplitError(`amount must be a positive whole number of minor units, got ${amount}`);
  const { rules, remainderTo, knownRecipients } = config;
  if (typeof remainderTo !== "string" || !remainderTo) throw new SplitError("remainderTo is required — someone must receive the rounding remainder");
  if (!Array.isArray(rules)) throw new SplitError("rules must be an array");
  const known = knownRecipients ? new Set(knownRecipients) : null;
  const check = (r: string) => {
    if (known && !known.has(r)) throw new SplitError(`unknown recipient "${r}"`);
  };
  check(remainderTo);

  let fixedTotal = 0;
  let percentBp = 0; // basis points, so 30.25 % is exact
  for (const [i, r] of rules.entries()) {
    if (typeof r?.recipient !== "string" || !r.recipient) throw new SplitError(`rule ${i}: recipient is required`);
    check(r.recipient);
    const hasP = r.percent !== undefined, hasF = r.fixed !== undefined;
    if (hasP === hasF) throw new SplitError(`rule ${i} (${r.recipient}): give exactly one of percent or fixed`);
    if (hasF) {
      if (!isWhole(r.fixed) || r.fixed < 0) throw new SplitError(`rule ${i} (${r.recipient}): fixed must be a whole number ≥ 0`);
      fixedTotal += r.fixed;
    } else {
      const p = r.percent as number;
      const bp = Math.round(p * 100);
      if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 100 || Math.abs(bp - p * 100) > 1e-6)
        throw new SplitError(`rule ${i} (${r.recipient}): percent must be 0–100 with at most 2 decimals`);
      percentBp += bp;
    }
  }
  if (fixedTotal > amount) throw new SplitError(`fixed amounts (${fixedTotal}) exceed the payment (${amount})`);
  if (percentBp > 10_000) throw new SplitError(`percent shares add up to ${percentBp / 100} % — more than 100 %`);

  const base = amount - fixedTotal;
  const totals = new Map<string, number>();
  const add = (who: string, n: number) => totals.set(who, (totals.get(who) ?? 0) + n);
  let allocated = 0;
  for (const r of rules) {
    const share = r.fixed !== undefined ? r.fixed : Math.floor((base * Math.round((r.percent as number) * 100)) / 10_000);
    add(r.recipient, share);
    allocated += share;
  }
  add(remainderTo, amount - allocated);

  const lines = [...totals].map(([recipient, n]) => ({ recipient, amount: n })).filter((l) => l.amount > 0);
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  if (sum !== amount) throw new SplitError(`internal: lines sum to ${sum}, not ${amount}`); // cannot happen; guards a future edit
  return lines;
}
