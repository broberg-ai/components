// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createEditor, defineBlock, getMarkdown, insertBlock, escapeHTML, type Editor } from "../src/index";
import { renderHTML, renderDocHTML, fromMarkdown, toMarkdown } from "../src/server";

const product = defineBlock({
  name: "product",
  attrs: ["sku", "variant"],
  required: ["sku"],
  label: "Vare",
  renderHTML: (a) => `<a class="product" href="/varer/${encodeURIComponent(a.sku!)}">Vare ${escapeHTML(a.sku!)}${a.variant ? ` (${escapeHTML(a.variant)})` : ""}</a>`,
});
const blocks = [product];

let ed: Editor | null = null;
afterEach(() => { ed?.destroy(); ed = null; document.body.innerHTML = ""; });
const mount = (content: string) => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return (ed = createEditor({ element, content, blocks }));
};

describe("F101.2 — defineBlock: your own element, stored in the markdown, rendered by you", () => {
  it("insertBlock puts a product in the document; it is saved as a markdown atom and loads back identically (cms trap 6)", () => {
    const e = mount("Nyhed");
    e.commands.focus("end");
    expect(insertBlock(e, product, { sku: "VN-1234", variant: "rød" })).toBe(true);
    const md = getMarkdown(e);
    expect(md).toBe('Nyhed\n\n:::product {sku="VN-1234" variant="rød"} :::');
    // a fresh editor on the saved markdown holds the same block
    ed!.destroy();
    const again = mount(md);
    expect(getMarkdown(again)).toBe(md);
    expect(JSON.stringify(again.getJSON().content?.[1])).toBe(JSON.stringify({ type: "product", attrs: { sku: "VN-1234", variant: "rød" } }));
    // the editor shows the default preview as TEXT
    expect(document.querySelector('[data-testid="editor-block-product"]')?.textContent).toBe("Vare: VN-1234 · rød");
  });

  it("the server renders the block with the consumer's renderHTML; markdown round trip is exact", () => {
    const md = 'Se her:\n\n:::product {sku="VN-1234"} :::';
    expect(renderHTML(md, { blocks })).toBe('<p>Se her:</p><a class="product" href="/varer/VN-1234">Vare VN-1234</a>');
    expect(toMarkdown(fromMarkdown(md, { blocks }), { blocks })).toBe(md);
  });

  it("undeclared attributes are dropped, a missing required one refuses the insert", () => {
    const e = mount("");
    expect(insertBlock(e, product, { variant: "blå" })).toBe(false);
    expect(insertBlock(e, product, { sku: "A1", onclick: "alert(1)", price: "9" })).toBe(true);
    expect(getMarkdown(e)).toBe(':::product {sku="A1"} :::');
  });

  it("an attribute value with quotes/HTML reaches renderHTML raw and the consumer's escapeHTML keeps the page safe", () => {
    const html = renderDocHTML({ type: "doc", content: [{ type: "product", attrs: { sku: '"><script>x</script>' } }] }, { blocks });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("NEGATIVE CONTROL: without the block registered nothing throws — the markdown stays as visible text, a JSON node is left out and reported", () => {
    const md = ':::product {sku="VN-1"} :::';
    expect(renderHTML(md)).toBe('<p>:::product {sku=&quot;VN-1&quot;} :::</p>');
    const seen: string[] = [];
    expect(renderDocHTML({ type: "doc", content: [{ type: "product", attrs: { sku: "VN-1" } }] }, { onUnknown: (t) => seen.push(t) })).toBe("");
    expect(seen).toStrictEqual(["product"]);
  });

  it("the editor preview shows attribute values as TEXT — HTML in a value is never markup in the editor", () => {
    const e = mount("");
    insertBlock(e, product, { sku: '<img src=x onerror="alert(1)">' });
    const box = document.querySelector('[data-testid="editor-block-product"]')!;
    expect(box.querySelector("img")).toBeNull();
    expect(box.textContent).toBe('Vare: <img src=x onerror="alert(1)">');
  });

  it("defineBlock refuses a name that cannot be a markdown keyword", () => {
    expect(() => defineBlock({ name: "Vare Kort", attrs: [], label: "x", renderHTML: () => "" })).toThrow(/lowercase/);
  });
});
