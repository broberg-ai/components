// keepMetadata support for the HEIC route. heic-convert decodes to a JPEG that
// carries no EXIF, so the source's EXIF block is re-attached to that JPEG before
// sharp sees it. heic-convert has already turned the pixels upright, so the
// Orientation tag is set to 1 first — otherwise .rotate() would turn it twice.

const ORIENTATION = 0x0112;

/**
 * A copy of a sharp-style EXIF block ("Exif\0\0" + TIFF) with IFD0's Orientation
 * set to 1. Returns the block unchanged (copied) when there is no Orientation
 * tag, and `null` when the block is not a TIFF we can read.
 */
export function withUprightOrientation(exif: Buffer): Buffer | null {
  const out = Buffer.from(exif);
  const tiff = out.subarray(0, 6).toString("latin1") === "Exif\0\0" ? 6 : 0;
  const order = out.toString("latin1", tiff, tiff + 2);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const u16 = (o: number) => (le ? out.readUInt16LE(o) : out.readUInt16BE(o));
  const u32 = (o: number) => (le ? out.readUInt32LE(o) : out.readUInt32BE(o));
  if (tiff + 8 > out.length) return null;
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > out.length) return null;
  const count = u16(ifd0);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > out.length) return null;
    if (u16(entry) === ORIENTATION) {
      // SHORT, count 1: the value sits left-justified in the 4-byte value field.
      if (le) out.writeUInt16LE(1, entry + 8);
      else out.writeUInt16BE(1, entry + 8);
    }
  }
  return out;
}

/** The JPEG with `exif` inserted as an APP1 segment right after SOI. */
export function jpegWithExif(jpeg: Buffer, exif: Buffer): Buffer {
  const body = exif.subarray(0, 6).toString("latin1") === "Exif\0\0" ? exif : Buffer.concat([Buffer.from("Exif\0\0", "latin1"), exif]);
  if (body.length + 2 > 0xffff) return jpeg; // too large for one APP1 segment
  const header = Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]);
  return Buffer.concat([jpeg.subarray(0, 2), header, body, jpeg.subarray(2)]);
}
