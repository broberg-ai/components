# F042 — @broberg/media-transform

> **Server-side image-transform primitive for the fleet.** HEIC/HEIF → JPEG decode, WebP responsive derivatives, EXIF auto-orient + strip. The companion to `@broberg/media` (F006): **media = storage; media-transform = pixels.** They compose — transform returns buffers, the caller pipes them into `media.upload()`.

- **Owner:** components · **Layer:** L0 (Rails) · **Dist:** npm `@broberg/media-transform`
- **Status:** planned (carded 2026-06-23) · **First consumer:** xrt81 (blocked) · likely #2/#3: sanne, cardmem
- **Decision:** Christian — components owns + builds the shared converter; xrt81's local impl is the source we extract from. API below is **consumer-validated by xrt81** (intercom #5926).

## Motivation

xrt81 members upload iPhone photos in **HEIC**, which:
1. **don't render** on Chrome / desktop (only Safari decodes HEIC natively), and
2. are **rejected by the vision models** → `@broberg/ai-sdk` `ai.vision` can't produce alt-text/descriptions.

That is the **#1 blocker**. Secondarily, apps want **WebP + responsive derivatives** (thumb/grid/full) to cut storage and bandwidth across viewports. No shared primitive exists (Discovery empty on `heic`/`sharp`/`thumbnail`/`resize`); without this, every media-heavy repo re-rolls a sharp pipeline with divergent shapes — exactly the drift the inventory exists to prevent.

## Why separate from @broberg/media (not an extension)

`@broberg/media` is deliberately **edge-portable** (Node/Bun/edge) with a **single dep** (`aws4fetch`). Image transform needs **native libvips + libheif** (heavy, server-only). Bolting it onto media would drag a native binary into the ~8 repos that only want to store bytes. So: **two primitives, one composition.**

```
 bytes ──▶ media-transform.transformImage() ──▶ { variants[], orientationFixed }
                                                      │
                                for each variant ─────┘──▶ media.upload(key, variant.bytes, {contentType})
```

## The contract (consumer-validated — xrt81 #5926, locked)

```ts
import { transformImage } from "@broberg/media-transform";

const { variants, orientationFixed } = await transformImage(bytes, {
  heicToJpeg: true,                 // decode HEIC/HEIF → JPEG first (the blocker)
  keepOriginal: true,               // also return the (oriented, EXIF-stripped) original as a variant
  variants: [
    { name: "thumb", maxEdge: 320,  format: "webp", quality: 80 },
    { name: "grid",  maxEdge: 800,  format: "webp", quality: 80 },
    { name: "full",  maxEdge: 1600, format: "webp", quality: 80 },
  ],
});
// variants: [{ name, bytes, contentType, width, height }]
// orientationFixed: boolean (true if an EXIF orientation tag was applied)
```

**Input:** image bytes (`Uint8Array`/`Buffer`) + content-type. Accepts HEIC/HEIF, JPEG, PNG, WebP.

**Behaviour:**
1. **HEIC→JPEG decode** when input is HEIC/HEIF (and `heicToJpeg`). Universal display + vision-ready.
2. **Responsive derivatives** at configurable **longest-edge** (`maxEdge`) sizes, aspect preserved, `quality` (default ~80), `format` per-variant (`webp`|`jpeg`).
3. **EXIF orientation + privacy strip** — auto-rotate (iPhone photos carry an orientation tag), then **strip EXIF from _every_ output variant, including keep-original**. Consumers extract EXIF separately *before* calling (e.g. xrt81 reads it into `photos.exif` for reverse-geocode), so provenance lives in their DB; stripping GPS/location from any on-disk file is the privacy-safe default if an original is ever downloaded or shared. `orientationFixed` reports whether rotation was applied.
4. **keep-original** option — return the orientation-normalised, EXIF-stripped original alongside derivatives so the app can store original + derivatives each under its own storage key.

The function is **storage-agnostic**: it returns buffers + dims; the caller owns keys and calls `@broberg/media`.

## Scope / Non-goals

**In scope:** still images only — HEIC/HEIF/JPEG/PNG/WebP decode, WebP/JPEG encode, longest-edge resize, EXIF auto-orient + strip, keep-original.

