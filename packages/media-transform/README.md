# @broberg/media-transform

The fleet's **server-side image-transform primitive** — one `transformImage()`
that decodes iPhone **HEIC/HEIF → JPEG**, auto-orients from EXIF, strips all
metadata, and emits **responsive WebP/JPEG derivatives**. The companion to
[`@broberg/media`](../media) (storage): transform returns buffers, you pipe them
into `media.upload()`.

```bash
npm i @broberg/media-transform
```

Why it exists: iPhone photos arrive as HEIC, which **doesn't render** on
Chrome/desktop and is **rejected by vision models**. This makes every upload
universally displayable + vision-ready, and produces the small WebP sizes you
actually serve.

> **Server-side only.** Pulls native deps (`sharp` + `heic-convert`) — runs on
> **Node and Bun**, not the edge. Storage, video, and EXIF *extraction* are out
> of scope (see below).

## Usage

```ts
import { transformImage } from "@broberg/media-transform";
import { createMedia } from "@broberg/media";

const media = createMedia({ provider: "r2", /* … */ });

const { variants, orientationFixed } = await transformImage(bytes, {
  heicToJpeg: true,        // decode HEIC/HEIF → JPEG first (default true)
  keepOriginal: true,      // also emit the full-res oriented original
  variants: [
    { name: "thumb", maxEdge: 320, format: "webp", quality: 80 },
    { name: "grid",  maxEdge: 800, format: "webp", quality: 80 },
    { name: "full",  maxEdge: 1600, format: "webp", quality: 80 },
  ],
});

// store each output under its own key — transform never touches storage
for (const v of variants) {
  await media.upload(`photos/${id}/${v.name}`, v.bytes, { contentType: v.contentType });
}
```

**Input:** image bytes (`Uint8Array` / `ArrayBuffer` / `Buffer`). Accepts
HEIC/HEIF, JPEG, PNG, WebP.

**Output:** `{ variants, orientationFixed }` where each variant is
`{ name, bytes, contentType, width, height }` — the kept original (if requested)
first, then your derivatives in order. `bytes` is ready for `media.upload()`.

## What it does

1. **HEIC→JPEG decode.** iPhone HEICs are HEVC; `sharp`'s prebuilt libheif reads
   the container but usually can't decode HEVC pixels, so HEIC is routed through
   `heic-convert` (bundles its own HEVC decoder; applies the rotation on decode).
2. **Responsive derivatives** at longest-edge (`maxEdge`) sizes — aspect
   preserved, **never enlarged**, `webp` (default) or `jpeg`, `quality` ~80.
3. **EXIF orientation + privacy strip.** Auto-rotates from the orientation tag,
   then **strips EXIF from _every_ output, including the kept original** — read
   any EXIF you need (GPS, capture time) *before* calling; no location data
   survives on a stored file. `orientationFixed` reports whether a JPEG's tag was
   applied.
4. **keep-original** — the full-resolution image, oriented + stripped (re-encoded,
   not byte-identical). HEIC → JPEG; PNG/WebP keep their format so alpha survives.

## Non-goals

- **Storage** — that's `@broberg/media`; this composes with it.
- **Edge runtime** — native deps; Node/Bun server only.
- **Video** — stream it raw to storage; no transcoding here.
- **On-the-fly / URL resize** — this is upload-time processing, not a CDN.
- **AI / vision** — that's `@broberg/ai-sdk`.
- **EXIF extraction / geocode** — do that before calling; we only orient + strip.

## Runtime support

Verified end-to-end on **Node 25** and **Bun 1.3** (a real iPhone-style HEIC →
oriented JPEG original + WebP derivatives). `heic-convert` is pure-JS, so the
HEIC path works the same on glibc and musl/Alpine where `sharp`'s native HEVC
decoder is absent.
