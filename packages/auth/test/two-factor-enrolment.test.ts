import { describe, it, expect } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createHmac } from "node:crypto";
import { symmetricDecrypt } from "better-auth/crypto";
import { createTypedAuth, secretsFrom } from "../src/index.js";
import { buildTwoFactorPlugin } from "../src/two-factor.js";

/** F008.10 AC#5/#6 — every assertion here reads the STORED ROW, never the
 *  response that wrote it. A toast saying "2FA enabled" is the handler
 *  reporting its own intent. */

/** RFC 6238, from scratch — what a phone actually computes from the QR code.
 *  Deliberately NOT better-auth's own createOTP: a code produced by the library
 *  under test only proves the library agrees with itself, and the claim being
 *  tested is that a THIRD-PARTY app interoperates. Checked against the RFC's
 *  published vector by the control test below. */
function appCode(base32Secret: string, atMs: number = Date.now()): string {
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32Secret.replace(/=+$/, "").toUpperCase()) {
    const i = ALPHA.indexOf(c);
    if (i < 0) throw new Error(`not base32: ${c}`);
    bits += i.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Math.floor(atMs / 1000 / 30);
  const ctr = Buffer.alloc(8);
  ctr.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  ctr.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", Buffer.from(bytes)).update(ctr).digest();
  const off = h[h.length - 1]! & 0x0f;
  const n = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

const PASSWORD = "korrekt-hest-batteri-haefteklamme";
const EMAIL = "cb@webhouse.dk";

type Store = Record<string, Array<Record<string, unknown>>>;

async function enrolled() {
  const store: Store = { user: [], session: [], account: [], verification: [], twoFactor: [] };
  // createTypedAuth, not createAuth: the plugin-augmented `api` methods
  // (enableTwoFactor, verifyTOTP, verifyBackupCode) are invisible to
  // createAuth's annotated return type — the F008.7 dark-ship/inference
  // tension. Runtime is identical; only the static type differs. Using it here
  // means this suite typechecks the way a consumer's code will.
  const auth = createTypedAuth(
    {
      database: memoryAdapter(store),
      emailPassword: true,
      baseURL: "http://localhost:3000",
      secret: "test-only-not-a-real-key-korrekt-hest-batteri-haefteklamme",
    },
    [buildTwoFactorPlugin({ issuer: "WebHouse" })],
  );
  const up = await auth.api.signUpEmail({
    body: { email: EMAIL, password: PASSWORD, name: "CB" },
    asResponse: true,
  });
  const cookie = up.headers.getSetCookie().join("; ");
  const res = await auth.api.enableTwoFactor({
    body: { password: PASSWORD },
    headers: { cookie },
    asResponse: true,
  });
  const body = (await res.json()) as { totpURI: string; backupCodes: string[] };
  return { auth, store, cookie, ...body };
}

const row = (store: Store) => store.twoFactor[0]!;
const user = (store: Store) => store.user[0]!;

describe("AC#5 — enrolment does not complete without a verified code", () => {
  it("after enableTwoFactor, 2FA is NOT yet on — read from the USER ROW", async () => {
    const { store } = await enrolled();
    expect(user(store).twoFactorEnabled).toBe(false);
  });

  it("...and the twoFactor row is marked unverified", async () => {
    const { store } = await enrolled();
    expect(row(store).verified).toBeFalsy();
  });

  it("a WRONG code leaves 2FA off in the stored row", async () => {
    const { auth, store, cookie } = await enrolled();
    await auth.api
      .verifyTOTP({ body: { code: "000000" }, headers: { cookie }, asResponse: true })
      .catch(() => null);
    expect(user(store).twoFactorEnabled).toBe(false);
    expect(row(store).verified).toBeFalsy();
  });

  it("a code computed THE WAY A REAL AUTHENTICATOR APP COMPUTES IT turns it on", async () => {
    // Two reasons this uses an independent RFC 6238 implementation rather than
    // better-auth's own createOTP:
    //
    // 1. It is the only way to assert what the card actually promises — that
    //    Microsoft Authenticator and Google Authenticator work. A code produced
    //    by the library under test proves the library agrees with itself.
    // 2. It caught me being wrong. Feeding createOTP the URI's base32 secret
    //    (it expects a RAW secret) produced a code verifyTOTP rejected, and I
    //    had a coherent explanation and two fitting measurements for a serious
    //    defect in better-auth. There is none. The implementation below,
    //    checked against the RFC's own published vector, is what disproved it.
    //
    // Without this, "a wrong code leaves 2FA off" would also pass against an
    // enrolment that can never be completed at all.
    const { auth, store, cookie, totpURI } = await enrolled();
    const code = appCode(new URL(totpURI).searchParams.get("secret")!);
    await auth.api.verifyTOTP({ body: { code }, headers: { cookie }, asResponse: true });
    expect(user(store).twoFactorEnabled).toBe(true);
    expect(row(store).verified).toBeTruthy();
  });

  it("CONTROL: the independent implementation matches RFC 6238's published test vector", () => {
    // A generator nobody has checked against a known answer cannot certify
    // anyone else's. Seed "12345678901234567890" at T=59s; the RFC's SHA1
    // vector is 94287082, and its 6-digit truncation is 287082.
    expect(appCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
  });
});

describe("AC#6 — recovery codes", () => {
  it("ten are returned at enrolment", async () => {
    const { backupCodes } = await enrolled();
    expect(Array.isArray(backupCodes)).toBe(true);
    expect(backupCodes).toHaveLength(10);
  });

  it("the STORED secret and codes are encrypted — read the row, not the API", async () => {
    const { store, totpURI, backupCodes } = await enrolled();
    const plainSecret = new URL(totpURI).searchParams.get("secret")!;
    // The base32 secret the app scanned must NOT be what sits in the column.
    expect(String(row(store).secret)).not.toContain(plainSecret);
    expect(String(row(store).backupCodes)).not.toContain(backupCodes[0]!);
    // and a control: the plaintext values ARE what we compared against
    expect(plainSecret).toMatch(/^[A-Z2-7]+$/);
    expect(backupCodes[0]).toBeTruthy();
  });

  it("a used code cannot be used twice — and fails for the RIGHT reason", async () => {
    // cardmem's rule, applied to my own suite: a green (or here, a non-200)
    // result is a question, not a result — ask WHICH reason arrived. `not 200`
    // would also pass if the second call failed on a stale session, a lockout,
    // or 2FA not being enabled, i.e. for a layer this test is not about.
    const { auth, cookie, backupCodes } = await enrolled();
    const code = backupCodes[0]!;
    const call = (c: string) =>
      auth.api
        .verifyBackupCode({ body: { code: c }, headers: { cookie }, asResponse: true })
        .then(async (r) => ({ status: r.status, body: (await r.json().catch(() => null)) as { code?: string } | null }))
        .catch((e: { status?: number; body?: { code?: string } }) => ({ status: e?.status ?? 0, body: e?.body ?? null }));

    expect((await call(code)).status).toBe(200);

    const reused = await call(code);
    expect(reused.status).toBe(401);
    expect(reused.body?.code).toBe("INVALID_BACKUP_CODE");

    // And a code that was NEVER valid must fail IDENTICALLY. That is both the
    // right security property — a consumed code must not be distinguishable
    // from a wrong one, or the error is an oracle — and the evidence that the
    // assertion above is about consumption rather than about something breaking.
    const neverValid = await call("zzzz-zzzz");
    expect(neverValid.status).toBe(reused.status);
    expect(neverValid.body?.code).toBe(reused.body?.code);
  });
});

describe("the wrapper actually FORWARDS `secrets` — not just accepts it", () => {
  // MUTATION M2 SURVIVED WITHOUT THIS TEST. Deleting the
  // `...(config.secrets ? { secrets: config.secrets } : {})` line from
  // createAuth/createTypedAuth left all 56 tests green, because every rotation
  // test called symmetricEncrypt directly. So the suite proved BETTER AUTH can
  // rotate and never proved OUR WRAPPER passes the field on — a consumer could
  // set `secrets` and have it silently dropped, which is the "a field the API
  // does not know" trap: the call succeeds and the option vanishes.
  //
  // The only assertion that can tell the difference is end-to-end: enrol, then
  // look at the ciphertext. With `secrets` forwarded it carries the envelope;
  // without it Better Auth falls back to `secret` and writes bare hex.
  const KEY_V1 = "rotation-key-one-korrekt-hest-batteri";

  async function enrolWithSecrets() {
    const store: Store = { user: [], session: [], account: [], verification: [], twoFactor: [] };
    const auth = createTypedAuth(
      {
        database: memoryAdapter(store),
        emailPassword: true,
        baseURL: "http://localhost:3000",
        secrets: secretsFrom({ 1: KEY_V1 }),
      },
      [buildTwoFactorPlugin({ issuer: "WebHouse" })],
    );
    const up = await auth.api.signUpEmail({
      body: { email: EMAIL, password: PASSWORD, name: "CB" },
      asResponse: true,
    });
    const cookie = up.headers.getSetCookie().join("; ");
    await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: { cookie }, asResponse: true });
    return store;
  }

  it("the stored TOTP secret carries the VERSION ENVELOPE", async () => {
    const store = await enrolWithSecrets();
    expect(String(row(store).secret)).toMatch(/^\$ba\$1\$/);
  });

  it("...and it decrypts with the versioned key, byte-exact", async () => {
    // Envelope-shaped is not the same as readable. Without this, a prefix check
    // would pass on a value encrypted under some other key entirely.
    const store = await enrolWithSecrets();
    const data = String(row(store).secret);
    // Asserted as a PAIR rather than a charset guess (my first version demanded
    // /^[A-Za-z0-9]+$/ and the real secret is base64url — the decrypt had
    // worked and the assertion was wrong): the right key reads it, the wrong
    // key does not. Only the second half proves the decrypt is doing work.
    await expect(
      symmetricDecrypt({ key: { keys: new Map([[1, KEY_V1]]), currentVersion: 1 }, data }),
    ).resolves.toHaveLength(32);
    await expect(
      symmetricDecrypt({ key: { keys: new Map([[1, "a-completely-different-key-value"]]), currentVersion: 1 }, data }),
    ).rejects.toThrow();
  });

  it("CONTROL: with only `secret`, the same row is NOT enveloped", async () => {
    // This is what the wrapper produces when `secrets` is dropped, so it is
    // what M2 turns the test above into. Asserting the difference is what makes
    // the envelope check evidence rather than a shape.
    const { store } = await enrolled();
    expect(String(row(store).secret)).not.toMatch(/^\$ba\$/);
  });
});

