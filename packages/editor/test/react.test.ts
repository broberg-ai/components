// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { RichTextEditor, useEditor, useToolbarState } from "../src/react";
import * as C from "./adapter-cases";
import { getMarkdown } from "../src/index";

afterEach(() => cleanup());
const harness: C.Harness = {
  render(props) {
    const r = render(createElement(RichTextEditor, props as never));
    return { rerender: (p) => r.rerender(createElement(RichTextEditor, p as never)), unmount: r.unmount };
  },
  click: (el) => fireEvent.click(el),
  input: (el, value) => fireEvent.change(el, { target: { value } }),
  change: (el, files) => { Object.defineProperty(el, "files", { value: files, configurable: true }); fireEvent.change(el); },
  act: async (fn) => { await act(fn as never); },
};

describe("F101.3 — /react", () => {
  it("server rendering (Next.js) does not create an editor and does not throw (cms trap 1)", () => {
    const html = renderToString(createElement(RichTextEditor, { content: "# Hej" }));
    expect(html).toContain('data-testid="editor-root"');
    expect(html).toContain('data-testid="editor-content"');
    expect(html).not.toContain("ProseMirror");
  });
  it("useToolbarState re-renders only when the toolbar state CHANGES, not per keystroke (cms trap 2)", async () => {
    let renders = 0;
    function Probe() {
      const { editor, ref } = useEditor({ content: "Hej" });
      useToolbarState(editor);
      renders++;
      return createElement("div", { ref });
    }
    render(createElement(Probe));
    await C.ready();
    const ed = C.editorOf()!;
    await act(async () => { ed.commands.focus("end"); });
    const before = renders;
    for (const ch of "abcdefghij") await act(async () => { ed.commands.insertContent({ type: "text", text: ch }); });
    expect(getMarkdown(ed)).toBe("Hejabcdefghij");
    expect(renders - before).toBeLessThanOrEqual(1); // undo became possible: at most one change
  });
  it("toolbar formats and reports markdown; mounting is not editing", () => C.caseToolbarFormats(harness));
  it("link popover: refuses javascript:, adds https:// to a bare domain (no window.prompt)", () => C.caseLinkPopover(harness));
  it("image upload: busy feedback while it runs, then the returned address", () => C.caseImageUpload(harness));
  it("a failed upload is shown and leaves the document unchanged", () => C.caseUploadError(harness));
  it("a new docKey rebuilds the editor with the new document (cms trap 4)", () => C.caseDocKeyRemount(harness));
});
