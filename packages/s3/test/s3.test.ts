import { describe, expect, it } from "vitest";
import { createS3Handler, createS3Signer, createS3SignerFromEnv, choosePartSize, MIN_PART_SIZE } from "../src/index";
import { cancelUpload, downloadUrl, uploadFile, type UploadProgress } from "../src/client";
import { fakeS3 } from "./fake-s3";
import { createHash } from "node:crypto";

const sha = (b?: Uint8Array) => (b ? createHash("sha256").update(b).digest("hex") : "missing");

const SECRET = "test-secret-" + "x".repeat(28);
const MiB = 1024 * 1024;

function setup(opts: Partial<Parameters<typeof createS3Handler>[1]> = {}, user: string | null = "users/alice") {
  const s3 = fakeS3();
  const signer = createS3Signer({ accountId: "acct", bucket: "b", accessKeyId: "AKID", secretAccessKey: SECRET, fetch: s3.fetch });
  const handler = createS3Handler(signer, { authorize: () => (user ? { prefix: user } : null), ...opts });
  const call = (body: unknown) => handler(new Request("http://site/api/s3", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  // The browser's fetch: endpoint → handler, anything else → the bucket.
  const browserFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (u === "/api/s3") return handler(new Request("http://site/api/s3", init));
    return s3.fetch(input, init);
  }) as typeof fetch;
  return { s3, signer, handler, call, browserFetch };
}

const bytes = (n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 255; return b; };
const file = (n: number, name = "video.mp4") => Object.assign(new Blob([bytes(n)], { type: "video/mp4" }), { name, lastModified: 1 });
const memStorage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

