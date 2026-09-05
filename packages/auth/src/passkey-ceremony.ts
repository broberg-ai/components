/**
 * F008.13 — the passkey ceremony, WITHOUT a session.
 *
 * `@broberg/auth/passkey` mounts Better Auth's passkey plugin, and that plugin
 * welds the ceremony to Better Auth's own session: measured in
 * `@better-auth/passkey@1.6.23`, `verify-authentication` unconditionally calls
 * `createSession()` → `findUserById()` → `setSessionCookie()`, with no flag and
 * no branch. Its `afterVerification` hook fires *before* that block, so a
 * consumer who mints their own session there ends up with TWO. A hook that runs
 * at the right moment is not an opt-out, and from the signature it reads like
 * one.
 *
 * This module is for a repo that already owns its sessions. It answers exactly
 * one question —
 *
 *     which user just proved possession of this credential,
 *     and did their device verify who was holding it?
 *
 * — and then stops. No session, no cookie, no user object. The caller mints its
 * own session exactly as it does today.
 *
 * WHAT IT DELIBERATELY DOES NOT HAVE, because trail measured why (2026-09-05):
 *
 *   · **No user method of any kind.** Their `control_users.organization_id` is
 *     NOT NULL with an FK, so a passkey registration cannot lawfully create a
 *     user — and *which* organisation is a business decision, not something a
 *     ceremony derives. Their words: "if the interface has a findOrCreateUser,
 *     it is the one method we have to refuse to implement." An interface with a
 *     method a consumer must refuse is broken, not flexible.
 *   · **No format assumption on `userId`.** They have two live formats
 *     (`u-<hex8>` from invite, `usr_lens_<hex8>` for a synthetic Lens
 *     principal). A UUID check would reject the Lens principal and nothing
 *     else — breaking only on the one user nobody tests with.
 *   · **No tenant scoping.** A user holds memberships in several tenants with
 *     the active one chosen per request. Scope a credential tenant-ward and the
 *     same person on the same phone gets a key that works in one workspace and
 *     not the other.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

// ── errors ───────────────────────────────────────────────────────────────────

export type PasskeyCeremonyErrorCode =
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_WRONG_CEREMONY"
  | "CREDENTIAL_NOT_FOUND"
  | "CREDENTIAL_ALREADY_REGISTERED"
  | "VERIFICATION_FAILED"
  | "USER_VERIFICATION_REQUIRED";

/** Every refusal is this, with a machine-readable `code`. Deliberately not
 *  better-auth's `APIError`: importing it would put better-auth back into the
 *  import graph of the one entry point that exists to work without it. */
export class PasskeyCeremonyError extends Error {
  readonly code: PasskeyCeremonyErrorCode;
  constructor(code: PasskeyCeremonyErrorCode, message: string) {
    super(message);
    this.name = "PasskeyCeremonyError";
    this.code = code;
  }
}

// ── the store the consumer implements ────────────────────────────────────────

/** One registered credential. `userId` is opaque — we never parse it. */
export interface StoredCredential {
  /** Base64URL credential id, as the browser reports it. */
  credentialId: string;
  /** Whose credential it is. Any non-empty string; no format is assumed. */
  userId: string;
  /** Base64URL of the COSE public key bytes. Produced by `registration.finish`. */
  publicKey: string;
  /** WebAuthn signature counter. Many platform authenticators leave it at 0. */
  counter: number;
  /** Transport hints ("internal", "hybrid", …) — passed straight back to the browser. */
  transports?: string[];
}

export interface ChallengeRecord {
  /** Opaque id the caller carries between `begin` and `finish` (cookie, session, form field). */
  id: string;
  challenge: string;
  ceremony: "registration" | "authentication";
  /** Present for registration, and for an authentication begun for a known user. */
  userId?: string;
  /** Epoch ms. */
  expiresAt: number;
}

/**
 * The consumer's database, behind six methods. **There is no user method, and
 * that is a design decision, not an omission** — see the module docstring.
 */
export interface PasskeyStore {
  putChallenge(record: ChallengeRecord): Promise<void> | void;
  /**
   * Return the record for `id` **and delete it in the same operation.** A store
   * that only reads makes a challenge replayable: every other test in this
   * module still passes, and the one property that stops a captured assertion
   * being reused is silently gone.
   */
  takeChallenge(id: string): Promise<ChallengeRecord | null> | ChallengeRecord | null;
  getCredential(credentialId: string): Promise<StoredCredential | null> | StoredCredential | null;
  listCredentialsByUser(userId: string): Promise<StoredCredential[]> | StoredCredential[];
  saveCredential(credential: StoredCredential): Promise<void> | void;
  updateCredentialCounter(credentialId: string, counter: number): Promise<void> | void;
}

// ── config ───────────────────────────────────────────────────────────────────

