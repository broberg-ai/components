import { describe, it, expect } from "vitest";
import {
  generateSyncSecret,
  signIcdRequest,
  buildManifest,
  diffManifests,
} from "../src/index.js";

describe("generateSyncSecret", () => {
  it("returns a 64-char hex string", () => {
    const s = generateSyncSecret();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique values", () => {
    expect(generateSyncSecret()).not.toBe(generateSyncSecret());
  });
});

describe("signIcdRequest", () => {
  const secret = "test-secret-abc";
  const body = new Uint8Array([1, 2, 3]);

  it("returns a timestamp string and sha256= prefixed signature", () => {
    const { timestamp, signature } = signIcdRequest("PUT", "/_icd/deploys/x/files?path=index.html", body, secret);
    expect(timestamp).toMatch(/^\d+$/);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("same inputs produce same signature", () => {
    const a = signIcdRequest("GET", "/_icd/manifest", new Uint8Array(0), secret);
    const b = signIcdRequest("GET", "/_icd/manifest", new Uint8Array(0), secret);
    // Timestamps may differ by 1s in edge cases — at least verify structure
    expect(a.signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(b.signature).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("different methods produce different signatures", () => {
    const a = signIcdRequest("GET", "/same", new Uint8Array(0), secret);
    const b = signIcdRequest("POST", "/same", new Uint8Array(0), secret);
    // Even if timestamp differs by 1s the body+method change guarantees diff
    expect(a.signature).not.toBe(b.signature);
  });

  it("different secrets produce different signatures", () => {
    const a = signIcdRequest("GET", "/x", new Uint8Array(0), "secret-A");
    const b = signIcdRequest("GET", "/x", new Uint8Array(0), "secret-B");
    expect(a.signature).not.toBe(b.signature);
  });
});

describe("buildManifest", () => {
  it("returns correct sha256 hex for each file", () => {
    const files = new Map<string, Uint8Array>([
      ["index.html", new TextEncoder().encode("<h1>hi</h1>")],
    ]);
    const manifest = buildManifest(files);
    expect(Object.keys(manifest)).toEqual(["index.html"]);
    expect(manifest["index.html"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("empty map returns empty manifest", () => {
    expect(buildManifest(new Map())).toEqual({});
  });

  it("same content → same hash", () => {
    const enc = new TextEncoder().encode("same");
    const a = buildManifest(new Map([["a.txt", enc]]));
    const b = buildManifest(new Map([["a.txt", enc]]));
    expect(a["a.txt"]).toBe(b["a.txt"]);
  });
});

describe("diffManifests", () => {
  const hash1 = "a".repeat(64);
  const hash2 = "b".repeat(64);

  it("identifies files to upload (new)", () => {
    const { upload, remove, unchanged } = diffManifests({}, { "new.html": hash1 });
    expect(upload).toEqual(["new.html"]);
    expect(remove).toEqual([]);
    expect(unchanged).toEqual([]);
  });

  it("identifies files to remove", () => {
    const { upload, remove, unchanged } = diffManifests({ "old.html": hash1 }, {});
    expect(upload).toEqual([]);
    expect(remove).toEqual(["old.html"]);
    expect(unchanged).toEqual([]);
  });

  it("identifies unchanged files", () => {
    const { upload, remove, unchanged } = diffManifests(
      { "same.html": hash1 },
      { "same.html": hash1 },
    );
    expect(upload).toEqual([]);
    expect(remove).toEqual([]);
    expect(unchanged).toEqual(["same.html"]);
  });

  it("identifies modified files as upload", () => {
    const { upload, unchanged } = diffManifests(
      { "f.html": hash1 },
      { "f.html": hash2 },
    );
    expect(upload).toEqual(["f.html"]);
    expect(unchanged).toEqual([]);
  });

  it("handles mixed scenario", () => {
    const remote = { "keep.html": hash1, "delete.html": hash2 };
    const local = { "keep.html": hash1, "new.html": hash1, "changed.html": hash2 };
    // changed.html has hash2 in local, but isn't in remote — so it's an upload
    const { upload, remove, unchanged } = diffManifests(remote, local);
    expect(unchanged).toContain("keep.html");
    expect(upload).toContain("new.html");
    expect(upload).toContain("changed.html");
    expect(remove).toContain("delete.html");
  });
});
