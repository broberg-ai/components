// F059.4 — list() carries size + last-modified, a Tigris provider, and listBuckets().
// Asked for by buddy for cardmem Operate's backup overview (#47625).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMedia, listBuckets, TIGRIS_ENDPOINT } from "../src/index";

type Seen = { url: string; method: string; auth: string };
let seen: Seen[] = [];
let answer: (url: URL, method: string) => Response;

beforeEach(() => {
  seen = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    seen.push({ url: req.url, method: req.method, auth: req.headers.get("authorization") ?? "" });
    return answer(new URL(req.url), req.method);
  });
});
afterEach(() => vi.unstubAllGlobals());

const LIST_XML =
  `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>backups</Name>` +
  `<Contents><Key>p/db/2026-11-02.sql.gz</Key><LastModified>2026-11-02T03:00:05.000Z</LastModified><Size>2048</Size></Contents>` +
  `<Contents><Key>p/db/2026-11-03.sql.gz</Key><LastModified>2026-11-03T03:00:07.000Z</LastModified><Size>4096</Size></Contents>` +
  `<IsTruncated>false</IsTruncated></ListBucketResult>`;

describe("list() — objects with size and lastModified", () => {
  it("r2: same order and same logical keys as `keys`, with the numbers the bucket gave", async () => {
    answer = () => new Response(LIST_XML, { status: 200 });
    const store = createMedia({ provider: "r2", accountId: "acct", accessKeyId: "k", secretAccessKey: "s", bucket: "backups", jurisdiction: "eu", keyPrefix: "p" });
    const r = await store.list("db");
    expect(r.keys).toEqual(["db/2026-11-02.sql.gz", "db/2026-11-03.sql.gz"]);
    expect(r.objects).toEqual([
      { key: "db/2026-11-02.sql.gz", size: 2048, lastModified: "2026-11-02T03:00:05.000Z" },
      { key: "db/2026-11-03.sql.gz", size: 4096, lastModified: "2026-11-03T03:00:07.000Z" },
    ]);
    expect(r.cursor).toBeUndefined();
    expect(seen[0]!.url.startsWith("https://acct.eu.r2.cloudflarestorage.com/backups?")).toBe(true);
  });

  it("the newest backup is findable from objects alone (the use it exists for)", async () => {
    answer = () => new Response(LIST_XML, { status: 200 });
    const store = createMedia({ provider: "r2", accountId: "acct", accessKeyId: "k", secretAccessKey: "s", bucket: "backups", keyPrefix: "p" });
    const { objects = [] } = await store.list("db");
    const newest = [...objects].sort((a, b) => (a.lastModified < b.lastModified ? 1 : -1))[0];
    expect(newest?.key).toBe("db/2026-11-03.sql.gz");
  });

  it("volume: size is the bytes written and lastModified is an ISO time", async () => {
    const root = await mkdtemp(join(tmpdir(), "media-f0594-"));
    try {
      const store = createMedia({ provider: "volume", root });
      await store.upload("db/a.bin", new Uint8Array(7));
      await store.upload("db/b.bin", new Uint8Array(3));
      const r = await store.list("db");
      expect(r.objects?.map((o) => [o.key, o.size])).toEqual([["db/a.bin", 7], ["db/b.bin", 3]]);
      for (const o of r.objects!) expect(new Date(o.lastModified).toISOString()).toBe(o.lastModified);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("provider tigris", () => {
  it("talks to fly.storage.tigris.dev, path-style, signed for region auto + service s3", async () => {
    answer = () => new Response(LIST_XML.replaceAll("p/db/", "db/"), { status: 200 });
    const store = createMedia({ provider: "tigris", accessKeyId: "tid", secretAccessKey: "ts", bucket: "backups" });
    const r = await store.list("db");
    expect(r.keys).toHaveLength(2);
    expect(seen[0]!.url.startsWith(`${TIGRIS_ENDPOINT}/backups?`)).toBe(true);
    expect(seen[0]!.auth).toMatch(/Credential=tid\/\d{8}\/auto\/s3\/aws4_request/);
  });

  it("the endpoint can be overridden", async () => {
    answer = () => new Response("", { status: 200 });
    const store = createMedia({ provider: "tigris", endpoint: "https://t3.storage.dev/", accessKeyId: "k", secretAccessKey: "s", bucket: "b" });
    await store.upload("x.txt", "x");
    expect(seen[0]!.url).toBe("https://t3.storage.dev/b/x.txt");
  });

  it("errors name tigris, not r2", async () => {
    answer = () => new Response("<Error>AccessDenied</Error>", { status: 403 });
    const store = createMedia({ provider: "tigris", accessKeyId: "k", secretAccessKey: "s", bucket: "b" });
    await expect(store.list("")).rejects.toThrow(/^media\(tigris\): list failed 403/);
  });

  it("follows the continuation token across pages", async () => {
    let call = 0;
    answer = (url) => {
      call++;
      if (!url.searchParams.get("continuation-token")) {
        return new Response(`<ListBucketResult><Contents><Key>a</Key><Size>1</Size><LastModified>2026-11-01T00:00:00Z</LastModified></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;2</NextContinuationToken></ListBucketResult>`, { status: 200 });
      }
      expect(url.searchParams.get("continuation-token")).toBe("tok&2");
      return new Response(`<ListBucketResult><Contents><Key>b</Key><Size>2</Size><LastModified>2026-11-02T00:00:00Z</LastModified></Contents><IsTruncated>false</IsTruncated></ListBucketResult>`, { status: 200 });
    };
    const store = createMedia({ provider: "tigris", accessKeyId: "k", secretAccessKey: "s", bucket: "b" });
    const p1 = await store.list("", { limit: 1 });
    expect(p1).toEqual({ keys: ["a"], objects: [{ key: "a", size: 1, lastModified: "2026-11-01T00:00:00.000Z" }], cursor: "tok&2" });
    const p2 = await store.list("", { limit: 1, cursor: p1.cursor });
    expect(p2).toEqual({ keys: ["b"], objects: [{ key: "b", size: 2, lastModified: "2026-11-02T00:00:00.000Z" }] });
    expect(call).toBe(2);
  });
});

// A real S3 ListAllMyBucketsResult (namespace and Owner block included).
const BUCKETS_XML =
  `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
  `<Owner><ID>abc</ID><DisplayName>abc</DisplayName></Owner><Buckets>` +
  `<Bucket><Name>broberg-call-recordings</Name><CreationDate>2026-10-30T12:00:00.000Z</CreationDate></Bucket>` +
  `<Bucket><Name>cardmem-backups</Name><CreationDate>2026-09-01T08:15:00.000Z</CreationDate></Bucket>` +
  `</Buckets></ListAllMyBucketsResult>`;

describe("listBuckets()", () => {
  it("r2 + eu: one signed GET on the EU host root, parsed to {name, createdAt}", async () => {
    answer = () => new Response(BUCKETS_XML, { status: 200 });
    const b = await listBuckets({ provider: "r2", accountId: "acct", jurisdiction: "eu", accessKeyId: "k", secretAccessKey: "s" });
    expect(b).toEqual([
      { name: "broberg-call-recordings", createdAt: "2026-10-30T12:00:00.000Z" },
      { name: "cardmem-backups", createdAt: "2026-09-01T08:15:00.000Z" },
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ url: "https://acct.eu.r2.cloudflarestorage.com/", method: "GET" });
    expect(seen[0]!.auth).toMatch(/\/auto\/s3\/aws4_request/);
  });

  it("r2 without jurisdiction uses the default host (an EU bucket is not listed there)", async () => {
    answer = () => new Response(BUCKETS_XML, { status: 200 });
    await listBuckets({ provider: "r2", accountId: "acct", accessKeyId: "k", secretAccessKey: "s" });
    expect(seen[0]!.url).toBe("https://acct.r2.cloudflarestorage.com/");
  });

  it("tigris uses its endpoint", async () => {
    answer = () => new Response(BUCKETS_XML, { status: 200 });
    const b = await listBuckets({ provider: "tigris", accessKeyId: "k", secretAccessKey: "s" });
    expect(b.map((x) => x.name)).toEqual(["broberg-call-recordings", "cardmem-backups"]);
    expect(seen[0]!.url).toBe(`${TIGRIS_ENDPOINT}/`);
  });

  it("a refusal throws with the status — never an empty list that looks like 'no buckets'", async () => {
    answer = () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });
    await expect(listBuckets({ provider: "r2", accountId: "acct", accessKeyId: "k", secretAccessKey: "s" })).rejects.toThrow(/^media\(r2\): listBuckets failed 403/);
  });

  it("an <Error> body with status 200 is also a failure", async () => {
    answer = () => new Response("<Error><Code>InternalError</Code></Error>", { status: 200 });
    await expect(listBuckets({ provider: "tigris", accessKeyId: "k", secretAccessKey: "s" })).rejects.toThrow(/listBuckets failed 200/);
  });
});
