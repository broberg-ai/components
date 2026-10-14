// @vitest-environment happy-dom
// F099.23 — owner 15/10 via jam #3303/#3318: a web page's content images come with the clip, fetched
// in the page with its own session; the caps are the consumer's (default 50 images / 100 MB).
import { describe, expect, it } from "vitest";
import { articleExtractor, createArticleExtractor } from "../src/extract";
import { imageSize } from "../src/chat";

/** A PNG header of w × h (enough for imageSize; the rest is padding). */
const png = (w: number, h: number, pad = 64) => {
  const b = new Uint8Array(24 + pad);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const page = (body: string) => {
  document.title = "Artikel";
  document.head.innerHTML = `<base href="https://wiki.example.com/side">`; // a real page's baseURI is its own address
  document.body.innerHTML = `<article><h1>Artikel</h1><p>${"Et afsnit med nok tekst til at Readability tager det. ".repeat(20)}</p>${body}<p>${"Mere tekst. ".repeat(30)}</p></article>`;
  return document;
};
const URL_ = new URL("https://wiki.example.com/side");
function fetcher(routes: Record<string, () => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return routes[url]?.() ?? new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}
const img = (bytes: Uint8Array, type = "image/png") => () => new Response(new Blob([bytes as BlobPart]), { headers: { "content-type": type } });

describe("F099.23 — page images", () => {
  it("content images come as assets (url as in the markdown, alt, mime, size, measured width/height), fetched with the page's session; decoration and icons are left out", async () => {
    const doc = page(`
      <p><img src="https://wiki.example.com/a.png" alt="Diagram"></p>
      <p><img src="/b.png" alt="Foto"></p>
      <p><img src="https://wiki.example.com/deco.png" role="presentation"></p>
      <p><img src="https://wiki.example.com/hidden.png" aria-hidden="true"></p>
      <p><img src="https://wiki.example.com/tiny.png" width="16" height="16"></p>
      <p><img src="https://wiki.example.com/icon.png" alt="ikon"></p>
      <p><img src="https://wiki.example.com/sprite.svg#home"></p>`);
    const { f, calls } = fetcher({
      "https://wiki.example.com/a.png": img(png(800, 600)),
      "https://wiki.example.com/b.png": img(png(320, 200)),
      "https://wiki.example.com/icon.png": img(png(24, 24)),
    });
    const clip = await createArticleExtractor({ images: true, fetch: f }).extract(doc, URL_);
    const unit = clip.units[0]!;
    const assets = unit.assets!.map(({ content: _c, ...a }) => a);
    expect(assets).toStrictEqual([
      { type: "image", url: "https://wiki.example.com/a.png", alt: "Diagram", name: "a.png", mime: "image/png", size: 88, encoding: "base64", width: 800, height: 600 },
      { type: "image", url: "https://wiki.example.com/b.png", alt: "Foto", name: "b.png", mime: "image/png", size: 88, encoding: "base64", width: 320, height: 200 },
    ]);
    for (const a of unit.assets!) expect(unit.content).toContain(`](${a.url})`);
    expect(atob(unit.assets![0]!.content!).length).toBe(88);
    expect(calls.map((c) => c.url).sort()).toStrictEqual(["https://wiki.example.com/a.png", "https://wiki.example.com/b.png", "https://wiki.example.com/icon.png"]);
    expect(calls.every((c) => c.init?.credentials === "include")).toBe(true);
    expect("completeness" in clip).toBe(false);
  });

  it("the consumer's caps: over maxImages or maxImageBytes, and an image that cannot be fetched, are named in missingFiles; complete:false missing:\"files\"", async () => {
    const doc = page(["1", "2", "3", "4"].map((n) => `<p><img src="https://wiki.example.com/${n}.png"></p>`).join("") + `<p><img src="https://wiki.example.com/gone.png"></p>`);
    const { f } = fetcher(Object.fromEntries(["1", "2", "3", "4"].map((n) => [`https://wiki.example.com/${n}.png`, img(png(100, 100, 1000))])));
    const clip = await createArticleExtractor({ images: true, fetch: f, maxImages: 3, maxImageBytes: 2100 }).extract(doc, URL_);
    expect(clip.units[0]!.assets!.map((a) => a.name)).toStrictEqual(["1.png", "2.png"]);
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom", missing: "files" });
    expect(clip.completeness!.missingFiles).toStrictEqual([
      { name: "3.png", why: "clip_limit" },
      { name: "4.png", why: "clip_limit" },
      { name: "gone.png", why: "http", status: 404 },
    ]);
  });

  it("defaults when the consumer sets nothing: 50 images", async () => {
    const doc = page(Array.from({ length: 52 }, (_, i) => `<p><img src="https://wiki.example.com/${i}.png"></p>`).join(""));
    const { f } = fetcher(Object.fromEntries(Array.from({ length: 52 }, (_, i) => [`https://wiki.example.com/${i}.png`, img(png(100, 100))])));
    const clip = await createArticleExtractor({ images: true, fetch: f }).extract(doc, URL_);
    expect(clip.units[0]!.assets).toHaveLength(50);
    expect(clip.completeness!.missingFiles!.map((m) => m.why)).toStrictEqual(["clip_limit", "clip_limit"]);
  });

  it("NEGATIVE CONTROL: articleExtractor (and createArticleExtractor without images) give the same text-only unit as before, no fetch", async () => {
    const doc = page(`<p><img src="https://wiki.example.com/a.png" alt="Diagram"></p>`);
    const before = await articleExtractor.extract(doc, URL_);
    expect(before.units[0]).toStrictEqual({ kind: "page", content: before.units[0]!.content, position: 0 });
    expect(createArticleExtractor()).toBe(articleExtractor);
    const { f, calls } = fetcher({ "https://wiki.example.com/a.png": img(png(800, 600)) });
    const withImages = await createArticleExtractor({ images: true, fetch: f }).extract(doc, URL_);
    expect(withImages.units[0]!.content).toBe(before.units[0]!.content);
    expect(calls).toHaveLength(1);
  });
});

describe("F099.23 — imageSize reads the header", () => {
  it("PNG, GIF, JPEG, WebP (VP8X); unknown → undefined", () => {
    expect(imageSize(png(640, 480))).toStrictEqual({ width: 640, height: 480 });
    expect(imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x00, 0x10, 0x00]))).toStrictEqual({ width: 32, height: 16 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0, 0]);
    expect(imageSize(jpg)).toStrictEqual({ width: 400, height: 300 });
    const webp = new Uint8Array(30);
    webp.set([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8X")]);
    webp.set([0x7f, 0x02, 0x00, 0xdf, 0x01, 0x00], 24);
    expect(imageSize(webp)).toStrictEqual({ width: 640, height: 480 });
    expect(imageSize(new TextEncoder().encode("not an image at all, really"))).toBeUndefined();
  });
});
