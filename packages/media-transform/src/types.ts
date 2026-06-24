// Public contract for @broberg/media-transform. A single pure function —
// transformImage(bytes, opts) — no config, no state. Outputs are buffers you
// hand straight to @broberg/media's upload(); this package never stores anything.

/** A binary image payload. Anything we can wrap in a Buffer for the native engine. */
export type ImageInput = Uint8Array | ArrayBuffer | Buffer;

/** Output encoding for a derivative or the kept original. */
export type OutputFormat = "webp" | "jpeg";

/** One responsive derivative to produce. */
export interface VariantSpec {
  /** Stable name you key the output by (e.g. "thumb", "grid", "full"). */
  name: string;
  /** Longest-edge target in px. Aspect ratio is preserved; images are never enlarged. */
  maxEdge: number;
  /** Output format. Default "webp". */
  format?: OutputFormat;
  /** Encoder quality 1–100. Default 80. */
  quality?: number;
}

export interface TransformOptions {
  /** Responsive derivatives to emit. */
  variants?: VariantSpec[];
  /**
   * Decode HEIC/HEIF input (iPhone photos) so the output is universally
   * displayable and vision-model-readable. Default `true`. When `false`, a HEIC
   * input is only processed if the engine can already read it.
   */
  heicToJpeg?: boolean;
  /**
   * Also emit the full-resolution image — oriented and EXIF-stripped (re-encoded,
   * not byte-identical). HEIC originals become JPEG; PNG/WebP keep their format
   * so alpha survives. Default `false`.
   */
  keepOriginal?: boolean;
  /** Name for the kept-original variant. Default "original". */
  originalName?: string;
}

/** One produced image. `bytes` is ready to hand to @broberg/media's upload(). */
export interface OutputVariant {
  name: string;
  bytes: Uint8Array;
  /** "image/webp" | "image/jpeg" | "image/png" (kept-original only). */
  contentType: string;
  width: number;
  height: number;
}

export interface TransformResult {
  /** The kept original (if requested) followed by the requested derivatives. */
  variants: OutputVariant[];
  /** True if an EXIF orientation tag was present and baked into the pixels. */
  orientationFixed: boolean;
}
