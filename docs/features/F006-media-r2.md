# F006 — Media / R2 — Cloudflare R2 object-storage core

> L0 Rails · runtime-package · effort **M** · impact **high** · owner `cardmem`. Status: Backlog.
> LEAP-candidate: no — stays in `components`.

## Motivation
A thin, framework-agnostic package wrapping Cloudflare R2 (S3-compatible) for all object-storage needs: server-side streaming upload, presigned GET/PUT URL generation, byte-proxy serving with immutable caching, multi-tenant key conventions, MIME/extension allowlist validation, and a ships-dark isConfigured() guard. Targets Bun (Bun.S3Client) natively with an @aws-sdk/client-s3 fallback for Node/Next.js. Does NOT own DB rows, React components, or routing — those are adapter concerns.

## Solution
**runtime-package.** The core R2 primitives are ~identical across 5+ repos: cardmem storage/r2.ts, xrt81 lib/storage.ts, notesmem storage.ts all implement the same six ops with the same env-var names (STORAGE_BACKEND, R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) and the same ships-dark guard. cardmem's comment says 'mirrors xrt81's R2 setup 1:1'. The immutable-cache proxy pattern (getObjectBytes + Cache-Control: immutable, retrofitted as cardmem F106.4) is a correctness bug each copy independently risks. Extract once. S3 wire protocol doesn't change; the domain model (key, mime, size, presign TTL) is narrow.

## Scope

### In scope
- Extract from `broberg/cardmem` `apps/server/src/storage/r2.ts` + `apps/server/src/api/attachments.ts`.
- Core primitives + Hono attachments-router adapter + Next.js presigned-upload adapter + a /management subpath (CF REST bucket provisioning from dns-mcp).

### Out of scope
- App DB rows / attachment metadata tables.
- Per-app key namespace conventions (package ships a keyBuilder factory).

## Architecture

### Best source (reference implementation)
`broberg/cardmem` — `apps/server/src/storage/r2.ts` (all six primitives + ships-dark guard + MIME/ext allowlist + validateUpload + multi-tenant key builder + immutable-cache proxy + public-URL helper; comment documents EU jurisdiction, server-upload-vs-presign-CORS, getObjectBytes-vs-302 caching) + `apps/server/src/api/attachments.ts` (cleanest Hono binding: upload/list/raw/delete/config).

### Other implementations seen
- `broberg/xrt81` `apps/server/src/lib/storage.ts` — origin of STORAGE_BACKEND=local|r2 + putObjectStream (stream into R2 without buffering large video).
- `webhouse/sanneandersen` `site/src/lib/storage/r2.ts` + `.../presigned-upload/route.ts` — browser presigned-PUT + generateStorageKey + isStorageConfigured guard; @aws-sdk (Node/Next adapter).
- `webhouse/dns-mcp` `src/clients/r2.ts` — CF REST bucket mgmt + scoped-token provisioning; EU jurisdiction header (cf-r2-jurisdiction: eu); endpoint formula <account>.eu.r2.cloudflarestorage.com.
- `broberg/notesmem` `apps/cloud/src/storage.ts` — minimal Bun.S3Client (presignUpload/Download); independent key convention proving generateKey must be a factory.

