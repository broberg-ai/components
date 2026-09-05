import { describe, it, expect } from "vitest";
import {
  createPasskeyCeremony,
  toBase64Url,
  type StoredCredential,
  type ChallengeRecord,
} from "../src/passkey-ceremony.js";

/**
 * F008.13 — the same ceremony, driven by a REAL ES256 assertion through the
 * REAL `@simplewebauthn/server` verifier. No mock in this file.
 *
 * WHY IT EXISTS. Every other test in this package stubs the verifier, so they
 * measure our control flow and nothing else. A stub agrees with you by
 * construction: a bug in the base64url we use to persist the public key — the
 * one value that has to survive a round trip through the consumer's database —
 * would pass all 22 of them and fail on the first real login. This file signs
 * with a key WebCrypto generated, stores the public key through our own
 * encoder, reads it back, and lets the library decide.
 *
 * It also gives the UV guard a genuine negative control: the SAME signature,
 * with only the UV bit of the authenticator-data flags cleared, must be
 * refused when verification is required and accepted when it is not.
 */

// ── building a real WebAuthn assertion by hand ───────────────────────────────

const enc = new TextEncoder();
const sha256 = async (b: Uint8Array<ArrayBuffer>) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", b)) as Uint8Array<ArrayBuffer>;
const cat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** A COSE_Key for an EC2 P-256 public key — the exact bytes an authenticator
 *  hands over at registration, hand-encoded because that is what we must be
 *  able to store and reload. */
function coseEc2(x: Uint8Array, y: Uint8Array): Uint8Array<ArrayBuffer> {
  return cat(
    new Uint8Array([0xa5]),             // map(5)
    new Uint8Array([0x01, 0x02]),       // 1 (kty)  : 2  (EC2)
    new Uint8Array([0x03, 0x26]),       // 3 (alg)  : -7 (ES256)
    new Uint8Array([0x20, 0x01]),       // -1 (crv) : 1  (P-256)
    new Uint8Array([0x21, 0x58, 0x20]), x,  // -2 (x) : bstr(32)
    new Uint8Array([0x22, 0x58, 0x20]), y,  // -3 (y) : bstr(32)
  );
}

/** WebCrypto signs ECDSA as raw r‖s; WebAuthn carries DER. Converting is the
 *  kind of detail a mock never makes you get right. */
function rawToDer(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const v = b.slice(i);
    const needsPad = (v[0]! & 0x80) !== 0;
    const body = needsPad ? cat(new Uint8Array([0]), v) : v;
    return cat(new Uint8Array([0x02, body.length]), body);
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return cat(new Uint8Array([0x30, r.length + s.length]), r, s);
}


/** CBOR bstr header — the length encoding changes at 24 and at 256, and getting
 *  it wrong produces bytes a decoder rejects rather than misreads. */
function bstr(b: Uint8Array): Uint8Array<ArrayBuffer> {
  if (b.length < 24) return cat(new Uint8Array([0x40 | b.length]), b);
  if (b.length < 256) return cat(new Uint8Array([0x58, b.length]), b);
  return cat(new Uint8Array([0x59, b.length >> 8, b.length & 0xff]), b);
}
const tstr = (s: string) => {
  const b = enc.encode(s);
  return cat(new Uint8Array([0x60 | b.length]), b);
};

const RP_ID = "app.trailmem.com";
const ORIGIN = "https://app.trailmem.com";

/** UP is always set (the user touched the thing). UV is the bit under test. */
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

