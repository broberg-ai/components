import { describe, it, expect } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createHmac } from "node:crypto";
import { createTypedAuth } from "../src/index.js";
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

  it("a used code cannot be used twice", async () => {
    const { auth, cookie, backupCodes } = await enrolled();
    const code = backupCodes[0]!;
    const first = await auth.api
      .verifyBackupCode({ body: { code }, headers: { cookie }, asResponse: true })
      .catch(() => null);
    expect(first?.status).toBe(200);
    const second = await auth.api
      .verifyBackupCode({ body: { code }, headers: { cookie }, asResponse: true })
      .catch((e: { status?: number }) => ({ status: e?.status ?? 400 }));
    expect(second?.status).not.toBe(200);
  });
});
