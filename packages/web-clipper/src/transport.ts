// @broberg/web-clipper/transport — F099.4. The destination plug-in point and
// the sender (contract F099.1, docs/features/F099-web-clipper.md).
//
// A destination knows how to talk to ITS backend (Trail, Jam). The base owns
// what every clipper needs the same way:
//  - send only what is new (appendOnly destinations), with the chain
//    fingerprint as the idempotency key, so a resend never duplicates;
//  - batches: each batch that succeeds is committed at the destination, so an
//    interrupted run resumes where it stopped — nothing twice, nothing lost;
//  - the response rules (trail #2984):
//      401        → refresh the session ONCE and resend; no session, or 401
//                   again → "login_required" (the UI says «log ind igen»)
//      5xx / net  → retry with backoff — NEVER read as a login failure
//      other 4xx  → give up with a named state
//  - the consent gate (jam 7): a destination that requires consent gets
//    nothing until recording is switched on for that anchor.
// The base never sends a clip to a destination the build did not register; it
// keeps no state shared across extensions — everything is per call.
import { chain, diff, type Link } from "./core";
import type { Asset, Clip, Unit } from "./extract";

export interface Session {
  accessToken: string;
  sub: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** What the sender needs from auth (F099.5 implements it). */
export interface SessionSource {
  /** The current session; `{ refresh: true }` forces a fresh one. null → the user must log in again. */
  session(options?: { refresh?: boolean }): Promise<Session | null>;
}

export interface Target { id: string; label: string; group?: string }

export interface SendContext {
  idempotencyKeys: string[];
  target: Target;
  session: Session;
  clip: Clip;
  branch?: { forkAt: number; parentChainFp: string };
}

export interface Destination {
  id: string;
  label: string;
  /** Default false: the whole clip every time (Trail: one source per URL). */
  appendOnly?: boolean;
  /** Recording must be switched on per anchor before anything is sent (Jam). */
  requiresConsent?: boolean;
  targets(session: Session): Promise<Target[]>;
  /** Chain fingerprints the destination already holds for this anchor, in order (appendOnly only). */
  lastSeen?(anchor: string, target: Target, session: Session): Promise<string[]>;
  send(units: Unit[], ctx: SendContext): Promise<void>;
  uploadAsset?(asset: Asset, ctx: { target: Target; session: Session }): Promise<{ url: string }>;
}

/**
 * A destination reports an HTTP answer by throwing this with the status.
 * Anything else it throws (fetch's TypeError, a timeout) counts as a network
 * failure: retried, never read as a login problem.
 */
export class DestinationError extends Error {
  constructor(readonly status: number, message?: string) {
    super(message ?? `destination answered ${status}`);
    this.name = "DestinationError";
  }
}

export type SendResult =
  | { state: "sent"; mode: "same" | "append" | "branch"; sent: number; idempotencyKeys: string[] }
  | { state: "login_required" }
  | { state: "consent_required" }
  /** A 4xx other than 401: the destination refused the clip. Not retried. */
  | { state: "refused"; status: number; message: string }
  /** Retries exhausted on 5xx or network. `sent` units went through before it stopped. */
  | { state: "unavailable"; status: number | null; message: string; sent: number };

export interface SendOptions {
  destination: Destination;
  target: Target;
  clip: Clip;
  auth: SessionSource;
  /** For requiresConsent destinations: has recording been switched on for clip.anchor? */
  consented?: boolean;
  /** Units per send call. Each successful batch is committed. Default 50. */
  batchSize?: number;
  /** Attempts per batch on 5xx / network, including the first. Default 4. */
  attempts?: number;
  /** First backoff in ms; doubles each retry. Default 500. */
  backoffMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function sendClip(opts: SendOptions): Promise<SendResult> {
  const { destination, target, clip, auth } = opts;
  const batchSize = opts.batchSize ?? 50;
  const attempts = opts.attempts ?? 4;
  const backoffMs = opts.backoffMs ?? 500;
  const sleep = opts.sleep ?? wait;

  if (destination.requiresConsent && !opts.consented) return { state: "consent_required" };

  let session = await auth.session();
  if (!session) return { state: "login_required" };

  // What does the destination already hold? Only an appendOnly destination
  // remembers a chain; every other one gets the whole clip, every time.
  let known: string[] = [];
  if (destination.appendOnly && clip.anchor && destination.lastSeen) {
    const r = await withRules(() => destination.lastSeen!(clip.anchor!, target, session!));
    if (r.kind !== "ok") return r.result(0);
    known = r.value;
  }

  const d = await diff(known, clip.units);
  if (d.kind === "same") return { state: "sent", mode: "same", sent: 0, idempotencyKeys: [] };
  const links: Link[] = d.links;
  const units = d.units as Unit[];
  const branch = d.kind === "branch" ? { forkAt: d.forkAt, parentChainFp: d.parentChainFp } : undefined;

  let sent = 0;
  for (let i = 0; i < units.length; i += batchSize) {
    const batch = units.slice(i, i + batchSize);
    const keys = links.slice(i, i + batchSize).map((l) => l.chainFp);
    // The branch marker belongs to the first batch only: later batches extend the new line.
    const ctx = (): SendContext => ({ idempotencyKeys: keys, target, session: session!, clip, ...(i === 0 && branch ? { branch } : {}) });
    const r = await withRules(() => destination.send(batch, ctx()));
    if (r.kind !== "ok") return r.result(sent);
    sent += batch.length;
  }
  return { state: "sent", mode: d.kind, sent, idempotencyKeys: links.map((l) => l.chainFp) };

  // One call under the response rules: refresh once on 401, back off on 5xx/network.
  async function withRules<T>(call: () => Promise<T>): Promise<
    { kind: "ok"; value: T } | { kind: "stop"; result: (sent: number) => SendResult }
  > {
    let refreshed = false;
    let last: { status: number | null; message: string } = { status: null, message: "" };
    for (let attempt = 0; attempt < attempts; ) {
      try {
        return { kind: "ok", value: await call() };
      } catch (e) {
        const status = e instanceof DestinationError ? e.status : null;
        const message = e instanceof Error ? e.message : String(e);
        if (status === 401) {
          if (refreshed) return { kind: "stop", result: () => ({ state: "login_required" }) };
          refreshed = true;
          const fresh = await auth.session({ refresh: true });
          if (!fresh) return { kind: "stop", result: () => ({ state: "login_required" }) };
          session = fresh;
          continue; // the refresh retry does not spend a backoff attempt
        }
        if (status !== null && status >= 400 && status < 500) {
          return { kind: "stop", result: () => ({ state: "refused", status, message }) };
        }
        last = { status, message };
        attempt++;
        if (attempt < attempts) await sleep(backoffMs * 2 ** (attempt - 1));
      }
    }
    return { kind: "stop", result: (sent) => ({ state: "unavailable", status: last.status, message: last.message, sent }) };
  }
}

/** The chain fingerprints of a clip, in order — what an appendOnly destination stores. */
export async function chainFps(units: readonly Unit[]): Promise<string[]> {
  return (await chain(units)).map((l) => l.chainFp);
}
