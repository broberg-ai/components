// @vitest-environment happy-dom
// F111.2 — useUpload drives the same engine; this proves the hook's states move
// idle → uploading → done (with progress), and pause → paused.
import { describe, expect, it } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { useUpload } from "../src/preact";
import { createS3Handler, createS3Signer } from "../src/index";
import { fakeS3 } from "./fake-s3";

function rig() {
  const s3 = fakeS3();
  const signer = createS3Signer({ accountId: "acct", bucket: "b", accessKeyId: "a", secretAccessKey: "s", fetch: s3.fetch });
  const handler = createS3Handler(signer, { authorize: () => ({ prefix: "u" }) });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === "/api/s3" ? handler(new Request("http://site/api/s3", init)) : s3.fetch(input, init)) as typeof fetch;
  let api!: ReturnType<typeof useUpload>;
  const Probe = () => { api = useUpload({ endpoint: "/api/s3", fetch: fetchImpl, storage: null }); return null; };
  render(h(Probe, {}), document.createElement("div"));
  return { s3, get api() { return api; } };
}

const file = (n: number) => Object.assign(new Blob([new Uint8Array(n)], { type: "video/mp4" }), { name: "v.mp4", lastModified: 1 });

describe("useUpload", () => {
  it("idle → uploading → done, with progress and a result", async () => {
    const r = rig();
    expect(r.api.status).toBe("idle");
    let p!: Promise<unknown>;
    act(() => { p = r.api.start(file(9 * 1024 * 1024)); });
    expect(r.api.status).toBe("uploading");
    await act(async () => { await p; });
    expect(r.api.status).toBe("done");
    expect(r.api.result?.size).toBe(9 * 1024 * 1024);
    expect(r.api.progress?.percent).toBe(100);
    expect(r.s3.objects.size).toBe(1);
  });
  it("pause → paused, not error", async () => {
    const r = rig();
    let p!: Promise<unknown>;
    act(() => { p = r.api.start(file(40 * 1024 * 1024)); r.api.pause(); });
    await act(async () => { await p; });
    expect(r.api.status).toBe("paused");
    expect(r.api.error).toBeNull();
  });
});
