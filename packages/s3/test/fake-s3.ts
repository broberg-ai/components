// An in-memory S3 that speaks just enough of the protocol: multipart + GET + HEAD.
// It checks what a real bucket checks that matters here: the signature is present,
// a presigned URL does not outlive MAX_EXPIRES, and parts are completed in order.
export interface FakeS3 { fetch: typeof fetch; objects: Map<string, Uint8Array>; uploads: Map<string, { key: string; parts: Map<number, Uint8Array> }>; requests: string[]; failNextPut: number }

export function fakeS3(origin = "https://acct.eu.r2.cloudflarestorage.com"): FakeS3 {
  const objects = new Map<string, Uint8Array>();
  const uploads = new Map<string, { key: string; parts: Map<number, Uint8Array> }>();
  const requests: string[] = [];
  let n = 0;
  const etagOf = (b: Uint8Array) => `"etag-${b.length}-${b[0] ?? 0}-${b[b.length - 1] ?? 0}"`;
  const s3: FakeS3 = {
    objects, uploads, requests, failNextPut: 0,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (!url.href.startsWith(origin)) throw new Error(`fake-s3: unexpected origin ${url.origin}`);
      requests.push(`${req.method} ${url.pathname}${url.search}`);
      const presigned = url.searchParams.has("X-Amz-Signature");
      if (!presigned && !req.headers.get("authorization")) return new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });
      if (presigned && Number(url.searchParams.get("X-Amz-Expires")) > 900) return new Response("<Error><Code>TooLong</Code></Error>", { status: 400 });
      const key = decodeURIComponent(url.pathname.split("/").slice(2).join("/"));
      const q = url.searchParams;
      if (req.method === "POST" && q.has("uploads")) {
        const id = `up${++n}`; uploads.set(id, { key, parts: new Map() });
        return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
      }
      const up = q.get("uploadId") ? uploads.get(q.get("uploadId")!) : undefined;
      if (q.get("uploadId") && (!up || up.key !== key)) return new Response("<Error><Code>NoSuchUpload</Code></Error>", { status: 404 });
      if (req.method === "PUT" && up) {
        if (s3.failNextPut > 0) { s3.failNextPut--; return new Response("boom", { status: 500 }); }
        const b = new Uint8Array(await req.arrayBuffer());
        up.parts.set(Number(q.get("partNumber")), b);
        return new Response("", { headers: { etag: etagOf(b) } });
      }
      if (req.method === "GET" && up) {
        const parts = [...up.parts].sort((a, b) => a[0] - b[0]).map(([pn, b]) => `<Part><PartNumber>${pn}</PartNumber><ETag>${etagOf(b).replace(/"/g, "&quot;")}</ETag><Size>${b.length}</Size></Part>`).join("");
        return new Response(`<ListPartsResult><IsTruncated>false</IsTruncated>${parts}</ListPartsResult>`);
      }
      if (req.method === "POST" && up) {
        const xml = await req.text();
        const listed = [...xml.matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>([^<]*)<\/ETag>/g)].map((m) => [Number(m[1]), m[2]!.replace(/&quot;/g, '"')] as const);
        for (let i = 1; i < listed.length; i++) if (listed[i]![0] <= listed[i - 1]![0]) return new Response("<Error><Code>InvalidPartOrder</Code></Error>");
        const chunks: Uint8Array[] = [];
        for (const [pn, etag] of listed) { const b = up.parts.get(pn); if (!b || etagOf(b) !== etag) return new Response("<Error><Code>InvalidPart</Code></Error>"); chunks.push(b); }
        const all = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0)); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
        objects.set(key, all); uploads.delete(q.get("uploadId")!);
        return new Response("<CompleteMultipartUploadResult/>");
      }
      if (req.method === "DELETE" && up) { uploads.delete(q.get("uploadId")!); return new Response(null, { status: 204 }); }
      if (req.method === "GET" || req.method === "HEAD") {
        const o = objects.get(key);
        if (!o) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
        return new Response(req.method === "HEAD" ? null : (o as unknown as BodyInit), { headers: { "content-length": String(o.length) } });
      }
      return new Response("<Error><Code>NotImplemented</Code></Error>", { status: 501 });
    }) as typeof fetch,
  };
  return s3;
}
