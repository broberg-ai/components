import sharp, { type Sharp } from "sharp";
import convert from "heic-convert";
import type {
  ImageInput,
  OutputFormat,
  OutputVariant,
  TransformOptions,
  TransformResult,
} from "./types";

// HEIF/HEIC ISO-BMFF brands seen on iPhone exports + generic HEIF containers.
const HEIF_BRANDS = new Set([
  "heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "heif",
]);

function toBuffer(input: ImageInput): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input));
  return Buffer.from(input);
}

/** Cheap magic-byte sniff: is this an ISO-BMFF HEIF/HEIC container? */
function isHeif(b: Buffer): boolean {
  if (b.length < 12) return false;
  // bytes 4..8 == "ftyp"
  if (b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70) return false;
  return HEIF_BRANDS.has(b.toString("latin1", 8, 12));
}

/**
 * Return a buffer sharp can decode. sharp's bundled libvips reads the HEIF
 * *container* but its prebuilt libheif typically ships only the AVIF (AV1)
 * decoder, not HEVC — and iPhone HEICs are HEVC. So `sharp(heic).metadata()`
 * succeeds yet `.toBuffer()` fails ("Decoder plugin error"). heic-convert
 * bundles its own HEVC decoder (pure-JS libheif; Node + Bun) and applies the
 * EXIF rotation during decode, so we route every HEIC through it → JPEG, then
 * hand sharp the JPEG. The q0.92 intermediate is well above the final encode.
 */
async function ensureDecodable(buf: Buffer, heicToJpeg: boolean): Promise<Buffer> {
  if (!heicToJpeg || !isHeif(buf)) return buf;
  const jpeg = await convert({ buffer: buf, format: "JPEG", quality: 0.92 });
  return Buffer.from(jpeg);
}

function encode(pipeline: Sharp, format: OutputFormat, quality: number): Sharp {
  return format === "jpeg" ? pipeline.jpeg({ quality }) : pipeline.webp({ quality });
}

const contentTypeFor = (format: OutputFormat): string =>
  format === "jpeg" ? "image/jpeg" : "image/webp";

/**
 * Decode an image (incl. iPhone HEIC), auto-orient it from EXIF, strip all
 * metadata, and emit responsive WebP/JPEG derivatives. Storage-agnostic: it
 * returns buffers + dimensions — pipe each `variant.bytes` into
 * `@broberg/media`'s `upload()`. Server-side only (native deps); Node + Bun.
 */
export async function transformImage(
  input: ImageInput,
  opts: TransformOptions = {},
): Promise<TransformResult> {
  const {
    variants = [],
    heicToJpeg = true,
    keepOriginal = false,
    originalName = "original",
  } = opts;

  if (variants.length === 0 && !keepOriginal) {
    throw new Error(
      "transformImage: nothing to produce — pass variants and/or keepOriginal:true",
    );
  }

  const decodable = await ensureDecodable(toBuffer(input), heicToJpeg);
  const meta = await sharp(decodable).metadata();
  const orientationFixed = (meta.orientation ?? 1) > 1;

  // One decode, cloned per output. .rotate() (no args) bakes the EXIF
  // orientation into the pixels and removes the tag; sharp drops all other
  // metadata by default, so every output is EXIF-stripped.
  const base = sharp(decodable, { failOn: "none" }).rotate();

  const outputs: OutputVariant[] = [];

  if (keepOriginal) {
    // Full-resolution, oriented, stripped. HEIF → JPEG (displayable); keep
    // PNG/WebP so alpha survives; everything else → JPEG.
    let pipeline = base.clone();
    let contentType: string;
    if (meta.format === "png") {
      pipeline = pipeline.png();
      contentType = "image/png";
    } else if (meta.format === "webp") {
      pipeline = pipeline.webp({ quality: 90 });
      contentType = "image/webp";
    } else {
      pipeline = pipeline.jpeg({ quality: 90 });
      contentType = "image/jpeg";
    }
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    outputs.push({
      name: originalName,
      bytes: data,
      contentType,
      width: info.width,
      height: info.height,
    });
  }

  for (const v of variants) {
    const format = v.format ?? "webp";
    const quality = v.quality ?? 80;
    const { data, info } = await encode(
      base.clone().resize(v.maxEdge, v.maxEdge, { fit: "inside", withoutEnlargement: true }),
      format,
      quality,
    ).toBuffer({ resolveWithObject: true });
    outputs.push({
      name: v.name,
      bytes: data,
      contentType: contentTypeFor(format),
      width: info.width,
      height: info.height,
    });
  }

  return { variants: outputs, orientationFixed };
}
