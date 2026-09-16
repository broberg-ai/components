import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMedia } from "../src/index";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "media-volume-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const store = (extra: Record<string, unknown> = {}) =>
  createMedia({ provider: "volume", root, ...extra } as never);

describe("volume provider — round trip", () => {
  it("stores bytes and reads back exactly what was written", async () => {
    const s = store();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const { key } = await s.upload("avatars/u1/a.png", bytes, { contentType: "image/png" });

    expect(key).toBe("avatars/u1/a.png");
    const got = await s.get(key);
    // Strict equality on the bytes, not "contains" — a truncated write would
    // pass a length-free check.
    expect(got?.bytes).toEqual(bytes);
    expect(got?.contentType).toBe("image/png");
  });

  it("keeps the DECLARED content type rather than re-deriving it from the key", async () => {
    const s = store();
    // The extension says png and the declared type says webp. Whichever the
    // provider answers with tells you which one it actually stored.
    await s.upload("a.png", new Uint8Array([1]), { contentType: "image/webp" });
    expect((await s.get("a.png"))?.contentType).toBe("image/webp");
  });

  it("answers null for a key that is not there, and does not throw", async () => {
    expect(await store().get("nothing/here.png")).toBeNull();
  });

  it("delete is idempotent and removes the metadata too", async () => {
    const s = store();
    await s.upload("a.png", new Uint8Array([1]), { contentType: "image/png" });
    await s.delete("a.png");
    await s.delete("a.png"); // second time must not throw
    expect(await s.get("a.png")).toBeNull();
    const metaRoot = join(root, "meta");
    const left = await readdir(metaRoot, { recursive: true }).catch(() => []);
    expect(left.filter((f) => String(f).endsWith("a.png"))).toEqual([]);
  });

  it("stores objects and metadata in SEPARATE trees, so no key can collide with a meta file", async () => {
    const s = store();
    await s.upload("meta/x.png", new Uint8Array([7]), { contentType: "image/png" });
    await s.upload("objects/x.png", new Uint8Array([8]), { contentType: "image/png" });
    expect((await s.get("meta/x.png"))?.bytes).toEqual(new Uint8Array([7]));
    expect((await s.get("objects/x.png"))?.bytes).toEqual(new Uint8Array([8]));
  });
});

describe("volume provider — the guard against leaving the root", () => {
  const escapes = [
    "../outside.png",
    "avatars/../../outside.png",
    "a/./../../b.png",
    "/etc/passwd/../passwd",
    "a\\..\\..\\b.png",
    "a//b.png",
    "",
  ];

  for (const key of escapes) {
    it(`refuses ${JSON.stringify(key)}`, async () => {
      await expect(store().upload(key, new Uint8Array([1]))).rejects.toThrow(/media\(volume\)/);
    });
  }

  it("refuses a NUL byte in the key", async () => {
    await expect(store().upload("a\0b.png", new Uint8Array([1]))).rejects.toThrow(/NUL/);
  });

  it("writes nothing outside the root when a traversal is attempted", async () => {
    const outside = join(root, "..", "escaped.png");
    await store().upload("../escaped.png", new Uint8Array([1])).catch(() => {});
    await expect(readFile(outside)).rejects.toThrow();
  });

  it("refuses a traversal smuggled in through keyPrefix", async () => {
    await expect(
      store({ keyPrefix: "../elsewhere" }).upload("a.png", new Uint8Array([1])),
    ).rejects.toThrow(/media\(volume\)/);
  });
});

describe("volume provider — URLs", () => {
  it("publicUrl throws until publicBaseUrl is set — the route is the app's, not the store's", () => {
    expect(() => store().publicUrl("a.png")).toThrow(/publicBaseUrl/);
  });

  it("builds a public URL on the app's own route, prefix-free and percent-encoded", () => {
    const s = store({ publicBaseUrl: "https://id.broberg.ai/media/", keyPrefix: "t/acme/" });
    expect(s.publicUrl("avatars/a b.png")).toBe("https://id.broberg.ai/media/avatars/a%20b.png");
  });

  it("signedUrl answers the same URL — there is no third party to sign for", async () => {
    const s = store({ publicBaseUrl: "https://id.broberg.ai/media" });
    expect(await s.signedUrl("a.png", { expiresIn: 60 })).toBe(s.publicUrl("a.png"));
  });

  it("the key upload() returns feeds straight back in — no double prefix", async () => {
    const s = store({ keyPrefix: "t/acme/", publicBaseUrl: "https://x.dk/m" });
    const { key } = await s.upload("a.png", new Uint8Array([1]));
    expect(key).toBe("a.png");
    expect(await s.get(key)).not.toBeNull();
    expect(s.publicUrl(key)).toBe("https://x.dk/m/a.png");
    // And the prefix IS applied on disk — otherwise two tenants share a path.
    await expect(readFile(join(root, "objects", "t", "acme", "a.png"))).resolves.toBeTruthy();
  });
});