async function makeAuthenticator() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)); // 0x04 ‖ x ‖ y
  const cose = coseEc2(rawPub.slice(1, 33), rawPub.slice(33, 65));
  const credIdBytes = cat(enc.encode("real-credential-id"));
  const credentialId = toBase64Url(credIdBytes);

  return {
    /** The public key exactly as our own encoder would persist it. */
    storedPublicKey: toBase64Url(cose),
    credentialId,
    /** A REGISTRATION response — `fmt: "none"`, which is what a platform
     *  authenticator sends. This is the half the mutation harness proved was
     *  untested: nothing else in the package puts a real COSE key through
     *  `registration.finish` and then signs with the matching private key. */
    async attest(challenge: string, { userVerified }: { userVerified: boolean }) {
      const rpIdHash = await sha256(cat(enc.encode(RP_ID)));
      const AT = 0x40;   // "attested credential data included"
      const flags = new Uint8Array([FLAG_UP | AT | (userVerified ? FLAG_UV : 0)]);
      const counter = new Uint8Array([0, 0, 0, 0]);
      const aaguid = new Uint8Array(16);
      const credIdLen = new Uint8Array([credIdBytes.length >> 8, credIdBytes.length & 0xff]);
      const authData = cat(rpIdHash, flags, counter, aaguid, credIdLen, credIdBytes, cose);

      const attestationObject = cat(
        new Uint8Array([0xa3]),
        tstr("fmt"), tstr("none"),
        tstr("attStmt"), new Uint8Array([0xa0]),
        tstr("authData"), bstr(authData),
      );
      const clientDataJSON = cat(enc.encode(JSON.stringify({
        type: "webauthn.create", challenge, origin: ORIGIN, crossOrigin: false,
      })));

      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          attestationObject: toBase64Url(attestationObject),
          clientDataJSON: toBase64Url(clientDataJSON),
          transports: ["internal"],
        },
      };
    },
    async assert(challenge: string, { userVerified }: { userVerified: boolean }) {
      const rpIdHash = await sha256(cat(enc.encode(RP_ID)));
      const flags = new Uint8Array([FLAG_UP | (userVerified ? FLAG_UV : 0)]);
      const counter = new Uint8Array([0, 0, 0, 1]);
      const authData = cat(rpIdHash, flags, counter);

      const clientDataJSON = cat(enc.encode(JSON.stringify({
        type: "webauthn.get",
        challenge,
        origin: ORIGIN,
        crossOrigin: false,
      })));

      const signed = cat(authData, await sha256(clientDataJSON));
      const rawSig = new Uint8Array(await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signed,
      ));

      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          authenticatorData: toBase64Url(authData),
          clientDataJSON: toBase64Url(clientDataJSON),
          signature: toBase64Url(rawToDer(rawSig)),
        },
      };
    },
  };
}

function storeWith(cred?: StoredCredential) {
  const challenges = new Map<string, ChallengeRecord>();
  const creds = new Map<string, StoredCredential>(cred ? [[cred.credentialId, cred]] : []);
  return {
    creds,
    putChallenge(r: ChallengeRecord) { challenges.set(r.id, r); },
    takeChallenge(id: string) { const r = challenges.get(id) ?? null; challenges.delete(id); return r; },
    getCredential(id: string) { return creds.get(id) ?? null; },
    listCredentialsByUser(userId: string) { return [...creds.values()].filter((c) => c.userId === userId); },
    saveCredential(c: StoredCredential) { creds.set(c.credentialId, c); },
    updateCredentialCounter(id: string, counter: number) {
      const c = creds.get(id); if (c) creds.set(id, { ...c, counter });
    },
  };
}

