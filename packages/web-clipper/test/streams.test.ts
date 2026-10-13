// @vitest-environment happy-dom
// F099.20 — big files stream from the page straight to presigned part addresses.
import { afterEach, describe, expect, it, vi } from "vitest";
import { holdStream, streamParts, partCount } from "../src/streams";
import { runContentScript, CONTENT_STREAM_MESSAGE } from "../src/content";
import { streamAsset, STREAM_MESSAGE, partsNeeded } from "../src/extension";

/** A body that arrives in odd-sized chunks, like a real network stream. */
const body = (size: number, chunk = 3_000) => new ReadableStream<Uint8Array>({
  start(c) {
    for (let off = 0; off < size; off += chunk) c.enqueue(new Uint8Array(Math.min(chunk, size - off)).map((_, i) => (off + i) % 251));
    c.close();
  },
});
const source = (size: number) => ({ name: "film.mp4", url: "https://claude.ai/x", init: { credentials: "include" as const }, size, fetch: (async () => new Response(body(size))) as typeof fetch });

describe("F099.20 — streamParts: one part in memory at a time, parts in order, ETags back", () => {
  it("2.5 parts → 3 PUTs of partSize, partSize, rest — byte-identical, ETags in order", async () => {
    const partSize = 10_000;
    const got: Uint8Array[] = [];
    const put = vi.fn(async (_url: string, init?: RequestInit) => { got.push(new Uint8Array(init!.body as Uint8Array)); return new Response("", { headers: { etag: `"e${got.length}"` } }); }) as unknown as typeof fetch;
    const r = await streamParts(source(25_000), ["u1", "u2", "u3"], partSize, put);
    expect(r).toStrictEqual({ etags: ['"e1"', '"e2"', '"e3"'], size: 25_000 });
    expect(got.map((b) => b.length)).toStrictEqual([10_000, 10_000, 5_000]);
    const all = new Uint8Array(25_000); let o = 0; for (const b of got) { all.set(b, o); o += b.length; }
    expect(all.every((v, i) => v === i % 251)).toBe(true);
    expect((put as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0])).toStrictEqual(["u1", "u2", "u3"]);
    expect(partCount(25_000, partSize)).toBe(3);
    expect(partsNeeded(25_000, partSize)).toBe(3);
  });

  it("10 parts: memory never holds more than one part, every PUT is at most partSize", async () => {
    const sizes: number[] = [];
    const put = (async (_u: string, init?: RequestInit) => { sizes.push((init!.body as Uint8Array).length); return new Response("", { headers: { etag: `"${sizes.length}"` } }); }) as typeof fetch;
    const urls = Array.from({ length: 10 }, (_, i) => `u${i + 1}`);
    const r = await streamParts(source(95_000), urls, 10_000, put);
    expect(r.etags).toHaveLength(10);
    expect(sizes).toStrictEqual([...Array(9).fill(10_000), 5_000]);
  });

  it("NEGATIVE CONTROL: a refused part, a missing ETag (CORS hides it) and too few addresses each stop with a named error", async () => {
    const refuse = (async (url: string) => (url === "u2" ? new Response("no", { status: 403 }) : new Response("", { headers: { etag: '"ok"' } }))) as typeof fetch;
    await expect(streamParts(source(25_000), ["u1", "u2", "u3"], 10_000, refuse)).rejects.toThrow("del 2 af «film.mp4» blev afvist (403)");
    const noTag = (async () => new Response("")) as typeof fetch;
    await expect(streamParts(source(5), ["u1"], 10, noTag)).rejects.toThrow(/kom uden ETag/);
    const ok = (async () => new Response("", { headers: { etag: '"x"' } })) as typeof fetch;
    await expect(streamParts(source(25_000), ["u1", "u2"], 10_000, ok)).rejects.toThrow(/flere end 2 dele/);
  });
});

describe("F099.20 — extension ↔ content script: streamAsset hands the addresses over, the page streams", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("end to end with a fake chrome; a forgotten handle is refused", async () => {
    expect(CONTENT_STREAM_MESSAGE).toBe(STREAM_MESSAGE);
    let listener: ((m: unknown, s: unknown, r: (x: unknown) => void) => boolean | void) | undefined;
    delete (globalThis as { __brobergWebClipper?: unknown }).__brobergWebClipper;
    runContentScript([], { onMessage: { addListener: (fn) => { listener = fn as never; } } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { headers: { etag: '"p"' } })));
    const ref = holdStream(source(15));
    const tabs = { query: async () => [{ id: 3 }], sendMessage: (_id: number, msg: unknown) => new Promise((resolve) => listener!(msg, {}, resolve)) };
    expect(await streamAsset({ streamRef: ref, name: "film.mp4" }, { partUrls: ["a", "b"], partSize: 10 }, { tabs })).toStrictEqual({ etags: ['"p"', '"p"'], size: 15 });
    await expect(streamAsset({ streamRef: ref, name: "film.mp4" }, { partUrls: ["a", "b"], partSize: 10 }, { tabs })).rejects.toThrow(/no longer held/);
  });
});
