import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("uploads with PUT to the object URL, sets content-type, returns the prefixed key", async () => {
    const r = await createMedia({ ...cfg, keyPrefix: "tenants/acme" }).upload(
      "/logo.png",
      new Uint8Array([1, 2, 3]),
      { contentType: "image/png" },
    );
    expect(r.key).toBe("tenants/acme/logo.png"); // prefix applied, leading slash stripped
    expect(fetchMock).toHaveBeenCalledOnce();
    const req = fetchMock.mock.calls[0][0] as Request;
    expect(req.method).toBe("PUT");
    expect(req.url).toContain("/assets/tenants/acme/logo.png");
    expect(req.headers.get("content-type")).toBe("image/png");
    expect(req.headers.get("authorization")).toMatch(/AWS4-HMAC-SHA256/); // request was signed
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
