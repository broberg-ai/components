import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex } from "../src/sha256";

describe("sha256Hex — FIPS 180-4 vectors and node:crypto agreement", () => {
  it("FIPS vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });
  it("agrees with node:crypto on Danish UTF-8 and on every length 0–200 (block-boundary padding)", () => {
    for (let n = 0; n <= 200; n++) {
      const s = "æøå€😀".repeat(n).slice(0, n);
      expect([n, sha256Hex(s)]).toEqual([n, createHash("sha256").update(s, "utf8").digest("hex")]);
    }
  });
});
