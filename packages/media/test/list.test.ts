import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";
import { createMedia, type MediaStore } from "../src/index";

// F006.8 — list + deletePrefix, the same contract on both providers.
const KEYS = ["kunder/1/a.txt", "kunder/1/sub/b & c.txt", "kunder/10/x.txt", "andet/y.txt"];
const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** An in-memory bucket answering ListObjectsV2 XML, PUT and DELETE like R2. */
function fakeR2(bucketPrefix = "") {
  const objects = new Set<string>();
  const spy = vi.spyOn(AwsClient.prototype, "fetch").mockImplementation(async (input: unknown, init?: RequestInit | null) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "GET" && url.searchParams.get("list-type") === "2") {
      const p = url.searchParams.get("prefix") ?? "";
      const max = Number(url.searchParams.get("max-keys"));
      const from = Number(url.searchParams.get("continuation-token") ?? 0);
      const all = [...objects].filter((k) => k.startsWith(p)).sort();
      const page = all.slice(from, from + max);
      const more = from + max < all.length;
      const body =
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>assets</Name><Prefix>${xmlEscape(p)}</Prefix>` +
        page.map((k) => `<Contents><Key>${xmlEscape(k)}</Key><Size>1</Size></Contents>`).join("") +
        `<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${from + max}</NextContinuationToken>` : ""}</ListBucketResult>`;
      return new Response(body, { status: 200 });
    }
    const key = decodeURIComponent(url.pathname.replace(/^\/assets\//, ""));
    if (method === "PUT") objects.add(key);
    if (method === "DELETE") objects.delete(key);
    return new Response(null, { status: method === "DELETE" ? 204 : 200 });
  });
  return { objects, spy, bucketPrefix };
}

type Make = () => Promise<{ store: MediaStore; cleanup: () => Promise<void> }>;
const providers: [string, Make][] = [
  [
    "volume",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "media-list-"));
      return { store: createMedia({ provider: "volume", root, keyPrefix: "tenants/acme/" }), cleanup: () => rm(root, { recursive: true, force: true }) };
    },
  ],
  [
    "r2",
    async () => {
      const f = fakeR2();
      return {
        store: createMedia({ provider: "r2", accountId: "a", accessKeyId: "k", secretAccessKey: "s", bucket: "assets", keyPrefix: "tenants/acme/" }),
        cleanup: async () => f.spy.mockRestore(),
      };
    },
  ],
];

describe.each(providers)("F006.8 — %s provider", (_name, make) => {
  let store: MediaStore;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ store, cleanup } = await make());
    for (const k of KEYS) await store.upload(k, "x", { contentType: "text/plain" });
  });
  afterEach(async () => cleanup());

  it("list returns LOGICAL keys under the folder, sorted — and never the neighbour kunder/10", async () => {
    expect(await store.list("kunder/1")).toEqual({ keys: ["kunder/1/a.txt", "kunder/1/sub/b & c.txt"] });
    expect(await store.list("kunder/1/")).toEqual({ keys: ["kunder/1/a.txt", "kunder/1/sub/b & c.txt"] });
  });

  it("an empty prefix lists everything under keyPrefix", async () => {
    expect((await store.list("")).keys).toEqual([...KEYS].sort());
  });

  it("pages with a cursor: no duplicates, nothing missed, no cursor on the last page", async () => {
    const p1 = await store.list("", { limit: 3 });
    expect(p1.keys).toHaveLength(3);
    expect(p1.cursor).toBeTruthy();
    const p2 = await store.list("", { cursor: p1.cursor, limit: 3 });
    expect(p2.cursor).toBeUndefined();
    expect([...p1.keys, ...p2.keys]).toEqual([...KEYS].sort());
  });

  it("refuses a prefix that escapes the root", async () => {
    await expect(store.list("../other")).rejects.toThrow(/escapes the root/);
    await expect(store.list("a\\b")).rejects.toThrow(/backslash/);
  });

  it("deletePrefix removes everything under the folder, says how many, and leaves the neighbour", async () => {
    expect(await store.deletePrefix("kunder/1")).toEqual({ deleted: 2 });
    expect(await store.list("kunder/1")).toEqual({ keys: [] });
    expect((await store.list("")).keys).toEqual(["andet/y.txt", "kunder/10/x.txt"]);
  });

  it("deletePrefix refuses an empty prefix — it would empty the store", async () => {
    await expect(store.deletePrefix("/")).rejects.toThrow(/an empty prefix would empty the whole store/);
    expect((await store.list("")).keys).toHaveLength(4);
  });

  it("deletePrefix keeps going past one page", async () => {
    for (let i = 0; i < 5; i++) await store.upload(`many/${i}.txt`, "x");
    const real = store.list.bind(store);
    store.list = (p, o) => real(p, { ...o, limit: 2 });
    expect(await store.deletePrefix("many")).toEqual({ deleted: 5 });
    expect(await real("many")).toEqual({ keys: [] });
  });
});

describe("F006.8 — deletePrefix never loops on an object that will not go", () => {
  it("throws when a delete reports success but the object stays", async () => {
    // Finite on purpose: the object "goes" after 3 rounds, so a missing guard
    // shows as a wrong result instead of a test that never ends.
    let rounds = 0;
    const store = { list: async () => ({ keys: ++rounds <= 3 ? ["stuck/a.txt"] : [] }), delete: async () => {} };
    const { deleteUnder } = await import("../src/list");
    await expect(deleteUnder(store, "stuck", "r2")).rejects.toThrow('media(r2): deletePrefix stopped — 1 object(s) under "stuck" are still there after being deleted (1 removed before that); first: stuck/a.txt');
  });
});
