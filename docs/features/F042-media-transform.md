# F042 — @broberg/media-transform

> **Server-side image-transform primitive for the fleet.** HEIC/HEIF → JPEG decode, WebP responsive derivatives, EXIF auto-orient + strip. The companion to `@broberg/media` (F006): **media = storage; media-transform = pixels.** They compose — transform returns buffers, the caller pipes them into `media.upload()`.

- **Owner:** components · **Layer:** L0 (Rails) · **Dist:** npm `@broberg/media-transform`
- **Status:** **v0.1.0 built + tested** — Node 25 + Bun 1.3 verified end-to-end against a real HEIC (commit `5353f50`). **npm publish pending** (gated, Phase 2). · **First consumer:** xrt81 · likely #2/#3: sanne, cardmem
- **Decision:** Christian — components owns + builds the shared converter. API consumer-validated by xrt81 (#5926); EXIF strip-everywhere per #5928.

## Motivation

xrt81 members upload iPhone photos in **HEIC**, which:
1. **don't render** on Chrome / desktop (only Safari decodes HEIC natively), and
2. are **rejected by the vision models** → `@broberg/ai-sdk` `ai.vision` can't produce alt-text/descriptions.

That is the **#1 blocker**. Secondarily, apps want **WebP + responsive derivatives** (thumb/grid/full) to cut storage and bandwidth across viewports. No shared primitive existed (Discovery empty on `heic`/`sharp`/`thumbnail`/`resize`); without this, every media-heavy repo re-rolls a sharp pipeline with divergent shapes — exactly the drift the inventory exists to prevent.

## Why separate from @broberg/media (not an extension)

`@broberg/media` is deliberately **edge-portable** (Node/Bun/edge) with a **single dep** (`aws4fetch`). Image transform needs **native libvips + a HEVC decoder** (heavy, server-only). Bolting it onto media would drag native binaries into the ~8 repos that only want to store bytes. So: **two primitives, one composition.**

```
 bytes ──▶ media-transform.transformImage() ──▶ { variants[], orientationFixed }
                                                      │
                                for each variant ─────┘──▶ media.upload(key, variant.bytes, {contentType})
```

## The contract (consumer-validated — xrt81 #5926, locked + shipped)

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
// orientationFixed: boolean (true if a JPEG EXIF orientation tag was applied)
```

**Input:** image bytes (`Uint8Array`/`ArrayBuffer`/`Buffer`). Accepts HEIC/HEIF, JPEG, PNG, WebP.

**Behaviour:**
1. **HEIC→JPEG decode** when input is HEIC/HEIF (and `heicToJpeg`). Universal display + vision-ready.
2. **Responsive derivatives** at configurable **longest-edge** (`maxEdge`) sizes, aspect preserved, never enlarged, `quality` (default 80), `format` per-variant (`webp`|`jpeg`).
3. **EXIF orientation + privacy strip** — auto-rotate, then **strip EXIF from _every_ output variant, including keep-original**. Consumers extract EXIF separately *before* calling (e.g. xrt81 reads it into `photos.exif` for reverse-geocode), so provenance lives in their DB; no GPS/location survives on any stored file. `orientationFixed` reports whether a JPEG's orientation tag was applied (HEIC rotation is applied during decode → reported `false`).
4. **keep-original** — full-resolution, oriented, EXIF-stripped (re-encoded). HEIC → JPEG; PNG/WebP keep their format so alpha survives.

Storage-agnostic: returns buffers + dims; the caller owns keys and calls `@broberg/media`.

## Scope / Non-goals

**In scope:** still images only — HEIC/HEIF/JPEG/PNG/WebP decode, WebP/JPEG encode, longest-edge resize, EXIF auto-orient + strip, keep-original.

**Non-goals:** Storage (`@broberg/media`) · Edge runtime (native deps; Node/Bun server only) · Video (streamed raw, no transcode; possible future `@broberg/media-video`) · On-the-fly URL/CDN resize (this is upload-time) · AI/vision (`@broberg/ai-sdk`) · EXIF extraction/geocode (the consumer does that before calling).

## Architecture (as built)

- **Facade:** a small pure function `transformImage(bytes, opts)` + exported types. No classes, no config — single-call, stateless.
- **Engine:** `sharp` (libvips 8.18) for resize / WebP+JPEG encode / EXIF rotate+strip. One decode, `.clone()`d per output.
- **HEIC path — the key finding (spike-proven):** sharp's prebuilt libheif reads the HEIF **container** but ships only the **AVIF** decoder, **not HEVC** — and iPhone HEICs are HEVC. So `sharp(heic).metadata()` succeeds yet `.toBuffer()` throws (`Decoder plugin error`). → **HEIC is routed through `heic-convert`** (pure-JS, bundles its own HEVC decoder; applies rotation on decode), producing a JPEG that sharp then resizes/encodes. Detection is a magic-byte `ftyp`-brand sniff. (See trail: *sharp's prebuilt libheif … not HEVC*.)
- **Bun (hard gate — PASSED):** `sharp` 0.35.2 loads + runs identically under **Bun 1.3.14**; full HEIC→WebP e2e green under Bun. No wasm/sidecar needed.
- **Ship-dark:** `sharp`/`heic-convert` are `external` in the bundle (resolve from the consumer); package imports cleanly.

## Dependencies

- `sharp` ^0.35.2 (native libvips) — resize/encode/orient/strip.
- `heic-convert` ^2.1.0 (pure-JS HEVC decoder) — the HEIC decode step, portable across glibc/musl/Bun.
- **Companion:** `@broberg/media` (F006) for storage — composition partner, not a hard dep.

## Locked decisions

- **API contract** per xrt81 #5926 — `transformImage(bytes, opts)` frozen (above).
- **EXIF: strip everywhere**, including keep-original (#5928). Provenance preserved in the consumer's DB pre-transform; no GPS on downloadable files.
- **Engine:** sharp + heic-convert (NOT sharp-alone — its prebuilt can't decode HEVC-HEIC). Bun-verified, no sidecar.
- **Separate package** from `@broberg/media` — native-dep / server-only profile.

## Rollout

1. **Phase 1 — build (DONE).** components built `@broberg/media-transform` v0.1.0 directly (not extracted later) — spike resolved the HEIC engine + Bun gate up front, against a real HEIC fixture. 10 vitest cases green (Node) + Bun e2e green. Committed `5353f50`.
2. **Phase 2 — publish (NEXT, gated).** npm OIDC publish + Trusted Publisher (needs Christian's go + npm TP setup). Then add to `scripts/inventory-data.mjs` DATA → `node scripts/build-inventory.mjs` → `bash scripts/sync-mockup.sh`; self-report adoption to Discovery.
3. **Phase 3 — pilot adopt (xrt81).** xrt81 wires it behind their `transformImage()` seam, exact-pinned. Live-verify: an uploaded HEIC renders on desktop **and** `ai.vision` returns text. sanne/cardmem adopt as their media surfaces need it.

## Done-gate (epic)

- v0.1.0 published to npm via OIDC (Trusted Publisher), exact-pinnable. *(pending)*
- HEIC→JPEG + WebP derivatives + EXIF orient/strip per the contract. ✅ built + tested
- Proven under Bun. ✅
- ≥1 pilot consumer (xrt81) live-verified: HEIC upload → desktop render + vision text. *(pending adopt)*
- Inventory + Discovery + mockup updated. *(at publish)*

## Open questions

1. **Animated input** (animated WebP/GIF) — out of scope for v0.1.0 (first frame via sharp's default; document). Revisit only if a consumer needs animation preserved.
