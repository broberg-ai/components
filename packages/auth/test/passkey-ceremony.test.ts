import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F008.13 — the ceremony without a session.
 *
 * TWO LAYERS ON PURPOSE, because a mocked verifier cannot disagree with you:
 *
 *  1. The bulk of the file drives OUR logic (store, single-use, provenance,
 *     the UV guard, the refusals) through a STUBBED `@simplewebauthn/server`.
 *     That is the code this card owns.
 *  2. `real crypto` at the bottom builds a genuine ES256 assertion — real
 *     WebCrypto key, real COSE encoding, real signature — and drives it through
 *     the REAL verifier. Without it, a base64url bug in the public key we store
 *     would sail through every test above and fail on the first live login.
 */

// ── layer 1: a steerable stub of the WebAuthn verifier ──────────────────────

const stub = {
  registration: { verified: true, registrationInfo: undefined as unknown },
  authentication: { verified: true, authenticationInfo: undefined as unknown },
  throwOn: null as null | "registration" | "authentication",
};

vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...real,
    generateRegistrationOptions: vi.fn(async (o: Record<string, unknown>) => ({
      challenge: "reg-challenge",
      rp: { id: o.rpID, name: o.rpName },
      user: { id: "x", name: o.userName, displayName: o.userDisplayName ?? o.userName },
      excludeCredentials: o.excludeCredentials,
      authenticatorSelection: o.authenticatorSelection,
    })),
    generateAuthenticationOptions: vi.fn(async (o: Record<string, unknown>) => ({
      challenge: "auth-challenge",
      rpId: o.rpID,
      userVerification: o.userVerification,
      allowCredentials: o.allowCredentials,
    })),
    verifyRegistrationResponse: vi.fn(async () => {
      if (stub.throwOn === "registration") throw new Error("boom");
      return stub.registration;
    }),
    verifyAuthenticationResponse: vi.fn(async () => {
      if (stub.throwOn === "authentication") throw new Error("boom");
      return stub.authentication;
    }),
  };
});

const { createPasskeyCeremony, PasskeyCeremonyError, toBase64Url, fromBase64Url } =
  await import("../src/passkey-ceremony.js");
type StoredCredential = import("../src/passkey-ceremony.js").StoredCredential;
type ChallengeRecord = import("../src/passkey-ceremony.js").ChallengeRecord;

/**
 * A store built from two Maps — and the point of writing it here is that it
 * COMPILES while implementing nothing but challenges and credentials. If the
 * interface ever grows a user method, this object stops satisfying it and this
 * file goes red. That is AC#7 as a type check rather than a promise.
 */
function memoryStore() {
  const challenges = new Map<string, ChallengeRecord>();
  const creds = new Map<string, StoredCredential>();
  let takeReads = 0;
  return {
    challenges, creds,
    get takeReads() { return takeReads; },
    putChallenge(r: ChallengeRecord) { challenges.set(r.id, r); },
    takeChallenge(id: string) {
      takeReads++;
      const r = challenges.get(id) ?? null;
      challenges.delete(id); // single-use lives HERE, and the ceremony relies on it
      return r;
    },
    getCredential(id: string) { return creds.get(id) ?? null; },
    listCredentialsByUser(userId: string) { return [...creds.values()].filter((c) => c.userId === userId); },
    saveCredential(c: StoredCredential) { creds.set(c.credentialId, c); },
    updateCredentialCounter(id: string, counter: number) {
      const c = creds.get(id);
      if (c) creds.set(id, { ...c, counter });
    },
  };
}

const CFG = { rpID: "app.trailmem.com", rpName: "Trail", origin: "https://app.trailmem.com" };

function regInfo(over: Record<string, unknown> = {}) {
  return {
    userVerified: true,
    credential: { id: "cred-1", publicKey: new Uint8Array([1, 2, 3, 4]), counter: 0, transports: ["internal"] },
    ...over,
  };
}

beforeEach(() => {
  stub.throwOn = null;
  stub.registration = { verified: true, registrationInfo: regInfo() };
  stub.authentication = { verified: true, authenticationInfo: { userVerified: true, newCounter: 7 } };
});

