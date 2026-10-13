// @broberg/editor — F101.1. The ONE list of extensions, shared by the editor in
// the browser and by markdown/HTML on the server, so what can be written and
// what can be rendered can never drift apart.
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import type { AnyExtension } from "@tiptap/core";

export interface SchemaOptions {
  /** Extra extensions (custom blocks, F101.2) — added to BOTH sides. */
  extensions?: AnyExtension[];
}

export function editorExtensions(o: SchemaOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // A click in the editor places the caret; it does not leave the page.
      link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["http", "https", "mailto"] },
    }),
    Image.configure({ inline: false, allowBase64: false }),
    ...(o.extensions ?? []),
  ];
}
