// F042.4 — PSD input. Fixtures are built in the test, two ways, so the reader
// is not only checked against its own writer:
//   - ag-psd's writer (8-bit RGB with and without a real composite)
//   - a minimal flat-PSD writer below, straight from the file format
//     (16-bit RGB, 8-bit CMYK, 32-bit, Lab)
// NOT covered: a file saved by Photoshop itself.
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { readPsd, writePsdBuffer } from "ag-psd";
import { PsdNoCompositeError, PsdUnsupportedError, transformImage } from "../src/index";

const W = 40;
const H = 20;

function rgba8(r: number, g: number, b: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) d.set([r, g, b, 255], i * 4);
  return d;
}

/** ag-psd's writer: a flat 8-bit RGB PSD. */
function agPsd(opts: { composite: boolean }): Buffer {
  return writePsdBuffer(
    opts.composite
      ? { width: W, height: H, imageData: { width: W, height: H, data: rgba8(255, 0, 0) } as ImageData, children: [] }
      : {
          width: W,
          height: H,
          // What Photoshop writes when «Maximize Compatibility» is off.
          imageResources: { versionInfo: { hasRealMergedData: false, writerName: "Adobe Photoshop", readerName: "Adobe Photoshop", fileVersion: 1 } },
          children: [],
        },
    { generateThumbnail: false },
  );
}

/** A minimal flat PSD, raw (uncompressed) planar channels, from the format spec. */
function flatPsd(mode: number, depth: 8 | 16 | 32, channels: number[]): Buffer {
  const bytes = depth / 8;
  const header = Buffer.alloc(26);
  header.write("8BPS", 0, "latin1");
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(channels.length, 12);
  header.writeUInt32BE(H, 14);
  header.writeUInt32BE(W, 18);
  header.writeUInt16BE(depth, 22);
  header.writeUInt16BE(mode, 24);
  const sections = Buffer.alloc(12); // colour mode data, image resources, layer+mask: all empty
  const image = Buffer.alloc(2 + channels.length * W * H * bytes); // compression 0 = raw
  let o = 2;
  for (const v of channels) {
    for (let i = 0; i < W * H; i++) {
      if (bytes === 1) image.writeUInt8(v, o);
      else if (bytes === 2) image.writeUInt16BE(v, o);
      else image.writeFloatBE(v, o);
      o += bytes;
    }
  }
  return Buffer.concat([header, sections, image]);
}

/** The colour of the centre pixel of an output. */
async function centre(bytes: Uint8Array): Promise<[number, number, number]> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 3;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}
const near = (got: number[], want: number[], tol = 6) => got.every((v, i) => Math.abs(v - want[i]!) <= tol);

describe("transformImage — PSD (F042.4)", () => {
  it("8-bit RGB with a composite → WebP variant, right size, red stays red", async () => {
    const r = await transformImage(agPsd({ composite: true }), { variants: [{ name: "preview", maxEdge: 1600 }, { name: "small", maxEdge: 20 }] });
    expect(r.variants.map((v) => [v.name, v.contentType, v.width, v.height])).toEqual([
      ["preview", "image/webp", 40, 20], // never enlarged
      ["small", "image/webp", 20, 10],
    ]);
    expect(near(await centre(r.variants[0]!.bytes), [255, 0, 0])).toBe(true);
    expect(r.orientationFixed).toBe(false);
    expect(r.metadataKept).toBe(false);
  });

  it("keepOriginal of a PSD is a PNG at full size", async () => {
    const r = await transformImage(agPsd({ composite: true }), { keepOriginal: true });
    expect(r.variants.map((v) => [v.contentType, v.width, v.height])).toEqual([["image/png", 40, 20]]);
    expect(near(await centre(r.variants[0]!.bytes), [255, 0, 0])).toBe(true);
  });

  it("NO composite (saved without Maximize Compatibility) → PsdNoCompositeError, never a black image", async () => {
    const file = agPsd({ composite: false });
    // The trap this guards: read naively, the file IS an all-black picture.
    const naive = readPsd(file, { skipLayerImageData: true, skipThumbnail: true, useImageData: true });
    expect(Array.from(naive.imageData!.data.slice(0, 4))).toEqual([0, 0, 0, 255]);

    const err = await transformImage(file, { variants: [{ name: "preview", maxEdge: 1600 }] }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PsdNoCompositeError);
    expect((err as Error).name).toBe("PsdNoCompositeError");
    expect((err as Error).message).toContain("Maximize");
  });

  it("16-bit RGB → correct 8-bit colour", async () => {
    const r = await transformImage(flatPsd(3, 16, [0, 65535, 0]), { variants: [{ name: "p", maxEdge: 100 }] });
    expect(near(await centre(r.variants[0]!.bytes), [0, 255, 0])).toBe(true);
  });

  it("8-bit CMYK (print file) → RGB: red reads as red, full black as black (approximate, no ICC)", async () => {
    // PSD stores CMYK inverted: 255 = no ink. Red = C0 M100 Y100 K0, which
    // Photoshop shows as about (237, 28, 36); ag-psd gives (255, 46, 23).
    const red = await centre((await transformImage(flatPsd(4, 8, [255, 0, 0, 255]), { variants: [{ name: "p", maxEdge: 100 }] })).variants[0]!.bytes);
    expect(red[0]).toBeGreaterThan(220);
    expect(Math.max(red[1], red[2])).toBeLessThan(70);
    const black = await centre((await transformImage(flatPsd(4, 8, [255, 255, 255, 0]), { variants: [{ name: "p", maxEdge: 100 }] })).variants[0]!.bytes);
    expect(Math.max(...black)).toBeLessThan(60);
  });

  it("32-bit (HDR) → PsdUnsupportedError, not a wrong image", async () => {
    await expect(transformImage(flatPsd(3, 32, [1, 0, 0]), { variants: [{ name: "p", maxEdge: 100 }] })).rejects.toBeInstanceOf(PsdUnsupportedError);
  });

  it("Lab colour mode → PsdUnsupportedError", async () => {
    await expect(transformImage(flatPsd(9, 8, [128, 128, 128]), { variants: [{ name: "p", maxEdge: 100 }] })).rejects.toBeInstanceOf(PsdUnsupportedError);
  });
});
