// F111.4 — head()/headObject() must never answer 0 for an object that is not empty.
// drive measured on R2 EU (10 Nov 2026): putObject text/plain, N=56 → head 0, N=200 → head 0,
// because Cloudflare compresses the HEAD answer and drops Content-Length; Number(null) = 0.
import { describe, expect, it } from "vitest";
import { createS3Signer, S3Error } from "../src/index";
import { fakeS3 } from "./fake-s3";

function rig(opts: { stripAcceptEncoding?: boolean; noRange?: boolean } = {}) {
  const s3 = fakeS3();
  s3.cloudflareCompress = true;
  s3.noRange = opts.noRange ?? false;
  // A runtime that will not send our accept-encoding (browsers forbid setting it): the fallback must carry it.
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    if (!opts.stripAcceptEncoding || (req.method !== "HEAD" && req.method !== "GET")) return s3.fetch(req);
    const h = new Headers(req.headers);
    h.delete("accept-encoding");
    return s3.fetch(new Request(req.url, { method: req.method, headers: h }));
  }) as typeof fetch;
  const signer = createS3Signer({ accountId: "acct", bucket: "b", accessKeyId: "a", secretAccessKey: "s", fetch: f });
  return { s3, signer };
}

describe("F111.4 — the size of an object, never a guess", () => {
  it("drive's repro: text/plain of 0, 11, 40, 56 and 200 bytes → exactly that size (head + headObject)", async () => {
    const { signer } = rig();
    for (const n of [0, 11, 40, 56, 200]) {
      await signer.putObject({ key: `t/${n}.txt`, body: "x".repeat(n), contentType: "text/plain" });
      expect(await signer.head(`t/${n}.txt`)).toBe(n);
      expect((await signer.headObject(`t/${n}.txt`))!.size).toBe(n);
    }
  });

  it("the HEAD asks for identity, so a compliant store keeps Content-Length — no extra request", async () => {
    const { s3, signer } = rig();
    await signer.putObject({ key: "t/a.txt", body: "x".repeat(200), contentType: "text/plain" });
    const before = s3.requests.length;
    expect(await signer.head("t/a.txt")).toBe(200);
    expect(s3.requests.slice(before)).toStrictEqual(["HEAD /b/t/a.txt"]);
  });

  it("when the HEAD still comes back without Content-Length, ONE ranged GET reads the total from Content-Range", async () => {
    const { s3, signer } = rig({ stripAcceptEncoding: true });
    await signer.putObject({ key: "t/b.txt", body: "x".repeat(200), contentType: "text/plain" });
    const before = s3.requests.length;
    expect(await signer.head("t/b.txt")).toBe(200);
    expect((await signer.headObject("t/b.txt"))!.size).toBe(200);
    expect(s3.requests.slice(before)).toStrictEqual(["HEAD /b/t/b.txt", "GET /b/t/b.txt", "HEAD /b/t/b.txt", "GET /b/t/b.txt"]);
  });

  it("an EMPTY object through the fallback is 0 (416 bytes */0) — a real zero, not a missing number", async () => {
    const { signer } = rig({ stripAcceptEncoding: true });
    await signer.putObject({ key: "t/empty.txt", body: "", contentType: "text/plain" });
    expect(await signer.head("t/empty.txt")).toBe(0);
  });

  it("NEGATIVE: no Content-Length AND no Content-Range → S3Error, never 0", async () => {
    const { signer } = rig({ stripAcceptEncoding: true, noRange: true });
    await signer.putObject({ key: "t/c.txt", body: "x".repeat(200), contentType: "text/plain" });
    await expect(signer.head("t/c.txt")).rejects.toBeInstanceOf(S3Error);
    await expect(signer.headObject("t/c.txt")).rejects.toThrow(/did not say how big/);
  });

  it("a missing object is still null (404), with no fallback request", async () => {
    const { s3, signer } = rig();
    const before = s3.requests.length;
    expect(await signer.head("t/none.txt")).toBeNull();
    expect(await signer.headObject("t/none.txt")).toBeNull();
    expect(s3.requests.slice(before)).toStrictEqual(["HEAD /b/t/none.txt", "HEAD /b/t/none.txt"]);
  });
});
