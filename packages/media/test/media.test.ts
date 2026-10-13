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

describe("F099.20 — r2 multipart: big files go client → bucket in parts, never through the server", () => {
  const calls: Request[] = [];
  const answers: Response[] = [];
  beforeEach(() => {
    calls.length = 0;
    answers.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => { calls.push(req); return answers.shift() ?? new Response("", { status: 200 }); }));
  });
  afterEach(() => vi.unstubAllGlobals());
  const m = () => createMedia({ ...cfg, jurisdiction: "eu", keyPrefix: "tenants/jam/" }).multipart!;

  it("create: POST ?uploads on the EU host with the prefix; returns the logical key + UploadId", async () => {
    answers.push(new Response("<InitiateMultipartUploadResult><Bucket>assets</Bucket><Key>tenants/jam/v/film.mp4</Key><UploadId>abc&amp;123</UploadId></InitiateMultipartUploadResult>"));
    expect(await m().create("v/film.mp4", { contentType: "video/mp4" })).toStrictEqual({ key: "v/film.mp4", uploadId: "abc&123" });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://acct123.eu.r2.cloudflarestorage.com/assets/tenants/jam/v/film.mp4?uploads");
    expect(calls[0]!.headers.get("content-type")).toBe("video/mp4");
  });

  it("presignPart: a signed PUT address carrying partNumber + uploadId, no network; refuses part 0 and 10001", async () => {
    const url = await m().presignPart("v/film.mp4", "abc&123", 7, { expiresIn: 900 });
    expect(url).toContain("acct123.eu.r2.cloudflarestorage.com/assets/tenants/jam/v/film.mp4?");
    expect(url).toContain("partNumber=7");
    expect(url).toContain("uploadId=abc%26123");
    expect(url).toContain("X-Amz-Expires=900");
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]+/);
    expect(calls).toHaveLength(0);
    await expect(m().presignPart("v/film.mp4", "abc", 0)).rejects.toThrow(/1–10000/);
    await expect(m().presignPart("v/film.mp4", "abc", 10001)).rejects.toThrow(/1–10000/);
  });

  it("complete: POST ?uploadId with the parts as XML, in order; a 200 that carries <Error> is a failure", async () => {
    answers.push(new Response("<CompleteMultipartUploadResult><Key>x</Key></CompleteMultipartUploadResult>"));
    expect(await m().complete("v/film.mp4", "abc", [{ partNumber: 1, etag: '"e1"' }, { partNumber: 2, etag: '"e2"' }])).toStrictEqual({ key: "v/film.mp4" });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toMatch(/\?uploadId=abc$/);
    expect(await calls[0]!.text()).toBe('<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"e1"</ETag></Part><Part><PartNumber>2</PartNumber><ETag>"e2"</ETag></Part></CompleteMultipartUpload>');
    answers.push(new Response("<Error><Code>InvalidPart</Code></Error>", { status: 200 }));
    await expect(m().complete("v/film.mp4", "abc", [{ partNumber: 1, etag: '"e1"' }])).rejects.toThrow(/InvalidPart/);
  });

  it("NEGATIVE CONTROL: complete refuses no parts, out-of-order parts and a missing ETag before any request", async () => {
    await expect(m().complete("k", "u", [])).rejects.toThrow(/at least one part/);
    await expect(m().complete("k", "u", [{ partNumber: 2, etag: "a" }, { partNumber: 1, etag: "b" }])).rejects.toThrow(/ascending/);
    await expect(m().complete("k", "u", [{ partNumber: 1, etag: "" }])).rejects.toThrow(/no ETag/);
    expect(calls).toHaveLength(0);
  });

  it("abort: DELETE ?uploadId; a 404 (already gone) is fine; the key cannot climb out of the prefix", async () => {
    answers.push(new Response("", { status: 404 }));
    await m().abort("v/film.mp4", "abc");
    expect(calls[0]!.method).toBe("DELETE");
    await expect(m().create("../escape.mp4")).rejects.toThrow();
  });

  it("the volume provider has no multipart (no address a client could PUT to)", () => {
    expect(createMedia({ provider: "volume", root: "/tmp/x" } as never).multipart).toBeUndefined();
  });
});