export interface PasskeyCeremonyConfig {
  /** Relying-Party ID — the registrable domain, e.g. "app.trailmem.com" (no scheme/port). */
  rpID: string;
  /** Name shown in the OS passkey prompt, e.g. "Trail". */
  rpName: string;
  /** Expected origin(s), e.g. "https://app.trailmem.com". */
  origin: string | string[];
  store: PasskeyStore;
  /**
   * Require that the authenticator ACTUALLY VERIFIED THE USER — a face, a
   * fingerprint or a device passcode — and refuse when it did not.
   *
   * ⚠️ **This is DEVICE-OWNER verification, not Face ID.** With no Face ID or
   * Touch ID configured but a passcode set, iOS falls back to the passcode and
   * still reports the user as verified. Never promise a user a face and then
   * accept a four-digit code.
   *
   * Default `false`, for the same reason `@broberg/auth/passkey` defaults it
   * off: turning it on refuses sign-ins that work today. On iOS the flag is
   * always set anyway — so with this off, the guarantee holds because of the
   * PLATFORM, not because anything enforces it.
   *
   * @default false
   */
  requireUserVerification?: boolean;
  /** How long a challenge stays valid. @default 300000 (5 minutes) */
  challengeTtlMs?: number;
  /** Challenge id generator. Defaults to `crypto.randomUUID()`. */
  newChallengeId?: () => string;
  /** Clock, injectable so expiry is testable without waiting. @default Date.now */
  now?: () => number;
}

