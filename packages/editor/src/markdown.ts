// F101.1 — markdown is the document format (vn-leker, cms: «vælg ét format og hold det»).
// TipTap's own MarkdownManager over the SAME extensions, so it runs in Node with no DOM.
import { MarkdownManager } from "@tiptap/markdown";
import type { JSONContent } from "@tiptap/core";
import { editorExtensions, type SchemaOptions } from "./schema";

const managers = new WeakMap<object, MarkdownManager>();
const DEFAULT = {};

function manager(o: SchemaOptions = {}): MarkdownManager {
  const key = o.extensions ? (o.extensions as object) : DEFAULT;
  let m = managers.get(key);
  if (!m) managers.set(key, (m = new MarkdownManager({ extensions: editorExtensions(o) })));
  return m;
}

/** Markdown → TipTap JSON. Raw HTML in the markdown becomes text, never markup. */
export function fromMarkdown(markdown: string, o?: SchemaOptions): JSONContent {
  return manager(o).parse(markdown);
}

/** TipTap JSON → markdown. */
export function toMarkdown(doc: JSONContent, o?: SchemaOptions): string {
  return manager(o).serialize(doc);
}
