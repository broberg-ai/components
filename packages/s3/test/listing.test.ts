// F111.3 — what has arrived and what is still under way, for fysio.work/upload.
import { describe, expect, it } from "vitest";
import { createS3Handler, createS3Signer, markerKeyFor } from "../src/index";
import { listFiles, listUploads, uploadFile } from "../src/client";
import { fakeS3 } from "./fake-s3";

const MiB = 1024 * 1024;
function rig(pageSize = 1000) {
  const s3 = fakeS3(); s3.pageSize = pageSize;
  const signer = createS3Signer({ accountId: "acct", bucket: "b", accessKeyId: "a", secretAccessKey: "s", fetch: s3.fetch });
  const handler = createS3Handler(signer, { authorize: () => ({ prefix: "uploads/patrick", metadata: { uploadedBy: "patrick@example.dk" } }) });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === "/api/s3" ? handler(new Request("http://site/api/s3", init)) : s3.fetch(input, init)) as typeof fetch;
  const call = async (body: unknown) => (await handler(new Request("http://site/api/s3", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))).json();
  return { s3, signer, fetchImpl, call };
}
const file = (n: number, name: string) => Object.assign(new Blob([new Uint8Array(n)], { type: "video/mp4" }), { name, lastModified: 1 });

describe("listUploads — an upload half-way shows «sent of total» and who", () => {
  it("one of three parts in → sentBytes 16 MiB of 48 MiB, sender from authorize, filename", async () => {
    const { signer, call, fetchImpl } = rig();
    const s = await call({ action: "start", filename: "Patrick knæ.mp4", size: 48 * MiB, type: "video/mp4" });
    const { urls } = await call({ action: "sign", key: s.key, uploadId: s.uploadId, partNumbers: [1] });
    await fetchImpl(urls[0].url, { method: "PUT", body: new Uint8Array(16 * MiB) });
    const ups = await signer.listUploads({ prefix: "uploads/" });
    expect(ups).toHaveLength(1);
    expect(ups[0]!.uploadId).not.toBe(s.uploadId); // R2 behaviour: the listed id differs from the started one
    expect(ups[0]).toMatchObject({ key: s.key, sentBytes: 16 * MiB, totalBytes: 48 * MiB, filename: "Patrick knæ.mp4", metadata: { uploadedBy: "patrick@example.dk" } });
    // the browser sees the same through its own prefix
    expect((await listUploads({ endpoint: "/api/s3", fetch: fetchImpl }))[0]!.sentBytes).toBe(16 * MiB);
  });
  it("pages through ListMultipartUploads (3 uploads, 1 per page)", async () => {
    const { signer, call } = rig(1);
    for (const f of ["a.mp4", "b.mp4", "c.mp4"]) await call({ action: "start", filename: f, size: 10 * MiB, type: "video/mp4" });
    const ups = await signer.listUploads({ prefix: "uploads/" });
    expect(ups.map((u) => u.filename).sort()).toEqual(["a.mp4", "b.mp4", "c.mp4"]);
  });
});

describe("listObjects — what has arrived", () => {
  it("after complete: the file is listed with its sender, the marker is gone and never listed", async () => {
    const { s3, signer, fetchImpl } = rig();
    const r = await uploadFile(file(9 * MiB, "done.mp4"), { endpoint: "/api/s3", fetch: fetchImpl, storage: null });
    expect([...s3.objects.keys()].filter((k) => k.includes(".s3-pending"))).toEqual([]);
    const objs = await signer.listObjects({ prefix: "uploads/", includeMetadata: true });
    expect(objs).toHaveLength(1);
    expect(objs[0]).toMatchObject({ key: r.key, size: 9 * MiB, metadata: { uploadedby: "patrick@example.dk", "total-bytes": String(9 * MiB), "original-filename": "done.mp4" } });
    const info = await signer.headObject(r.key);
    expect(info?.contentType).toBe("video/mp4");
    expect((await listFiles({ endpoint: "/api/s3", fetch: fetchImpl }))[0]!.key).toBe(r.key);
  });
  it("a marker of an upload in progress is never listed as a file", async () => {
    const { signer, call } = rig();
    const s = await call({ action: "start", filename: "x.mp4", size: 10 * MiB, type: "video/mp4" });
    expect(await signer.getText(markerKeyFor(s.key))).toContain('"totalBytes"');
    expect(await signer.listObjects({ prefix: "uploads/" })).toEqual([]);
  });
  it("pages through ListObjectsV2 (5 objects, 2 per page)", async () => {
    const { signer } = rig(2);
    for (let i = 0; i < 5; i++) await signer.putObject({ key: `uploads/p/f${i}.txt`, body: "x" });
    expect((await signer.listObjects({ prefix: "uploads/" })).map((o) => o.key)).toEqual([0, 1, 2, 3, 4].map((i) => `uploads/p/f${i}.txt`));
  });
  it("abort removes the marker too", async () => {
    const { s3, call } = rig();
    const s = await call({ action: "start", filename: "x.mp4", size: 10 * MiB, type: "video/mp4" });
    const a = await call({ action: "abort", key: s.key, uploadId: s.uploadId });
    expect(a).toEqual({ aborted: true, markerRemoved: true });
    expect(s3.objects.size).toBe(0);
  });
});

describe("listing is locked to the caller's prefix", () => {
  it("objects/uploads actions only ever list under the authorized prefix", async () => {
    const { s3, call, signer } = rig();
    await signer.putObject({ key: "uploads/someone-else/secret.mp4", body: "x" });
    await signer.start({ key: "uploads/someone-else/other.mp4" });
    expect((await call({ action: "objects" })).objects).toEqual([]);
    expect((await call({ action: "uploads" })).uploads).toEqual([]);
    expect(s3.requests.filter((r) => r.includes("prefix=")).every((r) => r.includes("prefix=uploads%2Fpatrick%2F"))).toBe(true);
  });
});