// ── base64url, without a dependency and without Buffer ───────────────────────
// Buffer is Node-only; this entry point runs on Bun and workers too.

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    out += B64URL[a >> 2];
    out += B64URL[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += B64URL[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += B64URL[c & 63];
  }
  return out;
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [];
  let buffer = 0, bits = 0;
  for (const ch of s) {
    const v = B64URL.indexOf(ch);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  // An explicit ArrayBuffer, not `new Uint8Array(bytes)`: TS 5.7 narrowed the
  // typed-array types, and the plain form widens to ArrayBufferLike — which
  // SimpleWebAuthn's BufferSource parameter then rejects.
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

// ── the ceremony ─────────────────────────────────────────────────────────────

export interface BeginResult<T> {
  /** Pass straight to the browser's `startRegistration` / `startAuthentication`. */
  options: T;
  /** Carry this to `finish` — a cookie, your session, a hidden field. Not a secret. */
  challengeId: string;
}

export interface PasskeyCeremony {
  registration: {
    begin(input: { userId: string; userName: string; userDisplayName?: string }): Promise<BeginResult<Awaited<ReturnType<typeof generateRegistrationOptions>>>>;
    finish(input: { challengeId: string; response: unknown }): Promise<{ userId: string; credentialId: string }>;
  };
  authentication: {
    begin(input?: { userId?: string }): Promise<BeginResult<Awaited<ReturnType<typeof generateAuthenticationOptions>>>>;
    finish(input: { challengeId: string; response: unknown }): Promise<{ userId: string; credentialId: string }>;
  };
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function createPasskeyCeremony(cfg: PasskeyCeremonyConfig): PasskeyCeremony {
  const {
    rpID, rpName, origin, store,
    requireUserVerification = false,
    challengeTtlMs = DEFAULT_TTL_MS,
    newChallengeId = () => crypto.randomUUID(),
    now = () => Date.now(),
  } = cfg;

  /** Take the challenge, prove it is the right one, and refuse a replay.
   *  `takeChallenge` deletes, so a second call for the same id lands here as
   *  CHALLENGE_NOT_FOUND — which is what makes a captured response single-use. */
  async function take(challengeId: string, ceremony: ChallengeRecord["ceremony"]): Promise<ChallengeRecord> {
    const rec = await store.takeChallenge(challengeId);
    if (!rec) {
      throw new PasskeyCeremonyError(
        "CHALLENGE_NOT_FOUND",
        "No pending challenge for this id. It was already used, it expired, or it was never issued.",
      );
    }
    if (rec.ceremony !== ceremony) {
      throw new PasskeyCeremonyError(
        "CHALLENGE_WRONG_CEREMONY",
        `This challenge was issued for ${rec.ceremony}, not ${ceremony}.`,
      );
    }
    if (rec.expiresAt <= now()) {
      throw new PasskeyCeremonyError("CHALLENGE_EXPIRED", "This challenge has expired. Start the ceremony again.");
    }
    return rec;
  }

  /** The F008.12 guard, in one place so registration and authentication cannot
   *  drift apart. `!== true` rather than `=== false`: a MISSING field must fail
   *  closed, or a future library that stops reporting it silently disables the
   *  check. 0.5.0 shipped this on authentication only, and a credential could be
   *  enrolled unverified and then fail every single sign-in. */
  function assertUserVerified(userVerified: boolean | undefined, what: "register" | "sign in"): void {
    if (!requireUserVerification) return;
    if (userVerified === true) return;
    throw new PasskeyCeremonyError(
      "USER_VERIFICATION_REQUIRED",
      `To ${what} here the device must verify you (Face ID, Touch ID, fingerprint or device passcode). ` +
        "The authenticator completed without doing so.",
    );
  }

  return {
    registration: {
      async begin({ userId, userName, userDisplayName }) {
        const existing = await store.listCredentialsByUser(userId);
        const options = await generateRegistrationOptions({
          rpID,
          rpName,
          userName,
          userDisplayName,
          userID: new TextEncoder().encode(userId),
          attestationType: "none",
          excludeCredentials: existing.map((c) => ({
            id: c.credentialId,
            transports: c.transports as never,
          })),
          authenticatorSelection: {
            residentKey: "preferred",
            // "required" only when we intend to enforce it. Asking for a
            // verification we then ignore is the mismatch this module exists to
            // remove — the prompt would promise the user something the server
            // never checks.
            userVerification: requireUserVerification ? "required" : "preferred",
          },
        });

        const challengeId = newChallengeId();
        await store.putChallenge({
          id: challengeId,
          challenge: options.challenge,
          ceremony: "registration",
          userId,
          expiresAt: now() + challengeTtlMs,
        });
        return { options, challengeId };
      },

      async finish({ challengeId, response }) {
        const rec = await take(challengeId, "registration");
        // The userId comes from the CHALLENGE WE ISSUED, never from the request
        // body. A caller cannot enrol a credential against someone else's id by
        // replaying a response with a different one attached.
        const userId = rec.userId!;

        let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
        try {
          verification = await verifyRegistrationResponse({
            response: response as never,
            expectedChallenge: rec.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: false, // checked below, so the message is ours
          });
        } catch (e) {
          throw new PasskeyCeremonyError("VERIFICATION_FAILED", (e as Error).message);
        }

        if (!verification.verified || !verification.registrationInfo) {
          throw new PasskeyCeremonyError("VERIFICATION_FAILED", "The registration response did not verify.");
        }
        assertUserVerified(verification.registrationInfo.userVerified, "register");

        const cred = verification.registrationInfo.credential;
        if (await store.getCredential(cred.id)) {
          throw new PasskeyCeremonyError(
            "CREDENTIAL_ALREADY_REGISTERED",
            "That credential is already registered.",
          );
        }

        await store.saveCredential({
          credentialId: cred.id,
          userId,
          publicKey: toBase64Url(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports as string[] | undefined,
        });
        return { userId, credentialId: cred.id };
      },
    },

    authentication: {
      async begin(input = {}) {
        const { userId } = input;
        const allow = userId ? await store.listCredentialsByUser(userId) : [];
        const options = await generateAuthenticationOptions({
          rpID,
          userVerification: requireUserVerification ? "required" : "preferred",
          // No userId → no allowCredentials → a discoverable (usernameless)
          // sign-in, which is what "unlock with Face ID" actually looks like.
          allowCredentials: userId
            ? allow.map((c) => ({ id: c.credentialId, transports: c.transports as never }))
            : undefined,
        });

        const challengeId = newChallengeId();
        await store.putChallenge({
          id: challengeId,
          challenge: options.challenge,
          ceremony: "authentication",
          userId,
          expiresAt: now() + challengeTtlMs,
        });
        return { options, challengeId };
      },

      async finish({ challengeId, response }) {
        const rec = await take(challengeId, "authentication");
        const credentialId = (response as { id?: unknown })?.id;
        if (typeof credentialId !== "string" || !credentialId) {
          throw new PasskeyCeremonyError("VERIFICATION_FAILED", "The response carried no credential id.");
        }

        const stored = await store.getCredential(credentialId);
        if (!stored) {
          throw new PasskeyCeremonyError("CREDENTIAL_NOT_FOUND", "That credential is not registered here.");
        }
        // A challenge issued FOR a named user must not be answered by another
        // user's credential. Without this a discoverable-vs-targeted mix-up
        // would let a valid assertion satisfy someone else's pending challenge.
        if (rec.userId !== undefined && rec.userId !== stored.userId) {
          throw new PasskeyCeremonyError(
            "CREDENTIAL_NOT_FOUND",
            "That credential does not belong to the user this challenge was issued for.",
          );
        }

        let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
        try {
          verification = await verifyAuthenticationResponse({
            response: response as never,
            expectedChallenge: rec.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
              id: stored.credentialId,
              publicKey: fromBase64Url(stored.publicKey),
              counter: stored.counter,
              transports: stored.transports as never,
            },
            requireUserVerification: false, // checked below, so the message is ours
          });
        } catch (e) {
          throw new PasskeyCeremonyError("VERIFICATION_FAILED", (e as Error).message);
        }

        if (!verification.verified) {
          throw new PasskeyCeremonyError("VERIFICATION_FAILED", "The assertion did not verify.");
        }
        assertUserVerified(verification.authenticationInfo.userVerified, "sign in");

        await store.updateCredentialCounter(stored.credentialId, verification.authenticationInfo.newCounter);
        return { userId: stored.userId, credentialId: stored.credentialId };
      },
    },
  };
}
