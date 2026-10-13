import { describe, expect, it } from "vitest";
import { renderHTML, renderDocHTML, safeUrl, fromMarkdown, toMarkdown } from "../src/server";

const SAMPLE = "# Nyhed\n\nHej **fed** og *kursiv* og [VN](https://vnleker.no).\n\n- en\n- to\n\n1. første\n2. anden\n\n> citat\n\n![Gyngehest](https://cdn.vnleker.no/hest.png)\n";

describe("F101.1 — /server: markdown → safe HTML with no browser", () => {
  it("renders the document deterministically (strict)", () => {
    const html = renderHTML(SAMPLE);
    expect(html).toBe(
      '<h1>Nyhed</h1><p>Hej <strong>fed</strong> og <em>kursiv</em> og <a href="https://vnleker.no" rel="noopener noreferrer">VN</a>.</p>' +
        "<ul><li><p>en</p></li><li><p>to</p></li></ul><ol><li><p>første</p></li><li><p>anden</p></li></ol>" +
        '<blockquote><p>citat</p></blockquote><img src="https://cdn.vnleker.no/hest.png" alt="Gyngehest">',
    );
    expect(renderHTML(SAMPLE)).toBe(html);
  });

  it("NEGATIVE CONTROL: raw HTML, a script, an onclick and javascript:/data: addresses never come out as markup", () => {
    const evil = '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[klik](javascript:alert(1))\n\n![x](data:image/png;base64,AAAA)\n\n[ok](JaVaScRiPt:alert(1))\n';
    const html = renderHTML(evil);
    expect(html).not.toMatch(/<script|<img src="x"|onerror="|href="javascript|href="JaVa|src="data:/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p><p>klik</p><p>ok</p>"); // link text survives, the address does not; the data: image is gone
  });

  it("safeUrl: http(s)/mailto/relative pass; javascript:, data:, vbscript:, protocol-relative and control-char tricks do not", () => {
    for (const ok of ["https://x.dk", "http://x.dk/a?b=1", "/nyheder/1", "hest.png", "#top"]) expect(safeUrl(ok, "image")).toBe(ok);
    expect(safeUrl("mailto:vn@vnleker.no", "link")).toBe("mailto:vn@vnleker.no");
    expect(safeUrl("mailto:vn@vnleker.no", "image")).toBeNull();
    for (const bad of ["javascript:alert(1)", " JAVASCRIPT:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "vbscript:x", "//evil.com/x.png", ""]) expect(safeUrl(bad, "link")).toBeNull();
  });

  it("an empty paragraph renders as nothing", () => {
    expect(renderDocHTML({ type: "doc", content: [{ type: "paragraph" }, { type: "paragraph", content: [{ type: "text", text: "a" }] }] })).toBe("<p>a</p>");
  });

  it("an unknown node is left out and reported — never passed through", () => {
    const seen: string[] = [];
    const html = renderDocHTML({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "iframe", attrs: { src: "https://evil" } }] }, { onUnknown: (t) => seen.push(t) });
    expect(html).toBe("<p>a</p>");
    expect(seen).toStrictEqual(["iframe"]);
  });

  it("markdown round trip keeps headings, bold/italic, lists, links and images (strict)", () => {
    expect(toMarkdown(fromMarkdown(SAMPLE))).toBe(SAMPLE.trimEnd());
  });
});
