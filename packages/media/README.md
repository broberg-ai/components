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
  publicBaseUrl: "https://media.example.com", // optional — enables publicUrl() (public bucket)
});

const { key } = await media.upload("logo.png", bytes, { contentType: "image/png" });
const signed = await media.signedUrl(key, { expiresIn: 600 }); // presigned GET, no public bucket
const stable = media.publicUrl(key);                            // stable public URL (needs publicBaseUrl)
await media.delete(key);                                        // idempotent — a missing key is not an error
```

## API

| Method | Returns | Notes |
|---|---|---|
| `upload(key, body, opts?)` | `{ key }` | returns the **logical** key you passed (safe to feed back into the others); `opts.contentType` / `opts.cacheControl` |
| `signedUrl(key, opts?)` | `string` (async) | time-limited presigned GET (`opts.expiresIn` seconds, default 3600) — no public bucket needed |
| `publicUrl(key)` | `string` (**sync**) | stable, non-expiring public URL; needs `publicBaseUrl` + a public bucket; **throws** if `publicBaseUrl` is unset |
| `delete(key)` | `void` | idempotent (404 tolerated) |

Every method takes the **logical** key; `keyPrefix` is applied internally (with a
single `/`, leading slashes stripped), so `keyPrefix:"tenants/acme"` + `"/logo.png"`
→ `tenants/acme/logo.png`. Because `upload()` returns the logical key, storing it and
passing it back never double-prefixes.

> **v0.2.0 (behavior):** `upload()` now returns the **logical** (un-prefixed) key,
> not the prefixed one — so the round-trip into `signedUrl`/`delete`/`publicUrl` is
> symmetric. Only observable when you use `keyPrefix` (and that round-trip was broken
> before). Also new: `publicUrl(key)` + `publicBaseUrl`.

## Public URLs (v0.2.0)

`signedUrl()` expires — wrong for an image embedded in already-published content
(news richtext, a **sent** email). For those, set `publicBaseUrl` (the bucket's R2
custom-domain or `r2.dev` URL) and use `publicUrl(key)` — a stable, non-expiring
URL, built synchronously (no signing/IO) so it drops straight into a template.

The package only **constructs** the URL — the bucket must actually be publicly
readable. Bind a custom domain (via `dns-mcp`, e.g. `media.example.com`) or enable
the bucket's `r2.dev` public URL, then set that as `publicBaseUrl`. Until it is set,
`publicUrl()` throws (public stays off — nothing is exposed by accident).

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
