// F102.1 — @broberg/seal: envelope AES-256-GCM, required aad, key rotation. Real Web Crypto, no mocks.
import { describe, expect, it } from "vitest";
import { createSealer, generateKey, keysFromEnv, SealError } from "../src/index";

const K1 = generateKey();
const K2 = generateKey();
const AAD = "tenant-42:openai-key";
const code = async (p: Promise<unknown>) => p.then(() => "no error", (e: unknown) => (e instanceof SealError ? e.code : `other: ${String(e)}`));

describe("F102.1 — seal / open", () => {
  it("round-trips EXACTLY (unicode, empty string, a long key); the same input seals to a different string every time", async () => {
    const s = createSealer({ keys: { 1: K1 }, current: 1 });
    for (const plain of ["sk-proj-abc123", "", "æøå ✓ 🔑 «nøgle»", "x".repeat(10_000)]) {
      const sealed = await s.seal(plain, { aad: AAD });
      expect(sealed.split(".")[0]).toBe("seal1");
      expect(sealed.split(".")[1]).toBe("1");
      expect(sealed.split(".").length).toBe(6);
      expect(await s.open(sealed, { aad: AAD })).toBe(plain);
    }
    expect(await s.seal("same", { aad: AAD })).not.toBe(await s.seal("same", { aad: AAD }));
  });

  it("NEGATIVE: the wrong aad (another tenant, another field) cannot open it", async () => {
    const s = createSealer({ keys: { 1: K1 }, current: 1 });
    const sealed = await s.seal("sk-secret", { aad: AAD });
    expect(await code(s.open(sealed, { aad: "tenant-43:openai-key" }))).toBe("invalid");
    expect(await code(s.open(sealed, { aad: "tenant-42:anthropic-key" }))).toBe("invalid");
  });

  it("NEGATIVE: one changed character in ANY part is refused; a different key ring cannot open it", async () => {
    const s = createSealer({ keys: { 1: K1 }, current: 1 });
    const sealed = await s.seal("sk-secret", { aad: AAD });
    const parts = sealed.split(".");
    for (const i of [2, 3, 4, 5]) {
      const p = [...parts];
      p[i] = p[i]!.slice(0, 3) + (p[i]![3] === "A" ? "B" : "A") + p[i]!.slice(4);
      expect(await code(s.open(p.join("."), { aad: AAD }))).toBe("invalid");
    }
    expect(await code(createSealer({ keys: { 1: K2 }, current: 1 }).open(sealed, { aad: AAD }))).toBe("invalid");
  });

  it("NEGATIVE: unknown version, malformed value, bad key and a missing aad are named errors — and no message carries a key or the plaintext", async () => {
    const s = createSealer({ keys: { 1: K1 }, current: 1 });
    const sealed = await s.seal("sk-very-secret", { aad: AAD });
    expect(await code(s.open(sealed.replace(/^seal1\.1\./, "seal1.7."), { aad: AAD }))).toBe("unknown_version");
    expect(await code(s.open("not-a-seal", { aad: AAD }))).toBe("bad_format");
    expect(await code(s.open("seal1.1.a.b.c", { aad: AAD }))).toBe("bad_format");
    expect(() => createSealer({ keys: { 1: btoa("short") }, current: 1 })).toThrow(SealError);
    expect(() => createSealer({ keys: { 1: K1 }, current: 2 })).toThrow(/current version 2 is not in the key ring/);
    await expect(s.seal("x", { aad: "" })).rejects.toThrow(/needs \{ aad \}/);
    const messages: string[] = [];
    for (const run of [() => s.open(sealed, { aad: "wrong" }), () => s.open(sealed.replace(/^seal1\.1\./, "seal1.9."), { aad: AAD })]) messages.push(await run().then(() => "", (e: Error) => e.message));
    try { createSealer({ keys: { 1: btoa("short") }, current: 1 }); } catch (e) { messages.push((e as Error).message); }
    for (const m of messages) { expect(m).not.toContain("sk-very-secret"); expect(m).not.toContain(K1); }
  });
});

describe("F102.1 — envelope", () => {
  it("every value gets its OWN random data key (unwrapped with the key ring, two seals never share one, and it is not all zeros)", async () => {
    const s = createSealer({ keys: { 1: K1 }, current: 1 });
    const kek = await crypto.subtle.importKey("raw", Uint8Array.from(atob(K1), (c) => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"]);
    const dekOf = async (sealed: string) => {
      const [, , wrapIv, wrapped] = sealed.split(".");
      const b = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b(wrapIv!), additionalData: new TextEncoder().encode("seal1|dek|1") }, kek, b(wrapped!)));
    };
    const [a, b2] = [await dekOf(await s.seal("x", { aad: AAD })), await dekOf(await s.seal("x", { aad: AAD }))];
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b2))).toBe(false);
    expect(a.some((x) => x !== 0)).toBe(true);
  });
});

describe("F102.1 — rotation", () => {
  it("needsRewrap: true for a value under an older version, false for one under current", async () => {
    const old = await createSealer({ keys: { 1: K1 }, current: 1 }).seal("sk-old", { aad: AAD });
    const both = createSealer({ keys: { 1: K1, 2: K2 }, current: 2 });
    expect([both.needsRewrap(old), both.needsRewrap(await both.seal("sk-new", { aad: AAD }))]).toStrictEqual([true, false]);
  });

  it("add key 2 as current: old values still open; needsRewrap tells them apart; rewrap moves them to 2 and they open after key 1 is REMOVED — same plaintext", async () => {
    const v1 = createSealer({ keys: { 1: K1 }, current: 1 });
    const old = await v1.seal("sk-old", { aad: AAD });
    const both = createSealer({ keys: { 1: K1, 2: K2 }, current: 2 });
    expect(await both.open(old, { aad: AAD })).toBe("sk-old");
    const fresh = await both.seal("sk-new", { aad: AAD });
    expect([both.needsRewrap(old), both.needsRewrap(fresh)]).toStrictEqual([true, false]);
    const moved = await both.rewrap(old);
    expect(moved.split(".")[1]).toBe("2");
    expect(moved.split(".").slice(4)).toStrictEqual(old.split(".").slice(4)); // the payload is not touched
    expect(await both.rewrap(fresh)).toBe(fresh);
    const only2 = createSealer({ keys: { 2: K2 }, current: 2 });
    expect(await only2.open(moved, { aad: AAD })).toBe("sk-old");
    expect(await code(only2.open(old, { aad: AAD }))).toBe("unknown_version");
    expect(await code(only2.open(moved, { aad: "tenant-43:openai-key" }))).toBe("invalid"); // the aad binding survives a rewrap
  });

  it("generateKey gives 32 random bytes; keysFromEnv parses a ring and refuses a malformed one", () => {
    const k = generateKey();
    expect(Uint8Array.from(atob(k), (c) => c.charCodeAt(0)).length).toBe(32);
    expect(generateKey()).not.toBe(k);
    expect(keysFromEnv(`1:${K1}, 2:${K2}`)).toStrictEqual({ 1: K1, 2: K2 });
    expect(() => keysFromEnv("1-abc")).toThrow(SealError);
    expect(() => keysFromEnv("")).toThrow(SealError);
  });
});
