// @vitest-environment happy-dom
import { afterEach, describe, it } from "vitest";
import { h } from "preact";
import { render, fireEvent, cleanup, act } from "@testing-library/preact";
import { RichTextEditor } from "../src/preact";
import * as C from "./adapter-cases";

afterEach(() => cleanup());
const harness: C.Harness = {
  render(props) {
    const r = render(h(RichTextEditor, props as never));
    return { rerender: (p) => r.rerender(h(RichTextEditor, p as never)), unmount: r.unmount };
  },
  click: (el) => fireEvent.click(el),
  input: (el, value) => fireEvent.input(el, { target: { value } }),
  change: (el, files) => { Object.defineProperty(el, "files", { value: files, configurable: true }); fireEvent.change(el); },
  act: async (fn) => { await act(fn as never); },
};

describe("F101.3 — /preact", () => {
  it("toolbar formats and reports markdown; mounting is not editing", () => C.caseToolbarFormats(harness));
  it("link popover: refuses javascript:, adds https:// to a bare domain (no window.prompt)", () => C.caseLinkPopover(harness));
  it("image upload: busy feedback while it runs, then the returned address", () => C.caseImageUpload(harness));
  it("a failed upload is shown and leaves the document unchanged", () => C.caseUploadError(harness));
  it("a new docKey rebuilds the editor with the new document (cms trap 4)", () => C.caseDocKeyRemount(harness));
});