describe("signer", () => {
  it("defaults to the EU R2 endpoint, path-style", async () => {
    const { signer } = setup();
    const url = new URL(await signer.signDownload({ key: "users/alice/x.mp4" }));
    expect(url.origin).toBe("https://acct.eu.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/b/users/alice/x.mp4");
  });
  it("a presigned URL never lives longer than 15 minutes, whatever is asked", async () => {
    const { signer } = setup();
    const url = new URL(await signer.signPart({ key: "users/alice/x", uploadId: "u", partNumber: 1, expiresIn: 86400 }));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("partNumber")).toBe("1");
    expect(url.searchParams.has("X-Amz-Signature")).toBe(true);
  });
  it("part size: ≥ 8 MiB and ≤ 10,000 parts even for 8 GB and 1 TB", () => {
    expect(choosePartSize(8 * 1024 ** 3)).toBe(16 * MiB);
    const tb = 1024 ** 4;
    const p = choosePartSize(tb);
    expect(p).toBeGreaterThanOrEqual(MIN_PART_SIZE);
    expect(Math.ceil(tb / p)).toBeLessThanOrEqual(10_000);
  });
  it("another S3-compatible endpoint is used as given", async () => {
    const s = createS3Signer({ endpoint: "https://fly.storage.tigris.dev/", bucket: "b", accessKeyId: "a", secretAccessKey: "s" });
    expect(new URL(await s.signDownload({ key: "k" })).origin).toBe("https://fly.storage.tigris.dev");
  });
  it("from env: nothing set = null (ship dark); half set = a loud error", () => {
    expect(createS3SignerFromEnv({})).toBeNull();
    expect(() => createS3SignerFromEnv({ R2_ACCOUNT_ID: "a", R2_BUCKET: "b" })).toThrow(/missing R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/);
    expect(createS3SignerFromEnv({ R2_ACCOUNT_ID: "a", R2_BUCKET: "b", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s" })).not.toBeNull();
  });
});

describe("handler — security", () => {
  it("no authorization → 401, and nothing reaches the bucket", async () => {
    const { call, s3 } = setup({}, null);
    const r = await call({ action: "start", filename: "a.mp4", size: 10, type: "video/mp4" });
    expect(r.status).toBe(401);
    expect(s3.requests).toEqual([]);
  });
  it("not configured → 503", async () => {
    const h = createS3Handler(null, { authorize: () => ({ prefix: "u" }) });
    const r = await h(new Request("http://site/api/s3", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("not_configured");
  });
  it("a key outside the user's prefix is refused for every action, including traversal and encoding tricks", async () => {
    const { call, s3 } = setup();
    for (const key of ["users/bob/x.mp4", "users/alice/../bob/x.mp4", "users/alice/%2e%2e/bob/x", "users/alice", "users/alicex/y", "/users/alice/x", "users/alice//x"]) {
      for (const action of ["sign", "list", "complete", "abort", "download"]) {
        const r = await call({ action, key, uploadId: "u", partNumbers: [1], parts: [{ partNumber: 1, etag: "e" }] });
        expect(r.status, `${action} ${key}`).toBe(403);
      }
    }
    expect(s3.requests).toEqual([]);
  });
  it("too large → 413 at start; a type not allowed → 415; unknown action → 400", async () => {
    const { call } = setup({ maxBytes: 100, allowedTypes: ["video/*"] });
    expect((await call({ action: "start", filename: "a.mp4", size: 101, type: "video/mp4" })).status).toBe(413);
    expect((await call({ action: "start", filename: "a.exe", size: 10, type: "application/x-msdownload" })).status).toBe(415);
    expect((await call({ action: "start", filename: "a.mp4", size: 10, type: "video/mp4" })).status).toBe(200);
    expect((await call({ action: "nope" })).status).toBe(400);
  });
  it("an upload that grew past maxBytes after start is discarded at complete (sizes come from the bucket)", async () => {
    const { call, s3, browserFetch } = setup({ maxBytes: 20 * MiB });
    const s = await (await call({ action: "start", filename: "a.mp4", size: 10, type: "video/mp4" })).json();
    // lie: declared 10 bytes, send 3 × 8 MiB
    const parts = [];
    for (const n of [1, 2, 3]) {
      const { urls } = await (await call({ action: "sign", key: s.key, uploadId: s.uploadId, partNumbers: [n] })).json();
      const res = await browserFetch(urls[0].url, { method: "PUT", body: bytes(8 * MiB) });
      parts.push({ partNumber: n, etag: res.headers.get("etag") });
    }
    const r = await call({ action: "complete", key: s.key, uploadId: s.uploadId, parts });
    expect(r.status).toBe(413);
    expect(s3.objects.size).toBe(0);
    expect(s3.uploads.size).toBe(0);
  });
  it("a cross-site form post (text/plain) is refused before anything happens", async () => {
    const { handler, s3 } = setup();
    const r = await handler(new Request("http://site/api/s3", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ action: "start", filename: "a.mp4", size: 10, type: "video/mp4" }) }));
    expect(r.status).toBe(415);
    expect((await r.json()).error.code).toBe("json_required");
    expect(s3.requests).toEqual([]);
  });
  it("no response body or header ever contains the secret access key", async () => {
    const { call } = setup();
    const bodies: string[] = [];
    const s = await call({ action: "start", filename: "a.mp4", size: 10, type: "video/mp4" });
    bodies.push(await s.clone().text());
    const { key, uploadId } = await s.json();
    for (const b of [{ action: "sign", key, uploadId, partNumbers: [1] }, { action: "download", key }, { action: "list", key, uploadId }, { action: "bad" }]) {
      const r = await call(b);
      bodies.push(await r.text(), JSON.stringify([...r.headers]));
    }
    for (const b of bodies) expect(b).not.toContain(SECRET);
  });
});

describe("browser upload + download, end to end against the fake bucket", () => {
  it("uploads in parallel parts, completes in order, and the stored object is byte-identical", async () => {
    const { s3, browserFetch } = setup();
    // Make later parts finish FIRST, so completion order is not upload order.
    const slowFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : String(input);
      const pn = u.startsWith("http") ? Number(new URL(u).searchParams.get("partNumber") ?? 0) : 0;
      if (pn) await new Promise((r) => setTimeout(r, (5 - pn) * 15));
      return browserFetch(input, init);
    }) as typeof fetch;
    const f = file(4 * 8 * MiB + 123);
    const seen: UploadProgress[] = [];
    const r = await uploadFile(f, { endpoint: "/api/s3", fetch: slowFetch, storage: memStorage(), onProgress: (p) => seen.push(p), concurrency: 4 });
    expect(r.size).toBe(f.size);
    expect(sha(s3.objects.get(r.key))).toBe(sha(bytes(f.size)));
    const last = seen.at(-1)!;
    expect(last.sentBytes).toBe(f.size);
    expect(last.percent).toBe(100);
    expect(last.partsDone).toBe(last.partsTotal);
    expect(seen.some((p) => p.bytesPerSecond > 0)).toBe(true);
  });
  it("a failing part is retried", async () => {
    const { s3, browserFetch } = setup();
    s3.failNextPut = 2;
    const r = await uploadFile(file(9 * MiB), { endpoint: "/api/s3", fetch: browserFetch, storage: null });
    expect(s3.objects.get(r.key)?.length).toBe(9 * MiB);
  });
  it("resume: after a pause, the second run sends only the missing parts", async () => {
    const { s3, browserFetch } = setup();
    const storage = memStorage();
    const f = file(3 * 16 * MiB);
    const ctl = new AbortController();
    let puts = 0;
    const pausing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await browserFetch(input, init);
      if (init?.method === "PUT" && ++puts === 1) ctl.abort();
      return res;
    }) as typeof fetch;
    await expect(uploadFile(f, { endpoint: "/api/s3", fetch: pausing, storage, signal: ctl.signal, concurrency: 1 })).rejects.toBeTruthy();
    expect(storage.m.size).toBe(1);
    const before = s3.requests.filter((x) => x.startsWith("PUT")).length;
    const r = await uploadFile(f, { endpoint: "/api/s3", fetch: browserFetch, storage, concurrency: 1 });
    const sentNow = s3.requests.filter((x) => x.startsWith("PUT")).length - before;
    expect(sentNow).toBe(2);
    expect(sha(s3.objects.get(r.key))).toBe(sha(bytes(f.size)));
    expect(storage.m.size).toBe(0);
  });
  it("cancel discards the parts in the bucket and the resume state", async () => {
    const { s3, browserFetch } = setup();
    const storage = memStorage();
    const f = file(2 * 16 * MiB);
    const ctl = new AbortController();
    const pausing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await browserFetch(input, init);
      if (init?.method === "PUT") ctl.abort();
      return res;
    }) as typeof fetch;
    await uploadFile(f, { endpoint: "/api/s3", fetch: pausing, storage, signal: ctl.signal, concurrency: 1 }).catch(() => {});
    expect(s3.uploads.size).toBe(1);
    await cancelUpload(f, { endpoint: "/api/s3", fetch: browserFetch, storage });
    expect(s3.uploads.size).toBe(0);
    expect(storage.m.size).toBe(0);
  });
  it("download: a signed link to your own object; someone else's is refused", async () => {
    const { browserFetch } = setup();
    const r = await uploadFile(file(9 * MiB), { endpoint: "/api/s3", fetch: browserFetch, storage: null });
    const url = await downloadUrl(r.key, { endpoint: "/api/s3", fetch: browserFetch, filename: "Patrick video.mp4" });
    expect(new URL(url).searchParams.get("response-content-disposition")).toContain("Patrick video.mp4");
    const got = await browserFetch(url);
    expect(sha(new Uint8Array(await got.arrayBuffer()))).toBe(sha(bytes(9 * MiB)));
    await expect(downloadUrl("users/bob/x.mp4", { endpoint: "/api/s3", fetch: browserFetch })).rejects.toMatchObject({ status: 403 });
  });
});