describe("the MIGRATION path works through the wrapper (M5)", () => {
  // MUTATION M5 ALSO SURVIVED: dropping the `secret` pass-through left 59/59
  // green. And `secret` is exactly the legacy fallback the README tells a
  // consumer to keep set so pre-envelope ciphertext stays readable. Third time
  // on this one card that a field was accepted by the type, forwarded by the
  // code, and asserted by nothing.
  const LEGACY = "the-original-string-era-key-korrekt-hest";
  const KEY_V1 = "the-new-versioned-key-batteri-haefteklamme";

  function authWith(store: Store, cfg: { secret?: string; secrets?: ReturnType<typeof secretsFrom> }) {
    return createTypedAuth(
      {
        database: memoryAdapter(store),
        emailPassword: true,
        baseURL: "http://localhost:3000",
        ...cfg,
      },
      [buildTwoFactorPlugin({ issuer: "WebHouse" })],
    );
  }

  async function enrolUnder(cfg: { secret?: string; secrets?: ReturnType<typeof secretsFrom> }) {
    const store: Store = { user: [], session: [], account: [], verification: [], twoFactor: [] };
    const auth = authWith(store, cfg);
    const up = await auth.api.signUpEmail({
      body: { email: EMAIL, password: PASSWORD, name: "CB" },
      asResponse: true,
    });
    const cookie = up.headers.getSetCookie().join("; ");
    await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: { cookie }, asResponse: true });
    return store;
  }

  it("a row written in the STRING era is still readable after adopting `secrets`", async () => {
    // The whole reason the deadline is "while you still have the old secret"
    // rather than "before your first 2FA user".
    const store = await enrolUnder({ secret: LEGACY });
    const stringEra = String(row(store).secret);
    expect(stringEra).not.toMatch(/^\$ba\$/);

    // Now the app adopts versioned keys and KEEPS the old secret as the fallback.
    await expect(
      symmetricDecrypt({
        key: { keys: new Map([[1, KEY_V1]]), currentVersion: 1, legacySecret: LEGACY },
        data: stringEra,
      }),
    ).resolves.toHaveLength(32);
  });

  it("...and WITHOUT the legacy secret the same row is lost — so `secret` is what saves it", async () => {
    const store = await enrolUnder({ secret: LEGACY });
    await expect(
      symmetricDecrypt({
        key: { keys: new Map([[1, KEY_V1]]), currentVersion: 1 },
        data: String(row(store).secret),
      }),
    ).rejects.toThrow(/legacy bare-hex/);
  });

  it("the wrapper forwards `secret`: two DIFFERENT secrets produce mutually unreadable rows", async () => {
    // The assertion M5 needed. If `secret` were dropped, both instances would
    // fall back to the same env/default key and each row would open with the
    // other's config — so the rows being mutually unreadable is the evidence
    // that our config reached Better Auth at all.
    const a = await enrolUnder({ secret: LEGACY });
    const b = await enrolUnder({ secret: KEY_V1 });
    await expect(symmetricDecrypt({ key: LEGACY, data: String(row(a).secret) })).resolves.toBeTruthy();
    await expect(symmetricDecrypt({ key: LEGACY, data: String(row(b).secret) })).rejects.toThrow();
  });
});
