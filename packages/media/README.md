# @broberg/media

The fleet's **provider-agnostic media-storage facade** — one `createMedia()` API
(`upload` · `signedUrl` · `delete`) over swappable storage providers, so a later
move between backends never touches a call-site (the `@broberg/ai-sdk` pattern,
for object storage). Ships with **Cloudflare R2**; the config grows to S3 /
Supabase / GCS without changing your code.

```bash
npm i @broberg/media
```

The R2 provider speaks the S3 API and signs with [`aws4fetch`](https://github.com/mhart/aws4fetch)
(tiny, zero-dep, runs in Node · Bun · edge / Workers) — no AWS SDK.

## Usage

```ts
import { createMedia } from "@broberg/media";

const media = createMedia({
  provider: "r2",
  accountId: process.env.R2_ACCOUNT_ID!,
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  bucket: "assets",
  jurisdiction: "eu",          // pin EU data-residency (GDPR); must match how the bucket was created
  keyPrefix: "tenants/acme/",  // optional multi-tenant isolation
});

await media.upload("logo.png", bytes, { contentType: "image/png" });
const url = await media.signedUrl("logo.png", { expiresIn: 600 }); // presigned GET, no public bucket
await media.delete("logo.png"); // idempotent — a missing key is not an error
```

## API

| Method | Returns | Notes |
|---|---|---|
| `upload(key, body, opts?)` | `{ key }` | `body` = anything `fetch` accepts; `opts.contentType` / `opts.cacheControl` |
| `signedUrl(key, opts?)` | `string` | time-limited presigned GET (`opts.expiresIn` seconds, default 3600) |
| `delete(key)` | `void` | idempotent (404 tolerated) |

`keyPrefix` is prepended to every key (with a single `/`); leading slashes on
keys are stripped, so `keyPrefix:"tenants/acme"` + `"/logo.png"` →
`tenants/acme/logo.png`.

## Provisioning the bucket

This package **consumes** an existing bucket + S3 creds. To create an
EU-jurisdiction R2 bucket + scoped creds 100% programmatically (no dashboard),
use the fleet's `dns-mcp` R2Client / MCP tools (`r2_create_bucket`,
`r2_create_scoped_token`) — see the **Cloudflare** card on
[discovery.broberg.ai](https://discovery.broberg.ai/api/infra/cloudflare).
EU jurisdiction is set at creation and is immutable.

---

Part of the [broberg.ai shared inventory](https://discovery.broberg.ai). Search
before you build: `GET https://discovery.broberg.ai/api/search?q=storage`.