**Non-goals:**
- **Storage** — that's `@broberg/media`. This composes with it.
- **Edge runtime** — native deps; Node/Bun **server** only.
- **Video** — streamed raw to R2, no transcoding here (possible future `@broberg/media-video`).
- **On-the-fly URL resize / CDN** — this is **upload-time** processing, not a request-time image service.
- **AI / vision** — that's `@broberg/ai-sdk`.
- **EXIF extraction / geocode** — the consumer does that before calling; we only auto-orient + strip.

## Architecture

- **Facade**, same house style as the other `@broberg/*` packages: a small pure function `transformImage(bytes, opts)` (plus exported types). No classes, no config singleton — single-call, stateless.
- **Engine:** `sharp` (libvips). Resize + WebP/JPEG encode + EXIF rotate/strip are all native libvips ops.
- **HEIC path (the risk):** sharp's **prebuilt binaries typically ship without HEVC/HEIF** (patent licensing). Options, decided in the spike (story F042.1):
  - (a) libvips built **with libheif** (control the binary), or
  - (b) `heic-convert` / **libheif-wasm** for the HEIC→raw step only, then hand off to sharp for resize/encode.
  - Lean (b) first if it keeps the install portable and Bun-safe; fall back to (a) if perf/quality demands it.
- **Bun compatibility (hard gate):** xrt81 runs **Bun + Hono**. `sharp` is a native N-API addon — historically finicky under Bun. The spike must **prove it loads + runs under Bun**, else ship a documented Bun-safe path: wasm-only pipeline, or a **Node sidecar** pattern (transform runs in a tiny Node process the Bun app calls). Document whichever wins. **xrt81 will report real data from their Bun+Hono env** (#5928).
- **Ship-dark:** package imports cleanly even if the native engine is absent in an environment; a missing engine throws a clear, catchable error at call-time, never at import.

## Dependencies

- `sharp` (native, libvips) — pinned; HEIC build path per the spike.
- Possibly `heic-convert` / a libheif-wasm build for the HEIC decode step.
- **Companion:** `@broberg/media` (F006) for storage — not a hard dep, a composition partner.
- **Reference impl:** xrt81's local `transformImage()` seam (built first to unblock).

## Locked decisions

- **API contract** per xrt81 #5926 — `transformImage(bytes, opts)` shape frozen (above).
- **EXIF: strip everywhere**, including the keep-original variant (xrt81 #5928). Rationale: provenance preserved in the consumer's DB pre-transform; GPS/location must not survive on any downloadable file.
- **Separate package** from `@broberg/media` (not an extension) — native-dep / server-only profile.

## Rollout

1. **Phase 0 — xrt81 unblocks locally (now).** xrt81 builds the impl behind a thin `transformImage()` seam in their storage layer (the existing async `enrichPhoto` path). Unblocks HEIC display + vision immediately; becomes the extraction source.
2. **Phase 1 — spike (F042.1).** Resolve the two risks: HEIC build path + Bun loading. Output: a proven engine recipe (and Bun strategy) before any package API is frozen. xrt81 feeds back concrete findings from their Bun+Hono env.
3. **Phase 2 — extract + publish (F042.2).** `@broberg/media-transform` v0.1.0 with the contract above, exact-pinned deps, OIDC publish + Trusted Publisher, README with the Bun + HEIC gotchas. Add to `scripts/inventory-data.mjs` DATA → `node scripts/build-inventory.mjs` → `bash scripts/sync-mockup.sh`; self-report adoption to Discovery.
4. **Phase 3 — pilot swap (F042.3).** xrt81 swaps local → `@broberg/media-transform`, exact-pinned. Live-verify: an uploaded HEIC renders on desktop **and** `ai.vision` returns text for it. sanne/cardmem adopt as their media surfaces need it.

## Done-gate (epic)

- v0.1.0 published to npm via OIDC (Trusted Publisher), exact-pinnable.
- HEIC→JPEG + WebP `thumb/grid/full` derivatives + EXIF auto-orient/strip working per the contract.
- **Proven under Bun** (or documented Bun-safe path shipped).
- ≥1 pilot consumer (xrt81) live-verified: HEIC upload → desktop render + vision text.
- Inventory + Discovery + mockup updated.

## Open questions

1. **HEIC engine** — libvips+libheif vs heic-convert/wasm? (F042.1 spike decides; lean wasm-for-decode for portability.)
2. **Bun** — does pinned `sharp` load under Bun, or do we ship wasm/sidecar? (F042.1 hard gate; xrt81 reports from their env.)
3. **Animated input** (animated WebP/GIF) — out of scope for v0.1.0? (Assume yes — first frame or reject; document.)
