// components-F084.165 — embedded login and signup from the app's SERVER (BID F084.166 contract
// v1.1 «web-klient» + F084.167 contract v1 «oprettelse», broberg-ai/broberg-id@022b07b).
//
// The app draws its own screen; this does the part every app would otherwise hand-roll: call
// BID's /embedded/* as a confidential client, keep the PKCE verifier and nonce on the server side
// of a signed cookie, swap the code exactly like completeLogin and return the SAME LoginResult —
// so the app's existing signSession step is unchanged.
import { signValue, verifyValue } from "./session.js";
import type { LoginResult } from "./client.js";

/** What a step can answer, as data the app can word itself (the contract's error table). */
export type EmbeddedError =
  | { kind: "invalid_code"; attemptsLeft?: number }
  | { kind: "expired" }
  | { kind: "locked"; retryAfter?: number }
  | { kind: "too_many_requests"; retryAfter?: number }
  | { kind: "not_embedded" }
  | { kind: "signup_not_enabled" }
  | { kind: "terms_outdated"; version?: string }
  | { kind: "invalid_request" }
  | { kind: "unavailable"; message: string };

/** The server-side state of one embedded login: keep it in a signed cookie (sealEmbeddedFlow). */
export interface EmbeddedFlow {
  flowId: string;
  codeVerifier: string;
  nonce: string;
  email: string;
}

export interface EmbeddedStartInput {
  email: string;
  /** "signup" creates the account at verify (BID F084.167); needs `name` and the current `termsVersion`. */
  intent?: "login" | "signup";
  name?: string;
  termsVersion?: string;
  /** The user's IP, for BID's per-IP limit. Without it, BID counts your server's IP. */
  endUserIp?: string;
}

export type EmbeddedStart = { ok: true; flow: EmbeddedFlow; expiresIn: number } | { ok: false; error: EmbeddedError };

/** After a code: signed in (the same result as completeLogin), a second factor, or an error. */
export type EmbeddedStep =
  | { kind: "done"; result: LoginResult }
  | { kind: "second_factor"; methods: ("totp" | "sms")[] }
  | { kind: "error"; error: EmbeddedError };

export interface EmbeddedTerms {
  version: string;
  /** Show it VERBATIM at the button — BID owns the text. */
  text: string;
  links: { label: string; url: string }[];
}

export interface EmbeddedClient {
  start(input: EmbeddedStartInput): Promise<EmbeddedStart>;
  verify(flow: EmbeddedFlow, code: string): Promise<EmbeddedStep>;
  sendSms(flow: EmbeddedFlow): Promise<{ ok: true } | { ok: false; error: EmbeddedError }>;
  verifySecondFactor(flow: EmbeddedFlow, method: "totp" | "sms", code: string): Promise<EmbeddedStep>;
  /** BID's consent text for signup, current version. Throws SsoError if BID does not answer it. */
  terms(lang: "da" | "en"): Promise<EmbeddedTerms>;
}

/** A flow lives as long as BID's code does (10 min). */
export const EMBEDDED_FLOW_MAX_AGE = 600;

/** Seal the flow for a signed, httpOnly cookie (same signing as the login transaction). */
export function sealEmbeddedFlow(flow: EmbeddedFlow, secret: string, options: { now?: () => number } = {}): Promise<string> {
  return signValue(JSON.stringify(flow), secret, { maxAgeSeconds: EMBEDDED_FLOW_MAX_AGE, ...options });
}

/** Read it back: the flow, or why not — "absent" (no cookie), "expired" (too old), "unreadable" (not ours / tampered). */
export async function openEmbeddedFlow(
  raw: string | undefined | null,
  secret: string,
  options: { now?: () => number } = {},
): Promise<{ ok: true; flow: EmbeddedFlow } | { ok: false; reason: "absent" | "expired" | "unreadable" }> {
  if (!raw) return { ok: false, reason: "absent" };
  if ((await verifyValue(raw, secret)) === null) return { ok: false, reason: "unreadable" };
  const fresh = await verifyValue(raw, secret, { maxAgeSeconds: EMBEDDED_FLOW_MAX_AGE, ...options });
  if (fresh === null) return { ok: false, reason: "expired" };
  try {
    const f = JSON.parse(fresh) as Partial<EmbeddedFlow>;
    if (typeof f.flowId !== "string" || typeof f.codeVerifier !== "string" || typeof f.nonce !== "string" || typeof f.email !== "string") return { ok: false, reason: "unreadable" };
    return { ok: true, flow: f as EmbeddedFlow };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** Map a non-2xx /embedded answer to the contract's error table. */
export function embeddedError(status: number, body: Record<string, unknown>): EmbeddedError {
  const code = typeof body.error === "string" ? body.error : "";
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  if (status === 400 && code === "invalid_code") return { kind: "invalid_code", ...(num(body.attempts_left) !== undefined ? { attemptsLeft: num(body.attempts_left) } : {}) };
  if (status === 400 && code === "expired") return { kind: "expired" };
  if (status === 400 && code === "terms_outdated") return { kind: "terms_outdated", ...(typeof body.version === "string" ? { version: body.version } : {}) };
  if (status === 400) return { kind: "invalid_request" };
  if (status === 403 && code === "signup_not_enabled") return { kind: "signup_not_enabled" };
  if (status === 403 || status === 404 || status === 405) return { kind: "not_embedded" };
  if (status === 429) return { kind: code === "locked" ? "locked" : "too_many_requests", ...(num(body.retry_after) !== undefined ? { retryAfter: num(body.retry_after) } : {}) };
  return { kind: "unavailable", message: `BID answered ${status}${code ? ` (${code})` : ""}` };
}
