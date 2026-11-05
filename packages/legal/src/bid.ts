/**
 * F110.6 — terms acceptances and GDPR consents live in BID («Samtykke» on the BID
 * account), never in an app's own database (owner, 1/11 2026; D-ae49a8). These are
 * thin, typed calls to BID's app API. Call them from your app's SERVER with the
 * user's access token from the BID login — the same token as /api/app/profile.
 * BID derives the user (sub) and the product from that token; nothing you send can
 * point at another user or another product.
 */

/** The one place BID's address lives in this package. */
export const BID_URL = "https://id.broberg.ai";

export type AcceptedDoc = "terms" | "dpa" | "modules";

export interface AcceptanceRecord {
  sub: string;
  product: string;
  doc: AcceptedDoc;
  version: string;
  contentHash: string;
  /** Epoch ms, set by BID. */
  acceptedAt: number;
  clientId: string;
}

export interface ConsentRecord {
  sub: string;
  product: string;
  purpose: string;
  granted: boolean;
  version: string;
  contentHash: string;
  /** Epoch ms, set by BID. */
  at: number;
  /** "bid-account" when the user withdrew on their BID account. */
  clientId: string;
}

export interface BidCallOptions {
  /** The user's access token from the BID login. Never a token of yours. */
  accessToken: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

export class BidConsentError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "BidConsentError";
  }
}

/** Our hashes are 64 hex; BID wants «sha256:<64 hex>». Accepts either. */
export function toBidHash(contentHash: string): string {
  return contentHash.startsWith("sha256:") ? contentHash : `sha256:${contentHash}`;
}

async function call<T>(opts: BidCallOptions, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await (opts.fetch ?? fetch)(`${opts.baseUrl ?? BID_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${opts.accessToken}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* an empty or non-JSON body is reported below */ }
  if (!res.ok) {
    throw new BidConsentError(res.status, json?.error ?? `http_${res.status}`, `BID answered ${res.status}${json?.error ? ` ${json.error}` : ""} on ${method} ${path}`);
  }
  return json as T;
}

/** Record that the user accepted this version of a document. Returns the row BID stored (read back). */
export async function recordAcceptance(opts: BidCallOptions, a: { doc: AcceptedDoc; version: string; contentHash: string }): Promise<AcceptanceRecord> {
  const sent = { doc: a.doc, version: a.version, contentHash: toBidHash(a.contentHash) };
  const row = await call<AcceptanceRecord>(opts, "POST", "/api/app/terms-acceptance", sent);
  // A save is only proven when the stored row says what we sent.
  if (row?.doc !== sent.doc || row?.version !== sent.version || row?.contentHash !== sent.contentHash) {
    throw new BidConsentError(200, "not_echoed", "BID's stored acceptance does not match what was sent");
  }
  return row;
}

/** The user's latest acceptance of a document for YOUR product, or null. */
export async function getAcceptance(opts: BidCallOptions, doc: AcceptedDoc): Promise<AcceptanceRecord | null> {
  const r = await call<{ acceptance: AcceptanceRecord | null }>(opts, "GET", `/api/app/terms-acceptance?doc=${encodeURIComponent(doc)}`);
  return r?.acceptance ?? null;
}

/** Record a GDPR consent given (granted:true) or withdrawn (granted:false). Returns the stored row (read back). */
export async function recordConsent(opts: BidCallOptions, c: { purpose: string; granted: boolean; version: string; contentHash: string }): Promise<ConsentRecord> {
  const sent = { purpose: c.purpose, granted: c.granted, version: c.version, contentHash: toBidHash(c.contentHash) };
  const row = await call<ConsentRecord>(opts, "POST", "/api/app/consents", sent);
  if (row?.purpose !== sent.purpose || row?.granted !== sent.granted || row?.version !== sent.version || row?.contentHash !== sent.contentHash) {
    throw new BidConsentError(200, "not_echoed", "BID's stored consent does not match what was sent");
  }
  return row;
}

/** The CURRENT state of a consent for YOUR product (latest row), or null if never asked. Read it before you use the data. */
export async function getConsent(opts: BidCallOptions, purpose: string): Promise<ConsentRecord | null> {
  const r = await call<{ consent: ConsentRecord | null }>(opts, "GET", `/api/app/consents?purpose=${encodeURIComponent(purpose)}`);
  return r?.consent ?? null;
}

/**
 * Must the user accept the terms again? Yes when they never accepted, or when the
 * current terms are a MATERIAL change and newer than what they accepted. A
 * non-material change is announced, not re-asked (terms «Ændringer»).
 * Versions are ISO dates, so they compare as strings.
 */
export function needsReaccept(latest: Pick<AcceptanceRecord, "version"> | null, current: { version: string; material: boolean }): boolean {
  if (!latest) return true;
  if (latest.version === current.version) return false;
  return current.material && current.version > latest.version;
}