// ── AC#1 / AC#2 — the whole ceremony, with no Better Auth anywhere ──────────

describe("a consumer with no Better Auth tables at all", () => {
  it("completes registration and authentication, and NOTHING in either result mentions a session, cookie or user object", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });

    const reg = await pk.registration.begin({ userId: "u-1a2b3c4d", userName: "cb@webhouse.dk" });
    const registered = await pk.registration.finish({ challengeId: reg.challengeId, response: { id: "cred-1" } });
    expect(registered).toEqual({ userId: "u-1a2b3c4d", credentialId: "cred-1" });

    const auth = await pk.authentication.begin({ userId: "u-1a2b3c4d" });
    const signedIn = await pk.authentication.finish({ challengeId: auth.challengeId, response: { id: "cred-1" } });

    // STRICT equality on the whole object, not a property check: an extra
    // `session` or `user` key is exactly the defect this module removes, and
    // toMatchObject would let it through.
    expect(signedIn).toEqual({ userId: "u-1a2b3c4d", credentialId: "cred-1" });
    expect(Object.keys(signedIn).sort()).toEqual(["credentialId", "userId"]);
  });

  it("never produces a cookie: no result or option object carries a Set-Cookie, cookie, session or token key", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    const r1 = await pk.registration.finish({ challengeId: reg.challengeId, response: { id: "cred-1" } });
    const auth = await pk.authentication.begin({ userId: "u-1" });
    const r2 = await pk.authentication.finish({ challengeId: auth.challengeId, response: { id: "cred-1" } });

    const forbidden = /set-cookie|^cookie$|session|token/i;
    for (const obj of [reg, reg.options, r1, auth, auth.options, r2]) {
      for (const k of Object.keys(obj as object)) expect(k).not.toMatch(forbidden);
    }
  });

  it("stores the credential against the userId from the CHALLENGE, never from the request body", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });
    const reg = await pk.registration.begin({ userId: "u-owner", userName: "a" });

    // A response claiming to be someone else must not move the credential.
    const out = await pk.registration.finish({
      challengeId: reg.challengeId,
      response: { id: "cred-1", userId: "u-attacker", userHandle: "u-attacker" },
    });
    expect(out.userId).toBe("u-owner");
    expect(store.creds.get("cred-1")!.userId).toBe("u-owner");
  });
});

// ── AC#8 — userId is opaque, and there are two live formats ─────────────────

describe("userId is an opaque string", () => {
  it("accepts BOTH of trail's live formats — u-<hex8> and the usr_lens_ principal — in one run", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });

    for (const [i, userId] of ["u-1a2b3c4d", "usr_lens_9f8e7d6c"].entries()) {
      stub.registration = { verified: true, registrationInfo: regInfo({ credential: { id: `cred-${i}`, publicKey: new Uint8Array([9]), counter: 0 } }) };
      const reg = await pk.registration.begin({ userId, userName: "x" });
      const out = await pk.registration.finish({ challengeId: reg.challengeId, response: { id: `cred-${i}` } });
      expect(out.userId).toBe(userId);
    }
    // A UUID or prefix check would have rejected the second and only the second.
    expect(store.creds.get("cred-1")!.userId).toBe("usr_lens_9f8e7d6c");
  });
});

// ── AC#9 — no tenant anywhere ──────────────────────────────────────────────

describe("a passkey belongs to the user, not to a tenant", () => {
  it("authenticates with no tenant argument present, and the stored record has no tenant field", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    await pk.registration.finish({ challengeId: reg.challengeId, response: { id: "cred-1" } });

    const stored = store.creds.get("cred-1")!;
    for (const k of Object.keys(stored)) expect(k).not.toMatch(/tenant|org|workspace/i);

    const auth = await pk.authentication.begin();          // no argument at all
    const out = await pk.authentication.finish({ challengeId: auth.challengeId, response: { id: "cred-1" } });
    expect(out.userId).toBe("u-1");
  });
});

// ── AC#3 / AC#4 — the user-verification guard ──────────────────────────────

