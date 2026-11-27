// F042.4 — Photoshop (PSD/PSB) input. sharp/libvips cannot read PSD, so the
// composite ("merged") image is read with ag-psd (pure JS) and handed to sharp
// as raw RGBA. Layers and the thumbnail are skipped: only the flattened image
// is read.
import { initializeCanvas, readPsd } from "ag-psd";

/**
 * The PSD holds no real composite image. Photoshop writes one only with
 * «Maximize PSD and PSB File Compatibility» on; without it the merged image
 * data is blank, and reading it anyway gives an all-black picture. Re-save the
 * file with that option on (Photoshop → Settings → File Handling).
 */
export class PsdNoCompositeError extends Error {
  override readonly name = "PsdNoCompositeError";
  constructor() {
    super(
      "PSD has no composite image (saved without «Maximize Compatibility») — re-save it with Maximize PSD and PSB File Compatibility on",
    );
  }
}

/** A PSD this package cannot turn into a correct image (e.g. 32-bit HDR, Lab, Multichannel). */
export class PsdUnsupportedError extends Error {
  override readonly name = "PsdUnsupportedError";
}

/** "8BPS" — PSD and PSB share it. */
export function isPsd(b: Buffer): boolean {
  return b.length >= 4 && b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53;
}

// ag-psd builds its ImageData through a canvas factory even when no canvas is
// drawn. We never ask it for layers or thumbnails, so a plain-object ImageData
// is all it needs; a real canvas request is a bug and must say so.
let canvasFree = false;
function ensureCanvasFree(): void {
  if (canvasFree) return;
  initializeCanvas(
    () => {
      throw new Error("@broberg/media-transform: ag-psd asked for a canvas — only the composite is read, so none should be needed");
    },
    (width: number, height: number) =>
      ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: "srgb" }) as unknown as ImageData,
  );
  canvasFree = true;
}

/**
 * sharp's own default ceiling (limitInputPixels, 0x3FFF²) — the same guard every
 * other format gets. ag-psd reads before sharp sees anything and only stops at
 * 2 GB, so without this a header claiming 30 000 × 30 000 decodes until a
 * 512 MB machine falls over. Checked from the header, before any decode.
 */
export const PSD_MAX_PIXELS = 268_402_689;

export interface RawRgba {
  data: Buffer;
  width: number;
  height: number;
}

/** The composite image of a PSD as 8-bit RGBA. Throws a named error rather than return a wrong image. */
export function psdComposite(buf: Buffer): RawRgba {
  if (buf.length >= 22) {
    const pixels = buf.readUInt32BE(14) * buf.readUInt32BE(18); // height × width
    if (pixels > PSD_MAX_PIXELS) {
      throw new PsdUnsupportedError(`PSD is ${pixels} pixels — more than the ${PSD_MAX_PIXELS} pixels sharp allows for any image`);
    }
  }
  ensureCanvasFree();
  let psd: ReturnType<typeof readPsd>;
  try {
    psd = readPsd(buf, { skipLayerImageData: true, skipThumbnail: true, useImageData: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not supported|Invalid bitDepth|Exceeded memory limit/i.test(msg)) throw new PsdUnsupportedError(`PSD not supported: ${msg}`);
    throw e;
  }
  // Image resource 1057: Photoshop says whether the merged data is real.
  if (psd.imageResources?.versionInfo?.hasRealMergedData === false) throw new PsdNoCompositeError();
  const img = psd.imageData as { width: number; height: number; data: ArrayLike<number> } | undefined;
  if (!img) throw new PsdNoCompositeError();
  const { width, height, data } = img;
  if (data instanceof Uint8ClampedArray || data instanceof Uint8Array) {
    return { data: Buffer.from(data.buffer, data.byteOffset, data.byteLength), width, height };
  }
  if (data instanceof Uint16Array) {
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i]! >> 8;
    return { data: out, width, height };
  }
  throw new PsdUnsupportedError(`PSD with ${psd.bitsPerChannel ?? "?"}-bit channels is not supported (8 and 16 are)`);
}
