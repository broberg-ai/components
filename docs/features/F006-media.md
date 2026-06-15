# F006 — Media storage (provider-agnostic)

> L0 Rails · runtime-package · effort **M** · impact **high** · owner `components` (publishes the npm; reference impls from `cardmem` + `sanneandersen`).
> **Status:** shipped — `@broberg/media` **v0.1.0** built + bootstrap-published (2026-06-15). Provider-agnostic facade + Cloudflare R2 provider live; pilot adoptions (cardmem, sanne) + more providers are follow-ups.
> Graduate-candidate: no — small core npm that stays in `components`.
>
> **Rename + reframe (Christian, 2026-06-15):** the package is `@broberg/media`, NOT `@broberg/media-r2`. It's a **provider-agnostic facade** — one API over swappable storage providers (the `@broberg/ai-sdk` model, for object storage) — so a later move between backends never touches a call-site. We start with R2 as the first provider; S3 / Supabase Storage / GCS slot in behind the same `createMedia({ provider })` without changing consumer code.

## Motivation
Several repos hand-roll the same R2/S3 object-storage chokepoint (upload → signed-GET → delete) with diverging implementations. cardmem hand-rolls multi-tenant R2 in Bun-native S3 (key-prefix `tenants/<org>/`, SSRF-guard, 2MB cap, EU jurisdiction; F102 image-attach, F109 webhook-upload). sanneandersen uses R2 + a MinIO dev-target + cid-image embedding in the newsletter. A single thin facade removes that drift and lets a backend swap be a config change, not a rewrite.

## Solution
**runtime-package.** A provider-agnostic `MediaStore` contract (`upload` · `signedUrl` · `delete`) with `createMedia({ provider })` choosing the backend. The R2 provider speaks the S3 API and signs with **aws4fetch** (tiny, zero-dep, runs Node/Bun/edge/Workers) — no AWS SDK, no Bun-only lock-in. Multi-tenant isolation via an optional `keyPrefix`; `jurisdiction:"eu"` pins EU residency. The package CONSUMES an existing bucket + creds; provisioning is a separate fleet capability (dns-mcp R2Client / MCP `r2_create_bucket` · `r2_create_scoped_token`).

## Scope

### In scope (v0.1.0)
- `createMedia(config): MediaStore` facade + a discriminated `MediaConfig` union (R2 today).
- R2 provider (aws4fetch SigV4): `upload`, `signedUrl` (presigned GET), `delete` (idempotent), `keyPrefix`, `jurisdiction`.
- Modest transient-error resilience (aws4fetch `retries: 2`).

### Out of scope (for now)
- Additional providers (s3 / supabase / gcs) — the facade is designed for them; add when a consumer needs one.
- A higher-level "fetch a remote URL → store it" helper with SSRF-guard + size-cap (cardmem's use) — belongs above the primitive; add as `media/fetch` later if ≥2 consumers want it.
- Image transforms / resizing (Cloudflare Images is a separate concern).

## Architecture

### Best source (reference implementations)
- `broberg/cardmem` — multi-tenant R2 in Bun-native S3 (key-prefix, SSRF-guard, 2MB cap, EU). The multi-tenant `keyPrefix` requirement comes from here.
- `webhouse/sanneandersen` — R2 + MinIO dev-target + cid-image newsletter embedding.

### Public API
```ts
import { createMedia } from "@broberg/media";

const media = createMedia({
  provider: "r2",
  accountId, accessKeyId, secretAccessKey, bucket,
  jurisdiction,   // "default" | "eu" — EU pins residency; must match how the bucket was created (immutable)
  keyPrefix,      // optional "tenants/acme/" multi-tenant isolation
});

await media.upload(key, body, { contentType, cacheControl });  // → { key }
await media.signedUrl(key, { expiresIn });                     // → presigned GET URL (default 3600s)
await media.delete(key);                                       // idempotent (404 tolerated)
```

### Provider contract
`MediaStore` = `{ upload, signedUrl, delete }`. Each provider (e.g. `createR2Store`) implements it; `createMedia` switches on `config.provider` and throws on an unknown one.

## Stories
- **F006.1** — Facade + provider contract — _AC:_ `createMedia({provider})` returns a uniform `MediaStore`; unknown provider throws; types are a discriminated union ready for more providers. ✅
- **F006.2** — R2 provider (aws4fetch SigV4) — _AC:_ `upload` PUTs to the right object URL with content-type; `signedUrl` returns a presigned GET (host/key/X-Amz-* correct, EU host when `jurisdiction:"eu"`); `delete` idempotent (404 tolerated); `keyPrefix` applied. ✅
- **F006.3** — Pilot adoption in cardmem — _AC:_ cardmem replaces its hand-rolled R2 client with `createMedia({provider:"r2", keyPrefix})`; multi-tenant key-prefixing + signed-GET behaviour unchanged; F102/F109 flows still work (Lens/runtime-verified).
- **F006.4** — Adopt in sanneandersen — _AC:_ sanne's R2 usage routed through the package; cid-newsletter + MinIO dev-target preserved (dev points at a MinIO-compatible endpoint).

## Acceptance criteria
1. `@broberg/media` builds + typechecks clean; core has one thin runtime dep (aws4fetch), no AWS SDK, no framework imports. ✅
2. R2 provider unit-tested (facade routing, presign shape, upload/delete + retry) — 8 tests green. ✅
3. Piloted in **cardmem** and adopted back with no behavioural regression (multi-tenant key-prefix + signed-GET), runtime-verified.
4. A second consumer (sanneandersen) migrates with identical behaviour.

## Dependencies
- External: `aws4fetch` (^1) — runtime dep (tiny SigV4 signer; edge-safe). First @broberg package with a runtime dep — justified: hand-rolling SigV4 presigning is error-prone tech debt.
- Provisioning prerequisite (not a code dep): an R2 bucket + scoped S3 creds, created via dns-mcp's R2Client / MCP tools (see the Cloudflare infra card on discovery.broberg.ai). EU jurisdiction set at creation (immutable).

## Rollout
Strangler: 1) ship `@broberg/media` v0.1.0 (facade + R2); 2) pilot in cardmem (multi-tenant) → adopt back; 3) adopt in sanneandersen; 4) add providers (s3/supabase) only when a consumer needs one; 5) consider a `media/fetch` SSRF-guarded remote-ingest helper if ≥2 consumers want it.

Graduate-candidate: no — small core npm that stays in `components`.

## Open Questions
- A `list(prefix)` / `exists(key)` method — add when a consumer needs directory-style listing.
- Per-tenant key-prefix vs per-tenant bucket — current model is one bucket + `keyPrefix`; cardmem's `tenants/<org>/` fits this. Per-bucket isolation is a future provider option.

## Effort estimate
**M** — owner session: `components`. Reuse model: runtime-package.

## Risks
SigV4 is finicky — mitigated by leaning on aws4fetch (battle-tested) rather than hand-rolling. EU `jurisdiction` MUST match how the bucket was created (immutable) — a mismatch yields auth/host errors; the README + types call this out. Presigned-URL expiry is caller-controlled (`expiresIn`); default 3600s. aws4fetch retries (2) add modest latency on transient 5xx — acceptable for a storage primitive.
