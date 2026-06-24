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