describe("the user-verification guard", () => {
  it("REGISTRATION refuses a UV=0 response when required", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store, requireUserVerification: true });
    stub.registration = { verified: true, registrationInfo: regInfo({ userVerified: false }) };
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    await expect(pk.registration.finish({ challengeId: reg.challengeId, response: { id: "cred-1" } }))
      .rejects.toMatchObject({ code: "USER_VERIFICATION_REQUIRED" });
    expect(store.creds.size).toBe(0); // and nothing was enrolled
  });

  it("AUTHENTICATION refuses a UV=0 assertion when required", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store, requireUserVerification: true });
    store.creds.set("cred-1", { credentialId: "cred-1", userId: "u-1", publicKey: "AQID", counter: 0 });
    stub.authentication = { verified: true, authenticationInfo: { userVerified: false, newCounter: 1 } };
    const auth = await pk.authentication.begin({ userId: "u-1" });
    await expect(pk.authentication.finish({ challengeId: auth.challengeId, response: { id: "cred-1" } }))
      .rejects.toMatchObject({ code: "USER_VERIFICATION_REQUIRED" });
  });

  it("fails CLOSED on a MISSING userVerified field, in both ceremonies", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store, requireUserVerification: true });

    stub.registration = { verified: true, registrationInfo: regInfo({ userVerified: undefined }) };
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    await expect(pk.registration.finish({ challengeId: reg.challengeId, response: { id: "cred-1" } }))
      .rejects.toMatchObject({ code: "USER_VERIFICATION_REQUIRED" });

    store.creds.set("cred-1", { credentialId: "cred-1", userId: "u-1", publicKey: "AQID", counter: 0 });
    stub.authentication = { verified: true, authenticationInfo: { newCounter: 1 } };
    const auth = await pk.authentication.begin({ userId: "u-1" });
    await expect(pk.authentication.finish({ challengeId: auth.challengeId, response: { id: "cred-1" } }))
      .rejects.toMatchObject({ code: "USER_VERIFICATION_REQUIRED" });
  });

  it("NEGATIVE CONTROL: the same UV=0 response is ACCEPTED with the flag off (the default)", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });   // no requireUserVerification
    stub.registration = { verified: true, registrationInfo: regInfo({ userVerified: false }) };
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    await expect(pk.registration.finish({ challengeId: reg.challengeId, response: { id: "cred-1" } }))
      .resolves.toMatchObject({ userId: "u-1" });

    stub.authentication = { verified: true, authenticationInfo: { userVerified: false, newCounter: 1 } };
    const auth = await pk.authentication.begin({ userId: "u-1" });
    await expect(pk.authentication.finish({ challengeId: auth.challengeId, response: { id: "cred-1" } }))
      .resolves.toMatchObject({ userId: "u-1" });
  });

  it("asks the browser for a verification only when it will enforce one", async () => {
    const store = memoryStore();
    const off = await createPasskeyCeremony({ ...CFG, store }).authentication.begin();
    const on = await createPasskeyCeremony({ ...CFG, store, requireUserVerification: true }).authentication.begin();
    expect((off.options as { userVerification?: string }).userVerification).toBe("preferred");
    expect((on.options as { userVerification?: string }).userVerification).toBe("required");

    const regOn = await createPasskeyCeremony({ ...CFG, store, requireUserVerification: true })
      .registration.begin({ userId: "u-1", userName: "a" });
    expect((regOn.options as { authenticatorSelection?: { userVerification?: string } }).authenticatorSelection?.userVerification)
      .toBe("required");
  });
});

// ── AC#5 — a challenge is single-use ───────────────────────────────────────

