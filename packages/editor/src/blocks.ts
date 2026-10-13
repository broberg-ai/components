// @broberg/editor — F101.2. Your own blocks: an element that is not text (a product from the shop,
// a video, a call-to-action) — one or more string attributes in the document, and YOU decide what it
// looks like in the editor and on the page.
//
// It is stored in the markdown as a Pandoc-style atom, so it survives a save (cms trap 6: «hver
// egen node skal have en markdown-serializer, ellers forsvinder den tavst ved save»):
//
//   :::product {sku="VN-1234"}
import { Node, createAtomBlockMarkdownSpec, type Editor } from "@tiptap/core";

export interface BlockDefinition {
  /** Node name, lowercase letters/digits/-: "product". Also the markdown keyword. */
  name: string;
  /** The attributes the block carries (strings). Anything else is dropped. */
  attrs: string[];
  /** Attributes that must be present; without them the markdown line is left as plain text. */
  required?: string[];
  /** Shown in the editor's default preview and to screen readers. */
  label: string;
  /**
   * The block on the PAGE (server-side renderHTML). YOUR HTML, inserted as you return it —
   * escape the attribute values you interpolate (use escapeHTML). Return "" to leave it out.
   */
  renderHTML(attrs: Record<string, string>): string;
  /** The block IN THE EDITOR. Default: a box with the label and the attribute values (as text). */
  renderEditor?(attrs: Record<string, string>): HTMLElement;
}

export interface Block extends BlockDefinition {
  extension: Node;
}

const NAME = /^[a-z][a-z0-9-]{0,40}$/;

export const escapeHTML = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Keep only the declared attributes, as strings. */
export function blockAttrs(def: Pick<BlockDefinition, "attrs">, input: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of def.attrs) {
    const v = input?.[k];
    if (typeof v === "string" && v !== "") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return out;
}

export function defineBlock(def: BlockDefinition): Block {
  if (!NAME.test(def.name)) throw new Error(`defineBlock: «${def.name}» must be lowercase letters, digits and -`);
  const spec = createAtomBlockMarkdownSpec({ nodeName: def.name, requiredAttributes: def.required ?? [], allowedAttributes: def.attrs });
  const extension = Node.create({
    name: def.name,
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return Object.fromEntries(
        def.attrs.map((k) => [k, { default: null, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${k}`), renderHTML: (a: Record<string, unknown>) => (a[k] == null ? {} : { [`data-${k}`]: String(a[k]) }) }]),
      );
    },
    parseHTML() {
      return [{ tag: `div[data-block="${def.name}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", { ...HTMLAttributes, "data-block": def.name }, def.label];
    },
    addNodeView() {
      return ({ node }) => {
        const attrs = blockAttrs(def, node.attrs);
        let dom: HTMLElement;
        if (def.renderEditor) dom = def.renderEditor(attrs);
        else {
          dom = document.createElement("div");
          const vals = Object.values(attrs).join(" · ");
          dom.textContent = vals ? `${def.label}: ${vals}` : def.label; // text, never HTML from the document
        }
        dom.setAttribute("data-block", def.name);
        dom.setAttribute("data-testid", `editor-block-${def.name}`);
        dom.setAttribute("contenteditable", "false");
        return { dom };
      };
    },
    ...spec,
  });
  return { ...def, extension };
}

/** Insert a block at the caret. Undeclared attributes are dropped; a missing required one refuses. */
export function insertBlock(editor: Editor, block: BlockDefinition, attrs: Record<string, unknown>): boolean {
  const clean = blockAttrs(block, attrs);
  if ((block.required ?? []).some((k) => !clean[k])) return false;
  return editor.chain().focus().insertContent({ type: block.name, attrs: clean }).run();
}
