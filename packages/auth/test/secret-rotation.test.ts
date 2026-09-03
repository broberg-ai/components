import { describe, it, expect } from "vitest";
import { symmetricEncrypt, symmetricDecrypt } from "better-auth/crypto";
import { secretsFrom } from "../src/index.js";

/** F008.10 — the claim on the card, as tests. A 2FA secret and its recovery
 *  codes are encrypted with the app's key; if that ciphertext cannot survive a
 *  key rotation, a rotation is an account lockout with no way back. */

const TOTP_SECRET = "JBSWY3DPEHPK3PXP";
const BACKUP_CODES = JSON.stringify(["aaaa-bbbb", "cccc-dddd"]);
const OLD = "old-secret-with-enough-entropy-0123456789";
const NEW = "new-secret-with-enough-entropy-9876543210";

describe("AC#0 — a lone `secret` cannot survive a rotation (the RED proof)", () => {
  it("writes ciphertext with NO version envelope", async () => {
    const ct = await symmetricEncrypt({ key: OLD, data: TOTP_SECRET });
    expect(ct.startsWith("$ba$")).toBe(false);
  });

  it("the TOTP secret AND the recovery codes are both unreadable after rotation", async () => {
    // Both, deliberately: the recovery codes are the escape hatch, and they are
    // encrypted with the same key — so the hatch goes with the door.
    for (const data of [TOTP_SECRET, BACKUP_CODES]) {
      const ct = await symmetricEncrypt({ key: OLD, data });
      await expect(symmetricDecrypt({ key: NEW, data: ct })).rejects.toThrow();
    }
  });

  it("CONTROL: the OLD key still reads it — so it is the rotation that kills it", async () => {
    // Without this the test above passes against an encrypt that produces
    // garbage for everyone, which would be an instrument problem, not a finding.
    const ct = await symmetricEncrypt({ key: OLD, data: TOTP_SECRET });
    await expect(symmetricDecrypt({ key: OLD, data: ct })).resolves.toBe(TOTP_SECRET);
  });
});

describe("AC#1 — `secrets` makes a rotation survivable", () => {
  const ring = (keys: Record<number, string>, legacySecret?: string) => {
    const arr = secretsFrom(keys);
    return {
      keys: new Map(arr.map((s) => [s.version, s.value])),
      currentVersion: arr[0].version,
      ...(legacySecret ? { legacySecret } : {}),
    };
  };

  it("data written under v1 is still readable after v2 becomes current", async () => {
    const ct = await symmetricEncrypt({ key: ring({ 1: OLD }), data: TOTP_SECRET });
    expect(ct.startsWith("$ba$")).toBe(true);
    await expect(
      symmetricDecrypt({ key: ring({ 2: NEW, 1: OLD }), data: ct }),
    ).resolves.toBe(TOTP_SECRET);
  });

  it("and NEW data encrypts under the NEW version, not the old one", async () => {
    // The point of rotating. Without this, "readable after rotation" could be
    // satisfied by never actually rotating.
    const ct = await symmetricEncrypt({ key: ring({ 2: NEW, 1: OLD }), data: TOTP_SECRET });
    expect(ct.startsWith("$ba$2$")).toBe(true);
  });

  it("MIGRATION: `secret` as legacySecret reads string-era ciphertext", async () => {
    // This is why the deadline is "while you still have the old secret" rather
    // than "before your first 2FA user".
    const legacy = await symmetricEncrypt({ key: OLD, data: TOTP_SECRET });
    await expect(
      symmetricDecrypt({ key: ring({ 1: NEW }, OLD), data: legacy }),
    ).resolves.toBe(TOTP_SECRET);
  });

  it("...and WITHOUT legacySecret the same read fails — so the field is what does it", async () => {
    const legacy = await symmetricEncrypt({ key: OLD, data: TOTP_SECRET });
    await expect(
      symmetricDecrypt({ key: ring({ 1: NEW }), data: legacy }),
    ).rejects.toThrow(/legacy bare-hex/);
  });
});

describe("secretsFrom() closes a positional footgun nothing else checks", () => {
  it("sorts DESCENDING so the current key is [0] by construction", () => {
    expect(secretsFrom({ 1: OLD, 2: NEW })).toEqual([
      { version: 2, value: NEW },
      { version: 1, value: OLD },
    ]);
  });

  it("THE FOOTGUN: a hand-written ascending array makes the OLD key current", async () => {
    // better-auth reads secrets[0] positionally (secret-utils.mjs:48) and its
    // own validateSecretsArray checks integers, duplicates, length and entropy
    // — but NOT order. So this is valid, silent, and wrong.
    const handWritten = [
      { version: 1, value: OLD },
      { version: 2, value: NEW },
    ];
    const asConfig = {
      keys: new Map(handWritten.map((s) => [s.version, s.value])),
      currentVersion: handWritten[0].version,
    };
    const ct = await symmetricEncrypt({ key: asConfig, data: TOTP_SECRET });
    expect(ct.startsWith("$ba$1$")).toBe(true); // encrypted under the OLD key
    // and secretsFrom on the same keys does NOT do that
    const fixed = secretsFrom({ 1: OLD, 2: NEW });
    expect(fixed[0].version).toBe(2);
  });

  it("rejects an empty map, a bad version and an empty key", () => {
    expect(() => secretsFrom({})).toThrow(/at least one key/);
    expect(() => secretsFrom({ [-1]: NEW })).toThrow(/non-negative integer/);
    expect(() => secretsFrom({ 1: "" })).toThrow(/is empty/);
  });
});
