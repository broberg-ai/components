// @vitest-environment jsdom
// F099.3 — the extraction plug-in point and the article extractor lifted from Trail.
import { describe, expect, it, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { articleExtractor, extractArticle, extractClip, pickExtractor, NothingToClipError, type Extractor } from "../src/extract";
import { extractPageContent } from "./fixtures/trail-extractor-f5ce8ba";
import { PAGES } from "./fixtures/pages";

const doc = (html: string, url = "https://example.com/post") => new JSDOM(html, { url }).window.document;
const realDocument = globalThis.document;
afterEach(() => { (globalThis as { document: Document }).document = realDocument; });

describe("F099.3 — articleExtractor gives exactly what Trail's extractor gives", () => {
  for (const [name, html] of Object.entries(PAGES)) {
    it(`${name}: strict equality with Trail's extractor.ts (f5ce8ba)`, () => {
      (globalThis as { document: Document }).document = doc(html);
      const trail = extractPageContent();
      const ours = extractArticle(doc(html));
      expect(trail).not.toBeNull();
      expect(ours).toStrictEqual({ title: trail!.title, markdown: trail!.content });
    });
  }

  it("the rules are really applied: atx headings, fenced code, '-' bullets, no script/nav/footer text", () => {
    const md = extractArticle(doc(PAGES.article!))!.markdown;
    expect(md).toContain("## Why it matters");
    expect(md).toContain("```");
    expect(md).toContain("-   Send only what is new.");
    expect(md).not.toContain("window.tracker");
    expect(md).not.toContain("© 2026");
  });

  it("Trail's remove rule is really there: a <header> Readability keeps is dropped from the markdown", () => {
    const md = extractArticle(doc(PAGES.embedded!))!.markdown;
    expect(md).toContain("Main paragraph one");
    expect(md).not.toContain("Byline header text");
  });

  it("deterministic (jam #2983): the same DOM twice gives byte-identical markdown", () => {
    for (const html of Object.values(PAGES)) {
      expect(extractArticle(doc(html))).toStrictEqual(extractArticle(doc(html)));
    }
  });

  it("the page document is not mutated (Readability gets a clone)", () => {
    const d = doc(PAGES.article!);
    const before = d.documentElement.outerHTML;
    extractArticle(d);
    expect(d.documentElement.outerHTML).toBe(before);
  });

  it("articleExtractor wraps it as a Clip with one page unit", async () => {
    const url = new URL("https://example.com/post");
    const clip = await articleExtractor.extract(doc(PAGES.article!), url);
    expect(clip).toStrictEqual({
      url: "https://example.com/post",
      title: "Fingerprints, explained",
      units: [{ kind: "page", content: extractArticle(doc(PAGES.article!))!.markdown, position: 0 }],
    });
  });

  it("nothing to clip is a named error, not an empty clip (an empty body: Readability returns null — measured)", async () => {
    const empty = doc("<!doctype html><html><head><title>x</title></head><body></body></html>");
    expect(extractArticle(empty)).toBeNull();
    await expect(articleExtractor.extract(empty, new URL("https://example.com/"))).rejects.toBeInstanceOf(NothingToClipError);
  });
});

describe("F099.3 — a consumer's extractor wins on its own URLs", () => {
  const chat: Extractor = {
    id: "chatgpt",
    matches: (u) => u.hostname === "chatgpt.com",
    async extract(_d, u) {
      return { url: u.href, title: "chat", anchor: u.pathname.split("/").pop(), units: [{ kind: "turn", role: "user", content: "hej", position: 0 }] };
    },
  };

  it("on chatgpt.com the registered reader is picked, not the article extractor", async () => {
    const url = new URL("https://chatgpt.com/c/abc123");
    expect(pickExtractor(url, [chat]).id).toBe("chatgpt");
    const clip = await extractClip(doc(PAGES.article!, url.href), url, [chat]);
    expect(clip.anchor).toBe("abc123");
    expect(clip.units[0]!.kind).toBe("turn");
  });

  it("everywhere else the article extractor is the fallback", () => {
    expect(pickExtractor(new URL("https://example.com/x"), [chat]).id).toBe("article");
    expect(pickExtractor(new URL("https://example.com/x")).id).toBe("article");
  });

  it("the first matching extractor in the list wins (consumer order is respected)", () => {
    const a: Extractor = { ...chat, id: "a" };
    const b: Extractor = { ...chat, id: "b" };
    expect(pickExtractor(new URL("https://chatgpt.com/c/1"), [a, b]).id).toBe("a");
  });
});
