import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { transformImage } from "../src/index";

const fixture = (name: string) =>
  readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

/** A landscape JPEG with no EXIF. */
async function makeJpeg(width = 1200, height = 800): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#1e78c8" } })
    .jpeg()
    .toBuffer();
}

describe("transformImage — guards", () => {
  it("throws when nothing is requested", async () => {
    await expect(transformImage(await makeJpeg(), {})).rejects.toThrow(/nothing to produce/);
  });
});

describe("transformImage — responsive derivatives", () => {
  it("emits longest-edge WebP variants, aspect preserved, never enlarged", async () => {
    const { variants } = await transformImage(await makeJpeg(1200, 800), {
      variants: [
        { name: "thumb", maxEdge: 320 },
        { name: "grid", maxEdge: 800 },
        { name: "full", maxEdge: 1600 }, // larger than source → must NOT upscale
      ],
    });

    expect(variants.map((v) => v.name)).toEqual(["thumb", "grid", "full"]);
    for (const v of variants) {
      expect(v.contentType).toBe("image/webp");
      expect(Math.max(v.width, v.height)).toBeLessThanOrEqual(1200); // no enlargement
      expect(v.width / v.height).toBeCloseTo(1200 / 800, 1); // aspect kept
      expect(v.bytes.byteLength).toBeGreaterThan(0);
    }
    expect(Math.max(variants[0].width, variants[0].height)).toBe(320);
    expect(Math.max(variants[1].width, variants[1].height)).toBe(800);
    expect(Math.max(variants[2].width, variants[2].height)).toBe(1200); // capped at source
  });

  it("honours per-variant format + quality", async () => {
    const { variants } = await transformImage(await makeJpeg(), {
      variants: [{ name: "x", maxEdge: 400, format: "jpeg", quality: 60 }],
    });
    expect(variants[0].contentType).toBe("image/jpeg");
    const meta = await sharp(variants[0].bytes).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("strips metadata from derivatives (no EXIF)", async () => {
    const { variants } = await transformImage(await makeJpeg(), {
      variants: [{ name: "t", maxEdge: 200 }],
    });
    const meta = await sharp(variants[0].bytes).metadata();
    expect(meta.exif).toBeUndefined();
  });
});

describe("transformImage — EXIF orientation", () => {
  it("auto-rotates from the orientation tag and reports it", async () => {
    // orientation 6 = rotate 90° CW → a 1200x800 source presents as 800x1200.
    const oriented = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#1e78c8" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const { variants, orientationFixed } = await transformImage(oriented, {
      variants: [{ name: "full", maxEdge: 2000 }],
    });

    expect(orientationFixed).toBe(true);
    expect(variants[0].width).toBe(800);
    expect(variants[0].height).toBe(1200);
  });

  it("reports orientationFixed:false for an upright image", async () => {
    const { orientationFixed } = await transformImage(await makeJpeg(), {
      variants: [{ name: "t", maxEdge: 100 }],
    });
    expect(orientationFixed).toBe(false);
  });
});

