// F102.2 — sealBytes/openBytes and a per-scope key. Real Web Crypto, no mocks.
// Asked for by helpdesk (#5139): attachments up to 10 MB, and «hermetisk lukket mellem kunder».
import { describe, expect, it } from "vitest";
import { createSealer, generateKey, SealError } from "../src/index";

const K1 = generateKey();
const AAD = "tenant-42:attachment-7";
const code = async (p: Promise<unknown>) => p.then(() => "no error", (e: unknown) => (e instanceof SealError ? e.code : `other: ${String(e)}`));

// Sealed by the 0.1.0 code BEFORE this change (test-only key, protects nothing).
const FIXTURE_KEY = "+0VvXalWENVTeyulDrmFn21riTUTTrjzX5hl4cb6AMQ=";
const FIXTURE_SEALED =
  "seal1.1.cquPdiSI0FPjVA3e.z6HmaKcTuCh3FmeKaRe47S80ZdhBeZev9kCG2cLaYmGvImhGUY6pQhawDy4JgRPB.Vm-J5C0vIv2rEMmO.-l9FgzlBwR0O59aveO7NxtPbtw0uXS-wm2fe1_m8JOVPAe1N8P7SYifg";

describe("F102.2 — sealBytes / openBytes", () => {
  it("round-trips bytes EXACTLY (zeros, every byte value, 1 MB); output is bytes and only a fixed header larger", async () => {
    const s = createSealer({ keys: { 1: K1 }, current: 1 });
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const big = new Uint8Array(1024 * 1024).map((_, i) => (i * 31) & 0xff);
    for (const data of [new Uint8Array(0), new Uint8Array([0, 0, 0]), all, big]) {
      const sealed = await s.sealBytes(data, { aad: AAD });
      expect(sealed).toBeInstanceOf(Uint8Array);
      const opened = await s.openBytes(sealed, { aad: AAD });
      expect(opened.length).toBe(data.length);
      expect(Buffer.compare(Buffer.from(opened), Buffer.from(data))).toBe(0);
    }
    const a = await s.sealBytes(new Uint8Array(10), { aad: AAD });
    const b = await s.sealBytes(new Uint8Array(1000), { aad: AAD });
    expect(a.length - 10).toBe(b.length - 1000); // the overhead does not grow with the file (no base64)
    expect(a.length - 10).toBeLessThan(128);
  });

  it("NEGATIVE: the wrong aad and one flipped byte (header or payload) are refused as invalid", async () => {
    const s = createSealer({ keys: { 1: K1 }, current: 1 });
    const sealed = await s.sealBytes(new Uint8Array([1, 2, 3, 4]), { aad: AAD });
    expect(await code(s.openBytes(sealed, { aad: "tenant-43:attachment-7" }))).toBe("invalid");
    for (const i of [10, 30, sealed.length - 1]) {
      const t = new Uint8Array(sealed);
      t[i] = t[i]! ^ 0xff;
      expect(await code(s.openBytes(t, { aad: AAD })), `byte ${i}`).toBe("invalid");
    }
    expect(await code(s.openBytes(new Uint8Array([1, 2, 3]), { aad: AAD }))).toBe("bad_format");
    await expect(s.sealBytes(new Uint8Array(1), { aad: "" })).rejects.toThrow(TypeError);
  });
});

