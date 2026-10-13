// Shared adapter cases — run against BOTH /react and /preact so the two cannot drift.
import { expect, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { getMarkdown } from "../src/index";

export interface Harness {
  render(props: Record<string, unknown>): { rerender(props: Record<string, unknown>): void; unmount(): void };
  click(el: Element): void;
  input(el: Element, value: string): void;
  change(el: Element, files: File[]): void;
  act(fn: () => void | Promise<void>): Promise<void>;
}

export const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
export const editorOf = () => (document.querySelector(".ProseMirror") as unknown as { editor?: Editor } | null)?.editor ?? null;
export const ready = async () => vi.waitFor(() => expect(editorOf()).not.toBeNull());

export async function caseToolbarFormats(t: Harness) {
  const onChange = vi.fn();
  t.render({ content: "Hej", onChange });
  await ready();
  expect(onChange).not.toHaveBeenCalled(); // mounting is not editing
  const ed = editorOf()!;
  await t.act(() => { ed.commands.selectAll(); });
  t.click(q("editor-toolbar-bold")!);
  await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith("**Hej**"));
  await vi.waitFor(() => expect(q("editor-toolbar-bold")!.getAttribute("aria-pressed")).toBe("true"));
  expect(q("editor-toolbar-undo")!.hasAttribute("disabled")).toBe(false);
}

export async function caseLinkPopover(t: Harness) {
  const onChange = vi.fn();
  t.render({ content: "VN", onChange });
  await ready();
  await t.act(() => { editorOf()!.commands.selectAll(); });
  t.click(q("editor-toolbar-link")!);
  await vi.waitFor(() => expect(q("editor-link-popover")).not.toBeNull());
  t.input(q("editor-link-input")!, "javascript:alert(1)");
  t.click(q("editor-link-apply")!);
  await vi.waitFor(() => expect(q("editor-toolbar-error")?.textContent).toBe("Det er ikke et gyldigt link"));
  expect(getMarkdown(editorOf()!)).toBe("VN");
  t.input(q("editor-link-input")!, "vnleker.no");
  t.click(q("editor-link-apply")!);
  await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith("[VN](https://vnleker.no)"));
  expect(q("editor-link-popover")).toBeNull();
}

export async function caseImageUpload(t: Harness) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const uploadImage = vi.fn(async (f: File) => { await gate; return { src: `https://cdn.vnleker.no/${f.name}`, alt: "Hest" }; });
  const onChange = vi.fn();
  t.render({ content: "", onChange, uploadImage });
  await ready();
  t.change(q("editor-image-input")!, [new File([new Uint8Array([1])], "hest.png", { type: "image/png" })]);
  // feedback while the upload runs: busy button + status text
  await vi.waitFor(() => expect(q("editor-uploading")?.textContent).toBe("Uploader billede…"));
  expect(q("editor-toolbar-image")!.hasAttribute("disabled")).toBe(true);
  await t.act(async () => { release(); await gate; });
  await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith("![Hest](https://cdn.vnleker.no/hest.png)"));
  await vi.waitFor(() => expect(q("editor-uploading")).toBeNull());
}

export async function caseUploadError(t: Harness) {
  const onError = vi.fn();
  t.render({ content: "Tekst", uploadImage: async () => { throw new Error("R2 svarer ikke"); }, onError });
  await ready();
  t.change(q("editor-image-input")!, [new File([new Uint8Array([1])], "x.png", { type: "image/png" })]);
  await vi.waitFor(() => expect(q("editor-toolbar-error")?.textContent).toBe("R2 svarer ikke"));
  expect(onError).toHaveBeenCalledTimes(1);
  expect(getMarkdown(editorOf()!)).toBe("Tekst");
}

export async function caseDocKeyRemount(t: Harness) {
  const onChange = vi.fn();
  const r = t.render({ docKey: "a", content: "Dokument A", onChange });
  await ready();
  const first = editorOf();
  r.rerender({ docKey: "b", content: "Dokument B", onChange });
  await vi.waitFor(() => expect(editorOf() && getMarkdown(editorOf()!)).toBe("Dokument B"));
  expect(editorOf()).not.toBe(first);
  expect(onChange).not.toHaveBeenCalled();
  // same key + new content prop does NOT reload (the editor owns the document while it is open)
  r.rerender({ docKey: "b", content: "IGNORERET", onChange });
  await new Promise((res) => setTimeout(res, 10));
  expect(getMarkdown(editorOf()!)).toBe("Dokument B");
}
