// F101.1 — markdown is the document format (vn-leker, cms: «vælg ét format og hold det»).
// TipTap's own MarkdownManager over the SAME extensions, so it runs in Node with no DOM.
import { MarkdownManager } from "@tiptap/markdown";
import { Marked } from "marked";
import type { JSONContent } from "@tiptap/core";
import { editorExtensions, type SchemaOptions } from "./schema";

// One parser per distinct (blocks, extensions) pair — keyed on the arrays themselves, so pass the same list.
const managers = new WeakMap<object, WeakMap<object, MarkdownManager>>();
const NONE: object[] = [];

function manager(o: SchemaOptions = {}): MarkdownManager {
  const a = (o.blocks ?? NONE) as object, b = (o.extensions ?? NONE) as object;
  let inner = managers.get(a);
  if (!inner) managers.set(a, (inner = new WeakMap()));
  let m = inner.get(b);
  // Its OWN marked instance: TipTap otherwise registers every block's tokenizer on the one global
  // marked, so a block defined for one editor leaks into every other parser — measured: an
  // unregistered «:::product» then vanished from the page instead of staying as text.
  if (!m) inner.set(b, (m = new MarkdownManager({ marked: new Marked() as never, extensions: editorExtensions(o) })));
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
