import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AwsClient } from "aws4fetch";
import { createMedia, type R2Config } from "../src/index";

const cfg: R2Config = {
  provider: "r2",
  accountId: "acct123",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "SECRET_TEST_KEY",
  bucket: "assets",
};

describe("createMedia (facade)", () => {
  it("throws on an unknown provider", () => {
    // @ts-expect-error — exercising the runtime guard
    expect(() => createMedia({ provider: "ftp" })).toThrow(/unknown provider/);
  });

  it("returns a uniform store surface for r2", () => {
    const m = createMedia(cfg);
    expect(typeof m.upload).toBe("function");
    expect(typeof m.signedUrl).toBe("function");
    expect(typeof m.delete).toBe("function");
    expect(typeof m.publicUrl).toBe("function");
  });
});

describe("r2 provider — signedUrl (presign, no network)", () => {
  it("produces a presigned GET URL with the bucket host, key and SigV4 query params", async () => {
    const url = await createMedia(cfg).signedUrl("logo.png", { expiresIn: 600 });
    expect(url).toContain("acct123.r2.cloudflarestorage.com/assets/logo.png");
    expect(url).toContain("X-Amz-Expires=600");
    expect(url).toMatch(/X-Amz-Algorithm=AWS4-HMAC-SHA256/);
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]+/);
    expect(url).toMatch(/X-Amz-Credential=/);
  });

  it("pins the EU host when jurisdiction is 'eu' and applies keyPrefix", async () => {
    const url = await createMedia({ ...cfg, jurisdiction: "eu", keyPrefix: "tenants/acme/" }).signedUrl("a/b.png");
    expect(url).toContain("acct123.eu.r2.cloudflarestorage.com/assets/tenants/acme/a/b.png");
    expect(url).toContain("X-Amz-Expires=3600"); // default
  });
});

describe("r2 provider — upload / delete (stubbed fetch)", () => {
  const fetchMock = vi.fn(async (..._args: unknown[]) => new Response("", { status: 200 }));
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uploads with PUT to the prefixed object URL but RETURNS the logical (un-prefixed) key", async () => {
    const r = await createMedia({ ...cfg, keyPrefix: "tenants/acme" }).upload(
      "/logo.png",
      new Uint8Array([1, 2, 3]),
      { contentType: "image/png" },
    );
    expect(r.key).toBe("logo.png"); // logical key, leading slash stripped — NOT "tenants/acme/logo.png"
    expect(fetchMock).toHaveBeenCalledOnce();
    const req = fetchMock.mock.calls[0][0] as Request;
    expect(req.method).toBe("PUT");
    expect(req.url).toContain("/assets/tenants/acme/logo.png"); // prefix still applied on the wire
    expect(req.headers.get("content-type")).toBe("image/png");
    expect(req.headers.get("authorization")).toMatch(/AWS4-HMAC-SHA256/); // request was signed
  });

  it("round-trips: upload()'s returned key feeds back into signedUrl with no double-prefix", async () => {
    const m = createMedia({ ...cfg, keyPrefix: "tenants/acme" });
    const { key } = await m.upload("report-photos/x.png", "data");
    expect(key).toBe("report-photos/x.png"); // logical
    const url = await m.signedUrl(key);
    expect(url.split("tenants/acme/").length - 1).toBe(1); // prefix appears exactly once
    expect(url).toContain("/assets/tenants/acme/report-photos/x.png");
  });

  it("throws on a non-ok upload", async () => {
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    await expect(createMedia(cfg).upload("x.png", "data")).rejects.toThrow(/upload failed 403/);
  });

  it("deletes with DELETE and tolerates a 404", async () => {
    await createMedia(cfg).delete("gone.png");
    expect((fetchMock.mock.calls[0][0] as Request).method).toBe("DELETE");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(createMedia(cfg).delete("missing.png")).resolves.toBeUndefined();
  });

  it("throws on a persistent non-404 delete failure (after retries)", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 })); // every attempt fails
    await expect(createMedia(cfg).delete("x.png")).rejects.toThrow(/delete failed 500/);
  });
});

describe("r2 provider — upload sets Content-Length (R2 411 fix, F059.3)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes an explicit content-length = byteLength for a Uint8Array body", async () => {
    // Spy at the aws4fetch seam so we assert what upload() HANDS to the signer,
    // not what undici recomputes downstream (in plain Node undici sets the length
    // itself, which is exactly why the prod-only 411 doesn't repro here).
    const spy = vi
      .spyOn(AwsClient.prototype, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    await createMedia(cfg).upload("photo.png", new Uint8Array([1, 2, 3, 4, 5]), {
      contentType: "image/png",
    });
    const init = spy.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["content-length"]).toBe("5"); // RED without the fix
  });

  it("omits content-length for a string body (no byteLength — left to fetch)", async () => {
    const spy = vi
      .spyOn(AwsClient.prototype, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    await createMedia(cfg).upload("note.txt", "hello");
    const init = spy.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["content-length"]).toBeUndefined();
  });
});

describe("r2 provider — publicUrl (stable public URL, no network)", () => {
  it("builds publicBaseUrl + keyPrefix + key, normalizing the slashes", () => {
    const m = createMedia({
      ...cfg,
      keyPrefix: "tenants/acme",
      publicBaseUrl: "https://media.example.dev/", // trailing slash tolerated
    });
    expect(m.publicUrl("/a/b.png")).toBe("https://media.example.dev/tenants/acme/a/b.png");
  });

  it("percent-encodes each path segment", () => {
    const m = createMedia({ ...cfg, publicBaseUrl: "https://media.example.dev" });
    expect(m.publicUrl("my folder/æ.png")).toBe("https://media.example.dev/my%20folder/%C3%A6.png");
  });

  it("throws (ship-dark) when publicBaseUrl is not configured", () => {
    expect(() => createMedia(cfg).publicUrl("a.png")).toThrow(/publicBaseUrl/);
  });
});
