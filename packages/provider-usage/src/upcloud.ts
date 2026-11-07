/**
 * F113.1 — UpCloud: billed cost per resource per month.
 *
 * Endpoints (developers.upcloud.com/1.3/3-accounts, read 7 Nov 2026):
 *   GET /1.3/account/billing/summary/{YYYY-MM}
 *       → { currency, <group>: { <type>: { resources: [{ resource_id, amount, hours,
 *            details: [{ amount, hours, plan?, zone?, … }] }], total_amount }, total_amount },
 *           total_amount }
 *   GET /1.3/account/resource_billing_summary/{id}/{YYYY-MM}
 *       → { billing: { daily_sums: { "YYYY-MM-DD": amount }, details, total_amount } }
 *
 * THE ALLOWLIST IS IN THE CODE, NOT ONLY IN THE TESTS. UpCloud tokens have no scopes: a token
 * that may read billing may usually read everything else too, and `GET /1.3/database` answers
 * with production databases' passwords in clear text (measured by fysio.work, 7 Nov 2026). So
 * this module can only ever issue GET to the two billing paths above. Anything else throws
 * before a request leaves.
 *
 * Measured with the shared managed-db sub-account: billing answers 404/403 → no_billing_access.
 * A key WITH billing rights has not been tried yet (the owner creates it).
 */
import type { UsageLine, UsageResult, UsageSegment } from "./index.js";

export interface UpcloudUsageOptions {
  /** Bearer token for an account with «read billing details». Undefined/empty → not_configured. */
  token?: string;
  fetch?: typeof fetch;
  /** Default https://api.upcloud.com */
  baseUrl?: string;
  /** For tests: decides whether a month is still running. */
  now?: () => Date;
}

const ALLOWED = [/^\/1\.3\/account\/billing\/summary\/\d{4}-\d{2}$/, /^\/1\.3\/account\/resource_billing_summary\/[A-Za-z0-9.:_-]+\/\d{4}-\d{2}$/];
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

type Fail = Extract<UsageResult, { ok: false }>;
const fail = (reason: Fail["reason"], message: string, status?: number): Fail =>
  status === undefined ? { ok: false, provider: "upcloud", reason, message } : { ok: false, provider: "upcloud", reason, message, status };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function createUpcloudUsage(options: UpcloudUsageOptions) {
  const f = options.fetch ?? fetch;
  const base = (options.baseUrl ?? "https://api.upcloud.com").replace(/\/+$/, "");
  const now = options.now ?? (() => new Date());

  async function get(path: string): Promise<{ ok: true; body: unknown } | Fail> {
    if (!ALLOWED.some((re) => re.test(path))) throw new Error(`provider-usage/upcloud: refusing to call ${path} — only the billing paths are allowed`);
    let res: Response;
    try {
      res = await f(base + path, { method: "GET", headers: { authorization: `Bearer ${options.token}`, accept: "application/json" } });
    } catch (e) {
      return fail("unavailable", `UpCloud did not answer: ${e instanceof Error ? e.name : "error"}`);
    }
    if (res.status === 403 || res.status === 404) return fail("no_billing_access", `this UpCloud key may not read billing (HTTP ${res.status}) — it needs «read billing details»`, res.status);
    if (!res.ok) return fail("unavailable", `UpCloud answered HTTP ${res.status}`, res.status);
    try {
      return { ok: true, body: await res.json() };
    } catch {
      return fail("invalid_response", "UpCloud's answer is not JSON");
    }
  }

  return {
    /** Billed cost per resource for one month ("YYYY-MM"). `daily: true` adds per-day sums (one extra call per resource). */
    async month(yearMonth: string, opts: { daily?: boolean } = {}): Promise<UsageResult> {
      const m = MONTH.exec(yearMonth);
      if (!m) throw new Error(`provider-usage/upcloud: month must be YYYY-MM, got ${JSON.stringify(yearMonth)}`);
      if (!options.token) return fail("not_configured", "no UpCloud billing key configured");

      const r = await get(`/1.3/account/billing/summary/${yearMonth}`);
      if (!r.ok) return r;
      const body = r.body;
      if (!isObj(body) || typeof body.currency !== "string" || !num(body.total_amount)) return fail("invalid_response", "UpCloud's billing summary has no currency/total_amount");
      const currency = body.currency;

      const y = Number(m[1]);
      const mo = Number(m[2]);
      const from = `${yearMonth}-01`;
      const to = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
      const n = now();
      const current = `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}`;
      const complete = yearMonth < current;
      const fetchedAt = n.toISOString();

      const lines: UsageLine[] = [];
      for (const [groupKey, group] of Object.entries(body)) {
        if (groupKey === "currency" || groupKey === "total_amount") continue;
        if (!isObj(group)) return fail("invalid_response", `UpCloud's ${groupKey} is not an object`);
        for (const [typeKey, sub] of Object.entries(group)) {
          if (typeKey === "total_amount") continue;
          if (!isObj(sub) || !Array.isArray(sub.resources)) return fail("invalid_response", `UpCloud's ${groupKey}.${typeKey} has no resources`);
          for (const res of sub.resources) {
            if (!isObj(res) || typeof res.resource_id !== "string" || !num(res.amount)) return fail("invalid_response", `a ${typeKey} in UpCloud's summary has no resource_id/amount`);
            const segments: UsageSegment[] = [];
            for (const d of Array.isArray(res.details) ? res.details : []) {
              if (!isObj(d) || !num(d.amount)) return fail("invalid_response", `a ${typeKey} detail has no amount`);
              const s: UsageSegment = { amount: d.amount };
              if (num(d.hours)) s.hours = d.hours;
              if (typeof d.plan === "string") s.plan = d.plan;
              if (typeof d.zone === "string") s.zone = d.zone;
              segments.push(s);
            }
            const plans = new Set(segments.map((s) => s.plan));
            const zones = new Set(segments.map((s) => s.zone));
            const line: UsageLine = {
              provider: "upcloud",
              resourceId: res.resource_id,
              resourceType: typeKey,
              period: { from, to },
              amount: res.amount,
              currency,
              basis: "billed",
              complete,
              details: { segments },
              fetchedAt,
            };
            if (num(res.hours)) line.details.hours = res.hours;
            if (plans.size === 1 && segments[0]?.plan) line.details.plan = segments[0].plan;
            if (zones.size === 1 && segments[0]?.zone) line.details.zone = segments[0].zone;
            lines.push(line);
          }
        }
      }

      if (opts.daily) {
        for (const line of lines) {
          const d = await get(`/1.3/account/resource_billing_summary/${encodeURIComponent(line.resourceId)}/${yearMonth}`);
          if (!d.ok) return d;
          const sums = isObj(d.body) && isObj(d.body.billing) ? d.body.billing.daily_sums : undefined;
          if (!isObj(sums)) return fail("invalid_response", `UpCloud's daily billing for ${line.resourceId} has no daily_sums`);
          const daily: { date: string; amount: number }[] = [];
          for (const [date, amount] of Object.entries(sums)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !num(amount)) return fail("invalid_response", `UpCloud's daily_sums for ${line.resourceId} is not date → amount`);
            daily.push({ date, amount });
          }
          line.details.daily = daily.sort((a, b) => a.date.localeCompare(b.date));
        }
      }

      return { ok: true, provider: "upcloud", lines, total: { amount: body.total_amount, currency } };
    },
  };
}
