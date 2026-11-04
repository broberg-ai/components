# @broberg/s3

Upload and download files of **any size** directly between the browser and S3-compatible
storage — Cloudflare **R2 in the EU** by default; Tigris, AWS or MinIO by `endpoint`.
The site's server only issues short-lived, one-object signatures. **Bytes never pass
through it**, and the storage key never leaves it.

```bash
npm i @broberg/s3
```

## Server (Hono / Bun)

```ts
import { createS3Handler, createS3SignerFromEnv } from "@broberg/s3";

const s3 = createS3Handler(createS3SignerFromEnv(), {
  // YOUR check — e.g. BID session + allowlist. Return null to refuse.
  authorize: async (req) => {
    const user = await getSession(req);
    return user && ALLOWED.has(user.email) ? { prefix: `uploads/${user.sub}` } : null;
  },
  maxBytes: 20 * 1024 ** 3,          // default 20 GiB; checked at start AND at complete
  allowedTypes: ["video/*"],          // declared type, not sniffed
});

app.post("/api/s3", (c) => s3(c.req.raw));
```

Next.js: `export const POST = (req: Request) => s3(req);`

Environment (nothing set → every call answers **503 not_configured**; half set → throws at boot):

| R2 (EU by default) | Any S3-compatible |
|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, optional `R2_JURISDICTION=eu\|default` | `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, optional `S3_REGION` |

## Browser

```ts
import { uploadFile, cancelUpload, downloadUrl } from "@broberg/s3/client";

const ctl = new AbortController();
const { key, size } = await uploadFile(file, {
  endpoint: "/api/s3",
  signal: ctl.signal,                 // abort = PAUSE; calling uploadFile again on the same file resumes
  onProgress: (p) => render(p.percent, p.bytesPerSecond, p.secondsLeft),
});
const link = await downloadUrl(key, { endpoint: "/api/s3", filename: "video.mp4" });
await cancelUpload(file, { endpoint: "/api/s3" }); // discard an interrupted upload for good
```

Preact: `import { useUpload } from "@broberg/s3/preact"` → `{ status, progress, error, result, start, pause, cancel }`.
**There is no visual component** — the site owns its design (and its `data-testid`s).

## What has arrived, and what is still under way (v0.2.0)

```ts
// Server, any prefix (e.g. an admin page showing every sender):
await signer.listObjects({ prefix: "uploads/", includeMetadata: true });
// → [{ key, size, lastModified, metadata: { uploadedby, "total-bytes", "original-filename" } }]
await signer.listUploads({ prefix: "uploads/" });
// → [{ key, uploadId, initiated, sentBytes, totalBytes, filename, metadata: { uploadedBy } }]  → «4,9 af 8,0 GB»

// Browser, always locked to the caller's own prefix:
import { listFiles, listUploads } from "@broberg/s3/client";
await listFiles({ endpoint: "/api/s3", metadata: true });
await listUploads({ endpoint: "/api/s3" });
```

Who sent it comes from **your** `authorize()`: return `{ prefix, metadata: { uploadedBy: user.email } }` — set
on the server from the session, never taken from the browser. It is stored as `x-amz-meta-*` on the finished
object (S3 lower-cases those keys: `uploadedby`) and in a small marker under `<folder>/.s3-pending/` while the
upload runs, because S3 cannot report metadata for an unfinished upload. The marker is deleted on complete and
abort and never appears in `listObjects`.

**Match an in-progress upload by `key`, not `uploadId`:** R2 lists a *different* (equally valid) uploadId than
the one start returned — measured live.

## Security — what is enforced

| | |
|---|---|
| No `authorize` → | **401**, nothing reaches the bucket |
| Key outside the user's `prefix/` (incl. `..`, `%2e`, `//`) → | **403**, every action, upload and download |
| Larger than `maxBytes` → | **413** at start; and at complete the real size is read from the bucket — a lie is discarded |
| Type not in `allowedTypes` → | **415** |
| Not `content-type: application/json` (a cross-site form post) → | **415**, nothing happens |
| Not configured → | **503** |
| Signed URL lifetime | ≤ **15 min**, one object (and one part) |
| The secret key | never in any response (tested) |

## Bucket setup (once, by whoever creates the bucket)

**CORS** — without `ExposeHeaders: ETag` the browser cannot finish a multipart upload
(the client says so in its error):

```json
[{ "AllowedOrigins": ["https://your.site"], "AllowedMethods": ["PUT", "GET"],
   "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
```

**Lifecycle** — abort incomplete multipart uploads after 1–7 days, so abandoned parts do not
cost storage forever.

Part size: 16 MiB by default, grown automatically so a file never needs more than 10,000
parts (an 8 GB video = 512 parts; 1 TB fits).
