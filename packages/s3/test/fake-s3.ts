// An in-memory S3 that speaks just enough of the protocol: multipart + GET + HEAD.
// It checks what a real bucket checks that matters here: the signature is present,
// a presigned URL does not outlive MAX_EXPIRES, and parts are completed in order.
export interface FakeS3 { fetch: typeof fetch; objects: Map<string, Uint8Array>; meta: Map<string, { headers: Record<string, string>; type: string; at: string }>; uploads: Map<string, { key: string; parts: Map<number, Uint8Array>; headers: Record<string, string>; type: string; at: string }>; requests: string[]; failNextPut: number; pageSize: number; cloudflareCompress: boolean; noRange: boolean }

export function fakeS3(origin = "https://acct.eu.r2.cloudflarestorage.com"): FakeS3 {
  const objects = new Map<string, Uint8Array>();
  const uploads = new Map<string, { key: string; parts: Map<number, Uint8Array>; headers: Record<string, string>; type: string; at: string }>();
  const meta = new Map<string, { headers: Record<string, string>; type: string; at: string }>();
  const amz = (h: Headers) => { const o: Record<string, string> = {}; h.forEach((v, k) => { if (k.startsWith("x-amz-meta-")) o[k] = v; }); return o; };
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const requests: string[] = [];
  let n = 0;
  const etagOf = (b: Uint8Array) => `"etag-${b.length}-${b[0] ?? 0}-${b[b.length - 1] ?? 0}"`;
  const s3: FakeS3 = {
    objects, meta, uploads, requests, failNextPut: 0, pageSize: 1000, cloudflareCompress: false, noRange: false,
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
      if (key === "" && req.method === "GET" && q.get("list-type") === "2") {
        const pre = q.get("prefix") ?? "";
        const all = [...objects.keys()].filter((k) => k.startsWith(pre)).sort();
        const start = Number(q.get("continuation-token") ?? 0);
        const page = all.slice(start, start + s3.pageSize);
        const more = start + s3.pageSize < all.length;
        return new Response(`<ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + s3.pageSize}</NextContinuationToken>` : ""}${page.map((k) => `<Contents><Key>${esc(k)}</Key><Size>${objects.get(k)!.length}</Size><LastModified>${meta.get(k)?.at ?? new Date(0).toISOString()}</LastModified></Contents>`).join("")}</ListBucketResult>`);
      }
      if (key === "" && req.method === "GET" && q.has("uploads")) {
        const pre = q.get("prefix") ?? "";
        const all = [...uploads].filter(([, u]) => u.key.startsWith(pre)).sort((a, b) => (a[1].key + a[0]).localeCompare(b[1].key + b[0]));
        const km = q.get("key-marker"), im = q.get("upload-id-marker");
        const start = km ? all.findIndex(([id, u]) => u.key === km && `listed-${id}` === im) + 1 : 0;
        const page = all.slice(start, start + s3.pageSize);
        const more = start + s3.pageSize < all.length;
        const last = page.at(-1);
        return new Response(`<ListMultipartUploadsResult><IsTruncated>${more}</IsTruncated>${more && last ? `<NextKeyMarker>${esc(last[1].key)}</NextKeyMarker><NextUploadIdMarker>listed-${last[0]}</NextUploadIdMarker>` : ""}${page.map(([id, u]) => `<Upload><Key>${esc(u.key)}</Key><UploadId>listed-${id}</UploadId><Initiated>${u.at}</Initiated></Upload>`).join("")}</ListMultipartUploadsResult>`);
      }
      if (req.method === "POST" && q.has("uploads")) {
        const id = `up${++n}`; uploads.set(id, { key, parts: new Map(), headers: amz(req.headers), type: req.headers.get("content-type") ?? "", at: new Date().toISOString() });
        return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
      }
      // Like R2: an uploadId from a LISTING differs from the one CreateMultipartUpload gave, and both work.
      const upId = q.get("uploadId")?.replace(/^listed-/, "");
      const up = upId ? uploads.get(upId) : undefined;
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
        objects.set(key, all); meta.set(key, { headers: up.headers, type: up.type, at: new Date().toISOString() }); uploads.delete(upId!);
        return new Response("<CompleteMultipartUploadResult/>");
      }
      if (req.method === "DELETE" && up) { uploads.delete(upId!); return new Response(null, { status: 204 }); }
      if (req.method === "PUT" && !q.has("uploadId")) {
        objects.set(key, new Uint8Array(await req.arrayBuffer()));
        meta.set(key, { headers: amz(req.headers), type: req.headers.get("content-type") ?? "", at: new Date().toISOString() });
        return new Response("", { headers: { etag: '"x"' } });
      }
      if (req.method === "DELETE" && !q.has("uploadId")) { objects.delete(key); meta.delete(key); return new Response(null, { status: 204 }); }
      if (req.method === "GET" || req.method === "HEAD") {
        const o = objects.get(key);
        if (!o) return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
        const m = meta.get(key);
        // F111.4 — what Cloudflare does (measured by drive on R2 EU, 10 Nov 2026): a compressible
        // object over ~50 B, asked for without accept-encoding: identity, comes back compressed
        // and WITHOUT Content-Length — on HEAD too.
        const compressed = s3.cloudflareCompress && (m?.type ?? "").startsWith("text/") && o.length > 50 && req.headers.get("accept-encoding") !== "identity";
        if (req.method === "HEAD" && compressed) return new Response(null, { headers: { "content-type": m!.type, "content-encoding": "gzip" } });
        const range = req.headers.get("range");
        if (req.method === "GET" && range && !s3.noRange) {
          if (o.length === 0) return new Response(null, { status: 416, headers: { "content-range": "bytes */0" } });
          return new Response(o.slice(0, 1) as unknown as BodyInit, { status: 206, headers: { "content-range": `bytes 0-0/${o.length}`, "content-length": "1" } });
        }
        return new Response(req.method === "HEAD" ? null : (o as unknown as BodyInit), { headers: { "content-length": String(o.length), ...(m ? { "content-type": m.type, "last-modified": new Date(m.at).toUTCString(), ...m.headers } : {}) } });
      }
      return new Response("<Error><Code>NotImplemented</Code></Error>", { status: 501 });
    }) as typeof fetch,
  };
  return s3;
}
