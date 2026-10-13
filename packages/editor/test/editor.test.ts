// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, getMarkdown, insertImage, run, sanitizePastedHTML, setLink, setMarkdown, toolbarState, type Editor } from "../src/index";

let ed: Editor | null = null;
afterEach(() => { ed?.destroy(); ed = null; document.body.innerHTML = ""; });
const mount = (o: Parameters<typeof createEditor>[0] extends infer T ? Omit<T & object, "element"> : never) => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  ed = createEditor({ element, ...o });
  return ed;
};
const file = (name = "hest.png") => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

describe("F101.1 — createEditor: markdown in, markdown out", () => {
  it("loads markdown and gives it back unchanged; loading is NOT a change (cms trap 3)", () => {
    const onChange = vi.fn();
    const e = mount({ content: "# Titel\n\nHej **fed**", onChange });
    expect(getMarkdown(e)).toBe("# Titel\n\nHej **fed**");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("loading a document that ends in an image (TipTap appends an empty paragraph) is still not a change", async () => {
    const onChange = vi.fn();
    const e = mount({ content: "Tekst\n\n![Hest](https://cdn.vnleker.no/hest.png)", onChange });
    e.commands.focus("end");
    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).not.toHaveBeenCalled();
    expect(getMarkdown(e)).toBe("Tekst\n\n![Hest](https://cdn.vnleker.no/hest.png)");
  });

  it("an edit fires onChange with the new markdown, once per real change", () => {
    const onChange = vi.fn();
    const e = mount({ content: "Hej", onChange });
    e.commands.insertContentAt(4, { type: "text", text: " verden" });
    expect(onChange).toHaveBeenLastCalledWith("Hej verden");
    const calls = onChange.mock.calls.length;
    e.commands.setTextSelection(1); // moving the caret is not an edit
    expect(onChange.mock.calls.length).toBe(calls);
  });

  it("setMarkdown replaces the document WITHOUT onChange, and the next real edit is compared against it", () => {
    const onChange = vi.fn();
    const e = mount({ content: "A", onChange });
    setMarkdown(e, "B");
    expect(getMarkdown(e)).toBe("B");
    expect(onChange).not.toHaveBeenCalled();
    e.commands.insertContentAt(2, { type: "text", text: "C" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("BC");
  });

  it("toolbar: run + toolbarState agree (bold, heading, lists, undo)", () => {
    const e = mount({ content: "Hej" });
    e.commands.selectAll();
    expect(toolbarState(e).active.bold).toBe(false);
    run(e, "bold");
    expect(toolbarState(e).active.bold).toBe(true);
    expect(getMarkdown(e)).toBe("**Hej**");
    run(e, "h2");
    expect(getMarkdown(e)).toBe("## **Hej**");
    e.commands.setTextSelection(2); // a caret, as in real use (isActive on a select-all is not a caret)
    expect(toolbarState(e).active.h2).toBe(true);
    expect(toolbarState(e).active.h1).toBe(false);
    run(e, "bulletList");
    expect(getMarkdown(e)).toBe("- **Hej**"); // a list item holds paragraphs, so the heading becomes one
    expect(toolbarState(e).can.undo).toBe(true);
  });

  it("links: setLink adds https:// to a bare domain; javascript: is refused", () => {
    const e = mount({ content: "VN" });
    e.commands.selectAll();
    expect(setLink(e, "vnleker.no")).toBe(true);
    expect(getMarkdown(e)).toBe("[VN](https://vnleker.no)");
    expect(toolbarState(e).link).toBe("https://vnleker.no");
    expect(setLink(e, "javascript:alert(1)")).toBe(false);
    expect(getMarkdown(e)).toBe("[VN](https://vnleker.no)");
    expect(setLink(e, null)).toBe(true);
    expect(getMarkdown(e)).toBe("VN");
  });
});

describe("F101.1 — images go through YOUR upload, and only a real address is ever stored (cms trap 7)", () => {
  it("insertImage: the address your upload returns is inserted", async () => {
    const uploadImage = vi.fn(async (f: File) => ({ src: `https://cdn.vnleker.no/${f.name}`, alt: "Gyngehest" }));
    const e = mount({ content: "", uploadImage });
    expect(await insertImage(e, { uploadImage }, file())).toBe(true);
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(getMarkdown(e)).toBe("![Gyngehest](https://cdn.vnleker.no/hest.png)");
  });

  it("NEGATIVE CONTROL: a failed upload leaves the document untouched and says why; a blob: answer is refused", async () => {
    const onError = vi.fn();
    const e = mount({ content: "Tekst", onError });
    expect(await insertImage(e, { uploadImage: async () => { throw new Error("R2 nede"); }, onError }, file())).toBe(false);
    expect(await insertImage(e, { uploadImage: async () => ({ src: "blob:https://x/123" }), onError }, file())).toBe(false);
    expect(getMarkdown(e)).toBe("Tekst");
    expect(onError.mock.calls.map((c) => (c[0] as Error).message)).toStrictEqual(["R2 nede", "upload of «hest.png» returned no usable address"]);
  });

  it("pasting an image file uploads it; pasting with no upload configured falls through to TipTap", async () => {
    const uploadImage = vi.fn(async () => ({ src: "https://cdn.vnleker.no/p.png" }));
    const e = mount({ content: "", uploadImage });
    const event = { clipboardData: { files: [file("p.png")], getData: () => "" }, preventDefault: vi.fn() } as unknown as ClipboardEvent;
    const handled = e.view.someProp("handlePaste", (f) => f(e.view, event, e.state.selection.content()));
    expect(handled).toBe(true);
    await vi.waitFor(() => expect(getMarkdown(e)).toBe("![](https://cdn.vnleker.no/p.png)"));

    const plain = mount({ content: "" });
    const handled2 = plain.view.someProp("handlePaste", (f) => f(plain.view, event, plain.state.selection.content()));
    expect(handled2).toBeFalsy();
  });
});

describe("F101.1 — drag-and-drop of an image file", () => {
  it("dropping an image uploads it and inserts the returned address; dropping non-images is left to TipTap", async () => {
    const uploadImage = vi.fn(async () => ({ src: "https://cdn.vnleker.no/d.png", alt: "Drop" }));
    const e = mount({ content: "Tekst", uploadImage });
    const drop = (files: File[]) => ({ dataTransfer: { files, getData: () => "" }, clientX: 0, clientY: 0, preventDefault: vi.fn() }) as unknown as DragEvent;
    const handled = e.view.someProp("handleDrop", (f) => f(e.view, drop([file("d.png")]), e.state.selection.content(), false));
    expect(handled).toBe(true);
    await vi.waitFor(() => expect(getMarkdown(e)).toContain("![Drop](https://cdn.vnleker.no/d.png)"));
    const txt = new File(["x"], "a.txt", { type: "text/plain" });
    const handled2 = e.view.someProp("handleDrop", (f) => f(e.view, drop([txt]), e.state.selection.content(), false));
    expect(handled2).toBeFalsy();
    expect(uploadImage).toHaveBeenCalledTimes(1);
  });
});

describe("F101.1 — paste from Word / Google Docs (cms trap 5)", () => {
  it("drops styles, classes, mso tags and comments; keeps structure", () => {
    const word = '<!--[if gte mso 9]><xml>x</xml><![endif]--><style>p{color:red}</style><p class="MsoNormal" style="margin:0"><span style="font-family:Calibri"><b>Fed</b> tekst</span><o:p></o:p></p>';
    expect(sanitizePastedHTML(word)).toBe("<p><b>Fed</b> tekst</p>");
  });
});
