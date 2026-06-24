// @broberg/media-transform — the fleet's server-side image-transform primitive (F042).
// HEIC/HEIF → JPEG decode, EXIF auto-orient + strip, responsive WebP/JPEG derivatives.
// Companion to @broberg/media (storage): transform returns buffers, you upload() them.
export { transformImage } from "./transform";
export type {
  ImageInput,
  OutputFormat,
  OutputVariant,
  TransformOptions,
  TransformResult,
  VariantSpec,
} from "./types";
