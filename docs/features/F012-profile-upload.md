# F012 — Profile + Image Upload

> L1 Identity · hybrid · effort **M** · impact **medium** · owner `xrt81`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A self-contained profile-picture feature: client-side file select (hidden input, optional camera capture), optional browser-side compression (browser-image-compression, max 1 MB / 1920 px), multipart POST to a backend endpoint, and an Avatar display with a 3-tier fallback (uploaded picture → Gravatar via hash → coloured initials). Backend stores via a pluggable storage abstraction (local/R2/Supabase) and records a key on the user row. Includes a delete/remove flow reverting to the Gravatar/initials tier.

## Solution
**hybrid.** The headless validation + compression logic (file-type guard, 5 MB hard limit, browser-image-compression producing a 1 MB JPEG) is identical across fysiodk + xrt81 and will be in every future app → runtime package. The Avatar display + upload widget differ enough between Stack A (React/shadcn) and Stack B (Preact) that copying thin adapters is cheaper than a React/Preact dual-build. Server route is a ~30-line copy-owned handler referencing the project's storage + session. Only two real round-trip impls exist (xrt81 full; fysiodk multi-photo but no avatar route; trail none) → UI layer below the package threshold = copy-owned.

## Scope

### In scope
- Extract from `broberg/xrt81`: `apps/server/src/routes/profile.ts`, `routes/members.ts`, `lib/storage.ts`, `apps/web/src/components/ui/Avatar.tsx`, `routes/Konto.tsx`, `lib/api.ts`, `packages/db/src/schema.ts`.
- Headless core (validate/compress/gravatar/tier) + Stack A/B UI adapters (scaffolds) + copy-owned server route templates.

### Out of scope
- The storage abstraction (project-local: R2/Supabase/local).
- Project-local session/auth.

## Architecture

### Best source (reference implementation)
`broberg/xrt81` — only repo with the complete round-trip: POST /api/profile/avatar (5 MB limit, image/* guard, pluggable storage writing avatar_key), DELETE remove, GET /api/members/:id/avatar serve, 3-tier Avatar (uploaded→Gravatar SHA-256→initials), Konto page wiring upload/remove with busy + toast. Every contract decision (key naming, tier order, formData 'file', pluggable storage.ts) established here.

### Other implementations seen (contract cross-check)
- `webhouse/fysiodk-aalborg-sport` `apps/web/src/components/ui/image-upload.tsx` + `lib/image-compression.ts` — best compression pipeline (browser-image-compression maxSizeMB:1, maxWidthOrHeight:1920, fileType image/jpeg, quality 0.7, HEIC/HEIF detection) + multi-file + camera + Supabase storage.
- `broberg/trail` `apps/server/src/routes/{auth,user}.ts` — OAuth-only avatar (avatarUrl from provider); no upload → a consumer, not a source.

### Headless core vs. adapters
- **Core (no React/Preact/next):** validateAvatarFile(file) (image/* + HEIC/HEIF ext, 5 MB hard limit, typed errors); compressAvatarFile(file, opts?) (browser-image-compression defaults 1MB/1920/jpeg/0.7); gravatarUrl(email, sizePx) (SHA-256 via WebCrypto, ?d=404); AvatarTier enum (UPLOADED/GRAVATAR/INITIALS) + resolveAvatarTier; shared types. No fetch/storage/framework.
- **Stack A (Next/React/shadcn):** AvatarImage (onError cascade), AvatarFallback (initials), AvatarUploadButton (shadcn Button + hidden input + optional camera), useAvatarUpload hook (validate+compress+POST, returns {uploading,upload,remove}); Next Route Handler at app/api/profile/avatar (POST+DELETE) calling project storage.
- **Stack B (Bun/Hono/Preact):** Avatar Preact component (xrt81 3-tier), upload UI in Konto (hidden input + button), preact/hooks; Hono route (matches xrt81 profile.ts, copy-owned).

### Public API
```
@broberg/profile-upload — core: validateAvatarFile, compressAvatarFile, gravatarUrl, AvatarTier, resolveAvatarTier + types. Stack adapters ship as separate entry points or copy-owned scaffolds (avoid React/Preact dual-build). Zero peer deps beyond browser-image-compression.
```

## Stories
- **F012.1** — Extract headless core — _AC:_ exports validateAvatarFile/compressAvatarFile/gravatarUrl/AvatarTier + types; zero framework imports; tests: oversized rejected, non-image MIME rejected, HEIC accepted by ext, compression → .jpg image/jpeg File, gravatarUrl null when WebCrypto unavailable.
- **F012.2** — Stack B Avatar + upload wiring (Preact) — _AC:_ xrt81 Avatar.tsx imports gravatarUrl + AvatarTier from the package instead of inlining; Konto upload/remove unchanged; Lens smoke on konto-root passes.
- **F012.3** — Stack B server route scaffold (Hono) — _AC:_ copy-owned profile.ts template documents the 5 MB limit, image/* guard, putObject, avatar_key column; xrt81 profile.ts matches; README shows swapping storage backend.
- **F012.4** — Stack A AvatarUploadButton + useAvatarUpload (React 19) — _AC:_ shadcn Button + hidden input, compress before upload, Loader2 spinner >100ms, success/error toast; hook exposes {uploading,upload,remove}; works in fysiodk profile (currently Gravatar-only).
- **F012.5** — Stack A server route scaffold (Next) — _AC:_ app/api/profile/avatar POST+DELETE template; POST validates with the package, streams to Supabase/R2 by env, writes storage_path; DELETE nulls the column.
- **F012.6** — Lens testid coverage — _AC:_ avatar-upload-trigger/input/remove, avatar-remove-btn, avatar-img, avatar-initials all present; cardmem testid-gaps reports zero new gaps on xrt81 Konto + fysiodk profile.

## Acceptance criteria
1. @broberg/profile-upload builds + typechecks clean; headless core imports no framework packages.
2. Each story (F012.1–F012.6) meets its own AC.
3. Piloted in xrt81 and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (fysiodk) migrates onto the shared package with identical behaviour.

## Dependencies
- F006 — Media / R2 (blocks: server stores via the storage core).
- F009 — User mgmt (related: avatar_key on the user row).
- F013 — Gravatar (related: shares the gravatar helper).
- External: browser-image-compression.

## Rollout
Strangler: 1) extract core from xrt81 Avatar.tsx + profile.ts; 2) replace inline logic in xrt81; 3) scaffold Stack A adapter from fysiodk; 4) add avatar upload to fysiodk (currently Gravatar-only); 5) copy the thin Stack B adapter when a 3rd Hono/Preact consumer appears.

Graduate-candidate: no — stays in `components`.

## Open Questions
- Configurable upload-endpoint prop on Avatar, or hardcode /api/profile/avatar?
- Does fysiodk need full avatar upload (replace Gravatar) or is Gravatar enough long-term?
- Server-side compression for native clients POSTing raw HEIC, or client-only compression permanently?
- Standardise avatar pixel sizes (32/40/48/56) or accept any number?

## Effort estimate
**M** — owner session: `xrt81`. Reuse model: hybrid.

## Risks
Storage abstraction is deliberately project-local — each consumer wires its own. HEIC/HEIF MIME is unreliable (empty type) — keep the fysiodk extension fallback in core. browser-image-compression needs the Canvas API (no Node/Bun) — server just enforces the 5 MB limit + trusts the client-compressed file. Gravatar SHA-256 needs WebCrypto — keep the xrt81 null-guard.