### Headless core vs. adapters
- **Core (no React/next/Hono):** createR2Client(config) (lazy + isConfigured); putObject; putObjectStream; getObjectBytes; presignGet; presignPut; deleteObject; validateUpload(mime,size,filename?,opts?); generateKey(namespace,...segments); publicUrl. Standard env-var names. /management subpath = CF REST provisioning (EU jurisdiction).
- **Stack B (@broberg/media-r2/hono):** Bun.S3Client; createAttachmentsRouter(db,auth) mounting POST /upload, GET /:id/raw (immutable cache), GET /, DELETE /:id, GET /config — lifted from cardmem attachments.ts. No next/* imports.
- **Stack A (@broberg/media-r2/next):** @aws-sdk/client-s3 + s3-request-presigner; createPresignedUploadHandler (from sanneandersen route), useUpload() hook (presign→PUT), UploadButton/MediaPreview components. Imports next/server, never bun.

### Public API
```ts
export { createR2Client, isR2Configured, putObject, putObjectStream, getObjectBytes, presignGet, presignPut, deleteObject, validateUpload, generateKey, publicUrl };
export { DEFAULT_IMAGE_MIMES, DEFAULT_ALLOWED_EXTENSIONS, DEFAULT_MAX_BYTES };
// '@broberg/media-r2/management' → R2ManagementClient
// '@broberg/media-r2/hono' → createAttachmentsRouter
// '@broberg/media-r2/next' → createPresignedUploadHandler, useUpload, UploadButton, MediaPreview
```

## Stories
- **F006.1** — Core: Bun.S3Client wrapper, all six primitives — _AC:_ exports the full core; unit tests cover validateUpload (allowed/blocked/over-size/empty), generateKey (slugify/truncate), isR2Configured (missing env=false); ships dark (no throw at import).
- **F006.2** — Hono attachments-router adapter — _AC:_ createAttachmentsRouter(db,auth) mounts upload/list/raw/delete/config; /raw sets Cache-Control immutable; integration test uploads a PNG, retrieves via /raw, asserts Content-Type + Cache-Control.
- **F006.3** — Pilot: cardmem adopts the package in-monorepo — _AC:_ cardmem storage/r2.ts deleted, replaced by the package; attachments.ts imports the router factory; pnpm build passes; upload+serve unchanged (Lens baseline diff).
- **F006.4** — Stack A adapter: Next.js handler + useUpload hook — _AC:_ createPresignedUploadHandler (sanneandersen pattern, validated against allowlist); useUpload exposes {upload,progress,error,url}; UploadButton wires loading+error; works on Next 16 App Router; no bun imports.
- **F006.5** — Management subpath: bucket provisioning from dns-mcp — _AC:_ R2ManagementClient (create/delete/list bucket, createScopedToken, provision); EU jurisdiction header on every call; endpoint formula <account>.eu.r2.cloudflarestorage.com only.
- **F006.6** — Spread to xrt81 + notesmem — _AC:_ both storage files replaced by package imports; STORAGE_BACKEND=local retained via LocalBackend adapter; both repos build + tests pass with no logic change.

## Acceptance criteria
1. @broberg/media-r2 builds + typechecks clean; core imports no framework packages (adapters isolate bun vs @aws-sdk).
2. Each story (F006.1–F006.6) meets its own AC.
3. Piloted in cardmem and adopted back with no regression (Lens baseline diff).
4. A second consumer (xrt81 or notesmem) migrates off its local storage with identical behaviour.

## Dependencies
- External: bun (peer, Stack B), @aws-sdk/client-s3 + s3-request-presigner (peer, Stack A), zod (env), typescript.

## Rollout
Strangler: 1) extract cardmem r2.ts into the package in-monorepo + Hono adapter, verify cardmem itself no-change; 2) publish to components; 3) adopt back in xrt81 (source of streaming); 4) adopt in notesmem (2 files); 5) add Stack A adapter from sanneandersen, test on Next 16; 6) adopt in sanneandersen; 7) new repos import from start.

LEAP-candidate: no — stays in `components`.

## Open Questions
- Ship a LocalBackend (Fly-volume) so STORAGE_BACKEND=local keeps working, or each repo owns it?
- generateKey factory must accept namespace prefix (cardmem/notesmem/sanneandersen conventions all differ) — also export named prefix constants or leave to consumer?
- Management subpath in this package or stay in dns-mcp (CF_BOOTSTRAP_TOKEN coupling)?
- Expose serveImmutable(key) header helper, or leave Response construction to adapters?

## Effort estimate
**M** — owner session: `cardmem`. Reuse model: runtime-package.

## Risks
EU jurisdiction drift: omitting '.eu.' silently routes to US (GDPR). Core keeps verbatim endpoint from env + boot-time assert it contains '.eu.'; management subpath constructs from account-id + EU constant (dns-mcp approach). Bun.S3Client not in official TS lib types (xrt81 uses a type alias + globalThis accessor) — handle cleanly or Stack A breaks on Node. @aws-sdk vs Bun must both be peer/optional (adapter split enforces). Presigned-PUT CORS: sanneandersen uses public-read ACL, cardmem avoids browser presign — document both, force neither; apps configure R2 CORS themselves for the presign path.