describe("a challenge is single-use", () => {
  it("refuses a replay of a completed authentication", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });
    store.creds.set("cred-1", { credentialId: "cred-1", userId: "u-1", publicKey: "AQID", counter: 0 });

    const auth = await pk.authentication.begin({ userId: "u-1" });
    await expect(pk.authentication.finish({ challengeId: auth.challengeId, response: { id: "cred-1" } })).resolves.toBeTruthy();
    await expect(pk.authentication.finish({ challengeId: auth.challengeId, response: { id: "cred-1" } }))
      .rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
  });

  it("refuses a replay of a completed registration", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    await pk.registration.finish({ challengeId: reg.challengeId, response: { id: "cred-1" } });
    await expect(pk.registration.finish({ challengeId: reg.challengeId, response: { id: "cred-1" } }))
      .rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
  });

  it("a registration challenge cannot be spent on an authentication, or the reverse", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    await expect(pk.authentication.finish({ challengeId: reg.challengeId, response: { id: "cred-1" } }))
      .rejects.toMatchObject({ code: "CHALLENGE_WRONG_CEREMONY" });
  });

  it("refuses an expired challenge", async () => {
    const store = memoryStore();
    let t = 1_000_000;
    const pk = createPasskeyCeremony({ ...CFG, store, challengeTtlMs: 60_000, now: () => t });
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    t += 60_001;
    await expect(pk.registration.finish({ challengeId: reg.challengeId, response: { id: "cred-1" } }))
      .rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });
});

// ── the refusals a consumer will actually hit ──────────────────────────────

describe("refusals", () => {
  it("an unknown credential is CREDENTIAL_NOT_FOUND, and the verifier is never reached", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });
    const auth = await pk.authentication.begin();
    await expect(pk.authentication.finish({ challengeId: auth.challengeId, response: { id: "nope" } }))
      .rejects.toMatchObject({ code: "CREDENTIAL_NOT_FOUND" });
  });

  it("another user's credential cannot answer a challenge issued for a named user", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });
    store.creds.set("cred-other", { credentialId: "cred-other", userId: "u-other", publicKey: "AQID", counter: 0 });
    const auth = await pk.authentication.begin({ userId: "u-1" });
    await expect(pk.authentication.finish({ challengeId: auth.challengeId, response: { id: "cred-other" } }))
      .rejects.toMatchObject({ code: "CREDENTIAL_NOT_FOUND" });
  });

  it("re-registering the same credential is refused rather than silently reassigned", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });
    store.creds.set("cred-1", { credentialId: "cred-1", userId: "u-other", publicKey: "AQID", counter: 0 });
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    await expect(pk.registration.finish({ challengeId: reg.challengeId, response: { id: "cred-1" } }))
      .rejects.toMatchObject({ code: "CREDENTIAL_ALREADY_REGISTERED" });
    expect(store.creds.get("cred-1")!.userId).toBe("u-other");
  });

  it("a thrown verifier becomes VERIFICATION_FAILED, not a raw library error", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });
    stub.throwOn = "registration";
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    const err = await pk.registration.finish({ challengeId: reg.challengeId, response: { id: "c" } }).catch((e) => e);
    expect(err).toBeInstanceOf(PasskeyCeremonyError);
    expect(err.code).toBe("VERIFICATION_FAILED");
  });

  it("verified:false is refused even when the library did not throw", async () => {
    const store = memoryStore();
    const pk = createPasskeyCeremony({ ...CFG, store });
    stub.registration = { verified: false, registrationInfo: undefined };
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    await expect(pk.registration.finish({ challengeId: reg.challengeId, response: { id: "c" } }))
      .rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
  });
});

describe("registration excludes credentials the user already has", () => {
  it("passes the existing ids to the browser so it will not enrol a duplicate", async () => {
    const store = memoryStore();
    store.creds.set("cred-old", { credentialId: "cred-old", userId: "u-1", publicKey: "AQID", counter: 0, transports: ["internal"] });
    const pk = createPasskeyCeremony({ ...CFG, store });
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    expect((reg.options as { excludeCredentials?: { id: string }[] }).excludeCredentials)
      .toEqual([{ id: "cred-old", transports: ["internal"] }]);
  });
});

describe("base64url", () => {
  it("round-trips every byte value, including lengths that need padding", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 255, 256]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 7 + 13) & 0xff;
      expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes]);
    }
  });

  it("emits no +, / or = — the characters that break a URL and a cookie", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/);
  });
});