describe("a real ES256 assertion, through the real verifier", () => {
  it("signs in — proving the public key survives OUR base64url round trip into a consumer's database", async () => {
    const auth = await makeAuthenticator();
    const store = storeWith({
      credentialId: auth.credentialId,
      userId: "usr_lens_9f8e7d6c",   // the format a UUID check would have rejected
      publicKey: auth.storedPublicKey,
      counter: 0,
    });
    const pk = createPasskeyCeremony({ rpID: RP_ID, rpName: "Trail", origin: ORIGIN, store });

    const begun = await pk.authentication.begin({ userId: "usr_lens_9f8e7d6c" });
    const response = await auth.assert(begun.options.challenge, { userVerified: true });
    const out = await pk.authentication.finish({ challengeId: begun.challengeId, response });

    expect(out).toEqual({ userId: "usr_lens_9f8e7d6c", credentialId: auth.credentialId });
    expect(store.creds.get(auth.credentialId)!.counter).toBe(1);   // the counter really moved
  });

  it("REFUSES the same signature with the UV bit cleared, when verification is required", async () => {
    const auth = await makeAuthenticator();
    const store = storeWith({ credentialId: auth.credentialId, userId: "u-1", publicKey: auth.storedPublicKey, counter: 0 });
    const pk = createPasskeyCeremony({
      rpID: RP_ID, rpName: "Trail", origin: ORIGIN, store, requireUserVerification: true,
    });

    const begun = await pk.authentication.begin({ userId: "u-1" });
    const response = await auth.assert(begun.options.challenge, { userVerified: false });
    await expect(pk.authentication.finish({ challengeId: begun.challengeId, response }))
      .rejects.toMatchObject({ code: "USER_VERIFICATION_REQUIRED" });
  });

  it("NEGATIVE CONTROL: that same UV-clear signature is cryptographically VALID and is accepted with the guard off", async () => {
    const auth = await makeAuthenticator();
    const store = storeWith({ credentialId: auth.credentialId, userId: "u-1", publicKey: auth.storedPublicKey, counter: 0 });
    const pk = createPasskeyCeremony({ rpID: RP_ID, rpName: "Trail", origin: ORIGIN, store });

    const begun = await pk.authentication.begin({ userId: "u-1" });
    const response = await auth.assert(begun.options.challenge, { userVerified: false });
    // This is what makes the test above mean something: the refusal is the
    // GUARD, not a broken fixture. Same bytes, same key, opposite outcome.
    await expect(pk.authentication.finish({ challengeId: begun.challengeId, response }))
      .resolves.toEqual({ userId: "u-1", credentialId: auth.credentialId });
  });

  it("refuses a signature made over a DIFFERENT challenge — the replay a captured response would be", async () => {
    const auth = await makeAuthenticator();
    const store = storeWith({ credentialId: auth.credentialId, userId: "u-1", publicKey: auth.storedPublicKey, counter: 0 });
    const pk = createPasskeyCeremony({ rpID: RP_ID, rpName: "Trail", origin: ORIGIN, store });

    const first = await pk.authentication.begin({ userId: "u-1" });
    const stale = await auth.assert(first.options.challenge, { userVerified: true });
    const second = await pk.authentication.begin({ userId: "u-1" });

    await expect(pk.authentication.finish({ challengeId: second.challengeId, response: stale }))
      .rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
  });

  it("refuses a tampered public key — the exact failure a base64url bug would produce", async () => {
    const auth = await makeAuthenticator();
    const broken = auth.storedPublicKey.slice(0, -2) + (auth.storedPublicKey.endsWith("A") ? "BB" : "AA");
    const store = storeWith({ credentialId: auth.credentialId, userId: "u-1", publicKey: broken, counter: 0 });
    const pk = createPasskeyCeremony({ rpID: RP_ID, rpName: "Trail", origin: ORIGIN, store });

    const begun = await pk.authentication.begin({ userId: "u-1" });
    const response = await auth.assert(begun.options.challenge, { userVerified: true });
    await expect(pk.authentication.finish({ challengeId: begun.challengeId, response }))
      .rejects.toMatchObject({ code: "VERIFICATION_FAILED" });
  });

  it("REGISTERS with a real attestation and then SIGNS IN with the key we stored — the whole loop, no mock", async () => {
    // The mutation harness found this gap: truncating the stored public key by
    // ONE BYTE survived every other test in the package, because nothing put a
    // real COSE key through registration.finish and then used it. Register on
    // the phone, log in on the phone — that is the loop trail actually needs.
    const auth = await makeAuthenticator();
    const store = storeWith();                    // empty: registration must fill it
    const pk = createPasskeyCeremony({ rpID: RP_ID, rpName: "Trail", origin: ORIGIN, store });

    const reg = await pk.registration.begin({ userId: "u-1a2b3c4d", userName: "cb@webhouse.dk" });
    const created = await auth.attest(reg.options.challenge, { userVerified: true });
    const registered = await pk.registration.finish({ challengeId: reg.challengeId, response: created });
    expect(registered.userId).toBe("u-1a2b3c4d");

    // The public key now in the store came from OUR encoder, out of a real
    // attestation — not from a fixture we wrote to match.
    const stored = store.creds.get(registered.credentialId)!;
    expect(stored.publicKey).toBe(auth.storedPublicKey);

    const begun = await pk.authentication.begin({ userId: "u-1a2b3c4d" });
    const response = await auth.assert(begun.options.challenge, { userVerified: true });
    await expect(pk.authentication.finish({ challengeId: begun.challengeId, response }))
      .resolves.toEqual({ userId: "u-1a2b3c4d", credentialId: registered.credentialId });
  });

  it("REGISTRATION refuses a real UV-clear attestation when verification is required", async () => {
    const auth = await makeAuthenticator();
    const store = storeWith();
    const pk = createPasskeyCeremony({
      rpID: RP_ID, rpName: "Trail", origin: ORIGIN, store, requireUserVerification: true,
    });
    const reg = await pk.registration.begin({ userId: "u-1", userName: "a" });
    const created = await auth.attest(reg.options.challenge, { userVerified: false });
    await expect(pk.registration.finish({ challengeId: reg.challengeId, response: created }))
      .rejects.toMatchObject({ code: "USER_VERIFICATION_REQUIRED" });
    expect(store.creds.size).toBe(0);   // and nothing was enrolled
  });
});
