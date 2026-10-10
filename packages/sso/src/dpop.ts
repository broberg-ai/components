/**
 * F084.157 — DPoP (RFC 9449): a bound ticket works only for whoever holds the key
 * (broberg-id-F087.16, joint design #2572/#2574).
 *
 * A DPoP-bound ticket carries `cnf.jkt`, the thumbprint of the caller's public
 * key. With every request the caller signs a short PROOF (method, URL, time, a
 * hash of the ticket) with the matching private key. A ticket copied out of a log
 * is useless on another machine: it has the ticket, not the key.
 *
 * THE RULE THAT MAKES IT PROTECTION (agreed with broberg-id, (A) in #2574): once a
 * receiver verifies with this version, a ticket WITH cnf.jkt needs a valid proof —
 * also while DPoP is otherwise optional. `requireDpop` only decides whether
 * UNBOUND tickets are still accepted. Were bound tickets accepted without a proof
 * during the rollout, a stolen bound ticket would work as bearer the whole time.
 *
 * Not here yet: server nonces (RFC 9449 §8). The jti replay store covers replay
 * inside the iat window.
 */
import {
  SignJWT,
  calculateJwkThumbprint,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type JWK,
} from "jose";
import { SsoError } from "./client.js";

/** One process's DPoP key. The private half cannot be exported. */
export interface DpopKey {
  privateKey: CryptoKey;
  publicJwk: JWK;
  /** RFC 7638 thumbprint — what BID puts in the ticket's cnf.jkt. */
  jkt: string;
}

/** A fresh ES256 key pair, private key non-extractable, never written anywhere. */
export async function createDpopKey(): Promise<DpopKey> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: false });
  const jwk = await exportJWK(publicKey); // a public key is always exportable
  const publicJwk: JWK = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  return { privateKey, publicJwk, jkt: await calculateJwkThumbprint(publicJwk) };
}

const enc = new TextEncoder();
const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** `ath`: base64url(SHA-256(ticket)) — ties a proof to one ticket. */
export async function accessTokenHash(ticket: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(ticket)));
}

/** RFC 9449 §4.3: htu is compared without query and fragment. */
export function normalizeHtu(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}${u.pathname}`;
}

/** Sign one proof. Pass `ticket` when calling a resource server (adds ath); omit it for BID's token endpoint. */
export async function createDpopProof(
  key: DpopKey,
  opts: { method: string; url: string; ticket?: string; now?: () => number },
): Promise<string> {
  const payload: Record<string, unknown> = {
    jti: crypto.randomUUID(),
    htm: opts.method.toUpperCase(),
    htu: normalizeHtu(opts.url),
    iat: Math.floor((opts.now?.() ?? Date.now()) / 1000),
  };
  if (opts.ticket !== undefined) payload.ath = await accessTokenHash(opts.ticket);
  return new SignJWT(payload).setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk: key.publicJwk }).sign(key.privateKey);
}

/**
 * Remembers which proofs were already used. The default is in-memory, which
 * holds on ONE machine: a receiver running on two machines must pass a shared
 * store, or a proof replayed against the other machine inside the window passes.
 */
export interface ReplayStore {
  /** Record `key`; resolve true if it was already recorded within `ttlMs`. */
  seen(key: string, ttlMs: number): Promise<boolean>;
}

export function createMemoryReplayStore(now: () => number = () => Date.now()): ReplayStore {
  const entries = new Map<string, number>();
  return {
    async seen(key, ttlMs) {
      const t = now();
      for (const [k, until] of entries) if (until <= t) entries.delete(k);
      if (entries.has(key)) return true;
      entries.set(key, t + ttlMs);
      return false;
    },
  };
}

export interface VerifyProofOptions {
  method: string;
  /** The receiver's PUBLIC URL for this request (behind a proxy the process sees an internal one). */
  url: string;
  ticket: string;
  jkt: string;
  replay: ReplayStore;
  iatWindowSec: number;
  now: () => number;
}

const ASYMMETRIC = new Set(["ES256", "ES384", "ES512", "EdDSA", "PS256", "PS384", "PS512", "RS256", "RS384", "RS512"]);

/** Throws SsoError naming the first thing that is wrong. */
export async function verifyDpopProof(proof: string, o: VerifyProofOptions): Promise<void> {
  let header;
  try {
    header = decodeProtectedHeader(proof);
  } catch {
    throw new SsoError("DPoP proof is not a JWS");
  }
  if (header.typ !== "dpop+jwt") throw new SsoError(`DPoP proof has typ ${JSON.stringify(header.typ)}, not "dpop+jwt"`);
  if (!header.alg || !ASYMMETRIC.has(header.alg)) throw new SsoError(`DPoP proof alg ${JSON.stringify(header.alg)} is not an accepted asymmetric algorithm`);
  const jwk = header.jwk as JWK | undefined;
  if (!jwk || typeof jwk !== "object") throw new SsoError("DPoP proof carries no jwk");
  if ("d" in jwk) throw new SsoError("DPoP proof jwk contains a private key");

  let payload;
  try {
    const key = await importJWK(jwk, header.alg);
    ({ payload } = await jwtVerify(proof, key, { typ: "dpop+jwt", algorithms: [header.alg] }));
  } catch (e) {
    throw new SsoError(`DPoP proof signature rejected: ${e instanceof Error ? e.message : String(e)}`);
  }

  if ((await calculateJwkThumbprint(jwk)) !== o.jkt) throw new SsoError("DPoP proof key does not match the ticket's cnf.jkt");
  if (payload.htm !== o.method.toUpperCase()) throw new SsoError(`DPoP proof is for ${JSON.stringify(payload.htm)}, the request is ${o.method.toUpperCase()}`);
  let htu: string;
  try {
    htu = normalizeHtu(String(payload.htu));
  } catch {
    throw new SsoError("DPoP proof htu is not a URL");
  }
  if (htu !== normalizeHtu(o.url)) throw new SsoError(`DPoP proof is for ${htu}, the request is ${normalizeHtu(o.url)}`);
  const nowSec = Math.floor(o.now() / 1000);
  if (typeof payload.iat !== "number" || Math.abs(nowSec - payload.iat) > o.iatWindowSec) {
    throw new SsoError(`DPoP proof iat is outside ±${o.iatWindowSec}s`);
  }
  if (payload.ath !== (await accessTokenHash(o.ticket))) throw new SsoError("DPoP proof ath does not match this ticket");
  if (typeof payload.jti !== "string" || payload.jti === "") throw new SsoError("DPoP proof has no jti");
  if (await o.replay.seen(`${o.jkt}:${payload.jti}`, o.iatWindowSec * 2 * 1000)) {
    throw new SsoError("DPoP proof was already used (jti replay)");
  }
}