describe("transformImage — keepOriginal", () => {
  it("emits a full-resolution oriented original alongside derivatives", async () => {
    const { variants } = await transformImage(await makeJpeg(1200, 800), {
      keepOriginal: true,
      variants: [{ name: "thumb", maxEdge: 320 }],
    });
    expect(variants.map((v) => v.name)).toEqual(["original", "thumb"]);
    const original = variants[0];
    expect(original.width).toBe(1200);
    expect(original.height).toBe(800);
    expect(original.contentType).toBe("image/jpeg");
  });

  it("keeps PNG (alpha) as PNG for the original", async () => {
    const png = await sharp({
      create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const { variants } = await transformImage(png, { keepOriginal: true });
    expect(variants[0].contentType).toBe("image/png");
  });
});

describe("transformImage — HEIC (iPhone)", () => {
  it("decodes a real HEIC and emits a displayable WebP derivative", async () => {
    const { variants } = await transformImage(await fixture("sample.heic"), {
      variants: [{ name: "grid", maxEdge: 800 }],
    });
    expect(variants[0].contentType).toBe("image/webp");
    const meta = await sharp(variants[0].bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(800);
  });

  it("keepOriginal turns a HEIC original into JPEG", async () => {
    const { variants } = await transformImage(await fixture("sample.heic"), {
      keepOriginal: true,
    });
    expect(variants[0].name).toBe("original");
    expect(variants[0].contentType).toBe("image/jpeg");
  });
});

/** IFD0 tags of a sharp-style EXIF block: tag → first SHORT value. */
function ifd0(exif: Buffer | undefined): Map<number, number> {
  const tags = new Map<number, number>();
  if (!exif) return tags;
  const t = exif.subarray(0, 6).toString("latin1") === "Exif\0\0" ? 6 : 0;
  const le = exif.toString("latin1", t, t + 2) === "II";
  const u16 = (o: number) => (le ? exif.readUInt16LE(o) : exif.readUInt16BE(o));
  const u32 = (o: number) => (le ? exif.readUInt32LE(o) : exif.readUInt32BE(o));
  const base = t + u32(t + 4);
  for (let i = 0; i < u16(base); i++) tags.set(u16(base + 2 + i * 12), u16(base + 2 + i * 12 + 8));
  return tags;
}
const GPS_IFD = 0x8825;
const ORIENT = 0x0112;

/** A 400×200 JPEG tagged Orientation 6 (displays 200×400) with camera + GPS. */
async function makeGpsJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 200, channels: 3, background: "#c81e1e" } })
    .jpeg()
    .withExif({ IFD0: { Make: "TestCam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "57/1 3/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "9/1 55/1 0/1" } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe("transformImage — keepMetadata (helpdesk F013.2)", () => {
  it("DEFAULT unchanged: without the option every output is stripped and metadataKept is false", async () => {
    const r = await transformImage(await makeGpsJpeg(), { keepOriginal: true, variants: [{ name: "sm", maxEdge: 100 }] });
    expect(r.metadataKept).toBe(false);
    for (const v of r.variants) expect((await sharp(v.bytes).metadata()).exif).toBeUndefined();
  });

  it("JPEG source: GPS + camera survive in the original AND in a WebP + JPEG variant; pixels upright, Orientation 1", async () => {
    const r = await transformImage(await makeGpsJpeg(), {
      keepMetadata: true,
      keepOriginal: true,
      variants: [{ name: "sm", maxEdge: 100 }, { name: "jp", maxEdge: 100, format: "jpeg" }],
    });
    expect(r.metadataKept).toBe(true);
    expect(r.orientationFixed).toBe(true);
    for (const v of r.variants) {
      const m = await sharp(v.bytes).metadata();
      expect(m.exif?.includes(Buffer.from("TestCam"))).toBe(true);
      expect(ifd0(m.exif).has(GPS_IFD)).toBe(true);
      expect(m.orientation ?? 1).toBe(1);
      expect(m.height! > m.width!).toBe(true); // portrait: turned exactly once
    }
  });

  it("HEIC source (EXIF says Orientation 6, decoder already turned it): GPS kept, turned ONCE — 200×400, not 400×200", async () => {
    const r = await transformImage(await fixture("gps-orient6.heic"), { keepMetadata: true, keepOriginal: true, variants: [{ name: "sm", maxEdge: 400 }] });
    expect(r.metadataKept).toBe(true);
    for (const v of r.variants) {
      const m = await sharp(v.bytes).metadata();
      expect([v.width, v.height]).toStrictEqual([200, 400]);
      expect(ifd0(m.exif).has(GPS_IFD)).toBe(true);
      expect(m.exif?.includes(Buffer.from("TestCam"))).toBe(true);
      expect(m.orientation ?? 1).toBe(1);
    }
  });

  it("HEIC without the option: stripped, same upright 200×400", async () => {
    const r = await transformImage(await fixture("gps-orient6.heic"), { keepOriginal: true });
    const m = await sharp(r.variants[0]!.bytes).metadata();
    expect(m.exif).toBeUndefined();
    expect([r.variants[0]!.width, r.variants[0]!.height]).toStrictEqual([200, 400]);
    expect(r.metadataKept).toBe(false);
  });

  it("a source with no EXIF never claims metadataKept", async () => {
    const r = await transformImage(await makeJpeg(), { keepMetadata: true, variants: [{ name: "sm", maxEdge: 100 }] });
    expect(r.metadataKept).toBe(false);
  });
});
