/**
 * components-F084.182 — check a FOREIGN agent's A2A agent card against BID, and
 * accept agent tickets that point at one.
 *
 * BID publishes each active agent's card at
 *   GET <issuer>/agents/<agent-id>/agent-card.json
 * signed per A2A v1.0.0 §8.4: `signatures[0] = { protected, signature }`,
 * protected = { alg: "EdDSA", kid, typ: "JOSE", jku }, and the signed payload is
 * the RFC 8785 (JCS) canonical form of the card WITHOUT its `signatures` field,
 * as a detached JWS.
 *
 * ── THE ONE RULE THAT MATTERS ─────────────────────────────────────────────
 * `jku` in the card is NEVER followed. It is data written by whoever wrote the
 * card, so trusting it means trusting the card to name its own judge: a forged
 * card would simply point at a key set its forger controls. The key-set URL is
 * DERIVED from the issuer we were configured with, and a card whose jku names
 * anything else is refused as `untrusted_jku` without that URL being fetched.
 *
 * ── NAMED OUTCOMES, NOT ONE "INVALID" ─────────────────────────────────────
 * `jwks_unreachable` means we could not ask BID right now — the card may be
 * perfectly good (answer 503, retry). Every other reason means the card is not
 * acceptable (answer 401/403). Collapsing them is how an outage at BID would
 * read as "every agent in the fleet is forged".
 */
import { decodeJwt, flattenedVerify } from "jose";
import { SsoError } from "./client.js";
import { createJwksCache, JwksUnavailableError, JwksUnknownKeyError, type JwksCache } from "./jwks.js";
import { createTicketVerifier, type TicketPrincipal, type TicketVerifierOptions } from "./ticket.js";

export type AgentCardFailure = "malformed" | "untrusted_jku" | "unknown_kid" | "bad_signature" | "jwks_unreachable";

export type AgentCardResult =
  | { ok: true; kid: string; card: Record<string, unknown> }
  | { ok: false; reason: AgentCardFailure; detail: string };

/** The only key-set URL an agent card may name: derived from the issuer, never read from the card. */
export function agentCardJwksUri(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/agent-card-jwks.json`;
}

/**
 * RFC 8785 JSON Canonicalization Scheme. Numbers and strings serialise exactly
 * as ECMAScript's JSON.stringify does (which is what the RFC specifies); object
 * members are ordered by their UTF-16 code units, which is the default string
 * sort. Non-finite numbers have no JSON form and are refused.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new SsoError("JCS: a non-finite number has no JSON form");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
  }
  throw new SsoError(`JCS: ${typeof value} has no JSON form`);
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface AgentCardVerifierOptions {
  /** BID's issuer, e.g. `https://id.broberg.ai`. The key set is derived from it. */
  issuer: string;
  fetchImpl?: typeof fetch;
  minRefetchIntervalMs?: number;
}

/** Verify agent cards against one issuer. Keeps one key cache across calls. */
export function createAgentCardVerifier(options: AgentCardVerifierOptions) {
  if (!options.issuer) throw new SsoError("createAgentCardVerifier needs an issuer");
  const trustedJku = agentCardJwksUri(options.issuer);
  let cache: JwksCache | null = null;
  const keys = () =>
    (cache ??= createJwksCache({
      jwksUri: trustedJku,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.minRefetchIntervalMs !== undefined ? { minRefetchIntervalMs: options.minRefetchIntervalMs } : {}),
    }));

  return {
    async verify(card: unknown): Promise<AgentCardResult> {
      const bad = (reason: AgentCardFailure, detail: string): AgentCardResult => ({ ok: false, reason, detail });
      if (!card || typeof card !== "object" || Array.isArray(card)) return bad("malformed", "the card is not a JSON object");
      const { signatures, ...unsigned } = card as Record<string, unknown>;
      const sig = Array.isArray(signatures) ? (signatures[0] as { protected?: unknown; signature?: unknown } | undefined) : undefined;
      if (!sig || typeof sig.protected !== "string" || typeof sig.signature !== "string") {
        return bad("malformed", "the card has no signatures[0] with string protected + signature");
      }
      let header: { alg?: unknown; kid?: unknown; jku?: unknown };
      try {
        header = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(sig.protected.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
      } catch {
        return bad("malformed", "signatures[0].protected is not base64url JSON");
      }
      if (header.alg !== "EdDSA") return bad("malformed", `alg must be EdDSA (got ${JSON.stringify(header.alg)})`);
      if (typeof header.kid !== "string" || header.kid === "") return bad("malformed", "the protected header has no kid");
      if (header.jku !== trustedJku) {
        return bad("untrusted_jku", `jku ${JSON.stringify(header.jku)} is not the issuer's ${trustedJku}; it was not fetched`);
      }
      let payload: string;
      try {
        payload = b64url(new TextEncoder().encode(canonicalize(unsigned)));
      } catch (e) {
        return bad("malformed", e instanceof Error ? e.message : "the card cannot be canonicalised");
      }
      let key;
      try {
        key = await keys().getKey(header.kid, "EdDSA");
      } catch (e) {
        if (e instanceof JwksUnavailableError) return bad("jwks_unreachable", e.message);
        if (e instanceof JwksUnknownKeyError) return bad("unknown_kid", `kid ${header.kid} is not in ${trustedJku}`);
        throw e;
      }
      try {
        await flattenedVerify({ protected: sig.protected, payload, signature: sig.signature }, key, { algorithms: ["EdDSA"] });
      } catch {
        return bad("bad_signature", "the signature does not cover this card");
      }
      return { ok: true, kid: header.kid, card: unsigned };
    },
  };
}

/** One-shot form of createAgentCardVerifier(...).verify(card). */
export function verifyAgentCard(card: unknown, options: AgentCardVerifierOptions): Promise<AgentCardResult> {
  return createAgentCardVerifier(options).verify(card);
}

/** A verified ticket, plus — for an agent — where its card lives. */
export interface A2APrincipal extends TicketPrincipal {
  /** The ticket's `agent_card` URL, on an agent ticket only; null for every other principal. */
  agentCard: string | null;
}

/**
 * createTicketVerifier for an A2A receiver: the same checks (signature, iss,
 * aud, principal_type, lifetime, scope, DPoP), and for an AGENT ticket the
 * `agent_card` it names — which must be the issuer's own card URL for that
 * agent, so a receiver that goes on to fetch it cannot be pointed elsewhere.
 */
export function createA2AVerifier(options: TicketVerifierOptions) {
  const tickets = createTicketVerifier(options);
  const base = options.issuer.replace(/\/+$/, "");
  return {
    async verify(token: string, opts?: Parameters<typeof tickets.verify>[1]): Promise<A2APrincipal> {
      const principal = await tickets.verify(token, opts);
      if (principal.type !== "agent") return { ...principal, agentCard: null };
      // Already verified above; this only reads one more claim from it.
      const raw = decodeJwt(token).agent_card;
      const expected = `${base}/agents/${encodeURIComponent(principal.principal)}/agent-card.json`;
      if (raw !== expected) {
        throw new SsoError(`agent ticket's agent_card ${JSON.stringify(raw)} is not the issuer's card for ${principal.principal} (${expected})`);
      }
      return { ...principal, agentCard: raw };
    },
  };
}
