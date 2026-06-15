import { describe, expect, it } from "vitest";
import { generateKey, hashKey, timingSafeEqual, verifyKey, makeKeyPreview, hasScope } from "../src/index";

describe("generateKey", () => {
  it("mints a prefixed 64-hex key by default (256-bit)", () => {
    const k = generateKey("trail");
    expect(k).toMatch(/^trail_[0-9a-f]{64}$/);
  });

  it("honours a custom byte length", () => {
    expect(generateKey("uk", 24)).toMatch(/^uk_[0-9a-f]{48}$/);
  });

  it("two keys never collide", () => {
    expect(generateKey("pa")).not.toBe(generateKey("pa"));
  });

  it("rejects an empty prefix or too-few bytes", () => {
    expect(() => generateKey("")).toThrow();
    expect(() => generateKey("x", 8)).toThrow();
  });
});

describe("hashKey", () => {
  it("is a stable sha256 hex", () => {
    expect(hashKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("timingSafeEqual / verifyKey", () => {
  it("timingSafeEqual: true for equal, false for distinct-length AND distinct-byte (no throw)", () => {
    expect(timingSafeEqual("secret", "secret")).toBe(true);
    expect(timingSafeEqual("secret", "secretlonger")).toBe(false); // distinct length
    expect(timingSafeEqual("secreta", "secretb")).toBe(false); // same length, distinct byte
  });

  it("verifyKey hashed mode (default): matches a stored sha256", () => {
    const raw = generateKey("trail");
    expect(verifyKey(raw, hashKey(raw))).toBe(true);
    expect(verifyKey(generateKey("trail"), hashKey(raw))).toBe(false);
  });

  it("verifyKey plaintext mode: matches a stored raw key (upmetrics-style)", () => {
    const raw = "uk_deadbeef";
    expect(verifyKey(raw, raw, { hashed: false })).toBe(true);
    expect(verifyKey("uk_other", raw, { hashed: false })).toBe(false);
  });
});

describe("makeKeyPreview", () => {
  it("returns the first 14 chars by default", () => {
    expect(makeKeyPreview("wh_0123456789abcdef")).toBe("wh_0123456789a");
    expect(makeKeyPreview("wh_0123456789abcdef")).toHaveLength(14);
  });
  it("honours a custom length (cardmem hash_prefix = 6)", () => {
    expect(makeKeyPreview("abcdef0123", 6)).toBe("abcdef");
  });
});

describe("hasScope", () => {
  it("exact match", () => {
    expect(hasScope(["content:read"], ["content:read"])).toBe(true);
    expect(hasScope(["content:read"], ["content:write"])).toBe(false);
  });
  it("global wildcard", () => {
    expect(hasScope(["*"], ["anything:goes"])).toBe(true);
  });
  it("area wildcard", () => {
    expect(hasScope(["content:*"], ["content:write"])).toBe(true);
    expect(hasScope(["content:*"], ["media:write"])).toBe(false);
  });
  it("requires ALL required scopes", () => {
    expect(hasScope(["content:read"], ["content:read", "media:read"])).toBe(false);
    expect(hasScope(["content:read", "media:read"], ["content:read", "media:read"])).toBe(true);
  });
  it("empty required = allowed", () => {
    expect(hasScope([], [])).toBe(true);
  });
});
