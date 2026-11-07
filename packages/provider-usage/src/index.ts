/**
 * @broberg/provider-usage — what each database, machine and bucket actually costs at the
 * provider (F113). The owner, 7 Nov 2026: «Det bedste ville være at vi kan query account data
 * fra vores providers.»
 *
 * ONE shape for every provider (UsageLine). Two promises it keeps everywhere:
 *   · `basis` is never left out. "billed" is what the provider invoices; "estimated" is list
 *     price × usage. A guessed price must never look like an invoiced one.
 *   · a key that cannot see billing answers `no_billing_access`, never an empty list — an empty
 *     list reads as «costs nothing».
 * Cost price only. A margin (e.g. +30 %) and the customer's price belong to the consumer
 * (D-bdbb73: prices change on the owner's word, in one place).
 */
export type Provider = "upcloud" | "scaleway" | "cloudflare" | "supabase" | "fly";

export interface UsageSegment {
  amount: number;
  hours?: number;
  plan?: string;
  zone?: string;
}

export interface UsageLine {
  provider: Provider;
  resourceId: string;
  /** The provider's own type name, e.g. "managed_database", "server", "managed_object_storage". */
  resourceType: string;
  /** `from` inclusive, `to` EXCLUSIVE — ISO dates (YYYY-MM-DD). */
  period: { from: string; to: string };
  amount: number;
  currency: string;
  basis: "billed" | "estimated";
  /** false while the period is still running — the amount will grow. */
  complete: boolean;
  details: {
    hours?: number;
    /** Set only when the whole period ran on ONE plan/zone; otherwise read `segments`. */
    plan?: string;
    zone?: string;
    /** One per plan/zone the resource ran on in the period (a mid-month resize gives two). */
    segments: UsageSegment[];
    /** Per day, when asked for (`daily: true`). */
    daily?: { date: string; amount: number }[];
  };
  fetchedAt: string;
}

export type UsageFailure =
  /** No key given — nothing was called. */
  | "not_configured"
  /** The key works but may not read billing (UpCloud 403/404). Not "costs nothing". */
  | "no_billing_access"
  /** Network, 5xx, 429 or a refused key (401). `status` says which. */
  | "unavailable"
  /** The provider answered something that is not the documented shape. */
  | "invalid_response";

export type UsageResult =
  | { ok: true; provider: Provider; lines: UsageLine[]; total: { amount: number; currency: string } }
  | { ok: false; provider: Provider; reason: UsageFailure; status?: number; message: string };

export { createUpcloudUsage, type UpcloudUsageOptions } from "./upcloud.js";