describe("F102.2 — scope: each customer its own key", () => {
  it("a value sealed for tenant-a cannot be opened by tenant-b or by an unscoped sealer — same key ring, same aad (string AND bytes)", async () => {
    const a = createSealer({ keys: { 1: K1 }, current: 1, scope: "tenant-a" });
    const b = createSealer({ keys: { 1: K1 }, current: 1, scope: "tenant-b" });
    const none = createSealer({ keys: { 1: K1 }, current: 1 });
    const s = await a.seal("secret", { aad: AAD });
    expect(await a.open(s, { aad: AAD })).toBe("secret");
    expect(await code(b.open(s, { aad: AAD }))).toBe("invalid");
    expect(await code(none.open(s, { aad: AAD }))).toBe("invalid");
    const bytes = await a.sealBytes(new Uint8Array([9, 8, 7]), { aad: AAD });
    expect(Array.from(await a.openBytes(bytes, { aad: AAD }))).toStrictEqual([9, 8, 7]);
    expect(await code(b.openBytes(bytes, { aad: AAD }))).toBe("invalid");
    expect(await code(none.openBytes(bytes, { aad: AAD }))).toBe("invalid");
    // and the other direction: an unscoped value is not opened by a scoped sealer
    expect(await code(a.open(await none.seal("x", { aad: AAD }), { aad: AAD }))).toBe("invalid");
  });

  it("the KEY itself differs per scope: the wrapped data key opens with HKDF(key, scope), never with the raw key — same aad", async () => {
    // The wrap aad also carries the scope, so the refusal above would hold even with ONE shared key.
    // This asks the key directly: unwrap with the raw key-ring key vs. the HKDF-derived one.
    const raw = Uint8Array.from(atob(K1), (c) => c.charCodeAt(0));
    const te = new TextEncoder();
    const ikm = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
    const derive = (scope: string) =>
      crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: te.encode("seal1-scope"), info: te.encode(scope) }, ikm, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const rawKek = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const sealed = await createSealer({ keys: { 1: K1 }, current: 1, scope: "tenant-a" }).seal("x", { aad: AAD });
    const [, , wrapIv, wrapped] = sealed.split(".");
    const b = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const unwrap = (key: CryptoKey) =>
      crypto.subtle.decrypt({ name: "AES-GCM", iv: b(wrapIv!), additionalData: te.encode("seal1|dek|1|scope|tenant-a") }, key, b(wrapped!)).then((d) => new Uint8Array(d).length, () => "refused");
    expect(await unwrap(await derive("tenant-a"))).toBe(32);
    expect(await unwrap(await derive("tenant-b"))).toBe("refused");
    expect(await unwrap(rawKek)).toBe("refused");
  });

  it("the same scope always derives the same key (a fresh sealer for tenant-a opens yesterday's value)", async () => {
    const s = await createSealer({ keys: { 1: K1 }, current: 1, scope: "tenant-a" }).seal("v", { aad: AAD });
    expect(await createSealer({ keys: { 1: K1 }, current: 1, scope: "tenant-a" }).open(s, { aad: AAD })).toBe("v");
  });

  it("rewrap under a scope keeps the scope (opens after the old key is removed, only in its own scope)", async () => {
    const K2 = generateKey();
    const old = await createSealer({ keys: { 1: K1 }, current: 1, scope: "tenant-a" }).seal("v", { aad: AAD });
    const moved = await createSealer({ keys: { 1: K1, 2: K2 }, current: 2, scope: "tenant-a" }).rewrap(old);
    expect(await createSealer({ keys: { 2: K2 }, current: 2, scope: "tenant-a" }).open(moved, { aad: AAD })).toBe("v");
    expect(await code(createSealer({ keys: { 2: K2 }, current: 2, scope: "tenant-b" }).open(moved, { aad: AAD }))).toBe("invalid");
  });

  it("an empty scope is refused (it would silently mean 'shared')", () => {
    expect(() => createSealer({ keys: { 1: K1 }, current: 1, scope: "" })).toThrow(TypeError);
  });
});

describe("F102.2 — NEGATIVE CONTROL: nothing changed for 0.1.0 values", () => {
  it("an unscoped sealer opens a value sealed by the 0.1.0 code before this change", async () => {
    const s = createSealer({ keys: { 1: FIXTURE_KEY }, current: 1 });
    expect(await s.open(FIXTURE_SEALED, { aad: "tenant-42:fixture" })).toBe("sealed by 0.1.0 «æøå»");
  });
});
