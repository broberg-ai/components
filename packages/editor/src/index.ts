// @broberg/editor — F101. The fleet's shared WYSIWYG editor on TipTap.
//
// THE CORE IS FRAMEWORK-FREE: a TipTap Editor with the fleet's extensions, the
// document as MARKDOWN in and out, and the four things every consumer used to
// get wrong on their own (measured by cms in production, #3230):
//   1. onChange fires only when the markdown REALLY changed — loading content
//      never makes a form look dirty.
//   2. An image is inserted only AFTER your upload answered — never a blob: URL
//      that dies on reload. A failed upload leaves the document untouched.
//   3. Text pasted from Word / Google Docs arrives without their styles/classes.
//   4. Toolbar state is read on demand (toolbarState), not by re-rendering on
//      every keystroke.
// The design is yours: /react and /preact give hooks; no CSS is required.
import { Editor, type EditorOptions } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { Marked } from "marked";
import { Placeholder } from "@tiptap/extensions";
import { editorExtensions, type SchemaOptions } from "./schema";
import { safeUrl } from "./server";

export interface UploadedImage { src: string; alt?: string }

export interface EditorConfig extends SchemaOptions {
  /** The stored document (markdown). */
  content?: string;
  /** Called with the new markdown — only when it differs from the last value (never on load). */
  onChange?: (markdown: string) => void;
  /** YOUR upload (R2 via @broberg/media, …). The image is inserted with what this returns. */
  uploadImage?: (file: File) => Promise<UploadedImage>;
  /** A failed upload, a refused address — anything the person should be told. */
  onError?: (error: Error) => void;
  placeholder?: string;
  editable?: boolean;
}

export interface CreateEditorOptions extends EditorConfig {
  /** Where to mount. */
  element: HTMLElement;
}

const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

/** Word / Google Docs paste: keep the structure, drop their styling (cms paste-sanitizer, measured). */
export function sanitizePastedHTML(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(style|xml|script|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(meta|link)\b[^>]*>/gi, "")
    .replace(/<\/?o:[^>]*>/gi, "")
    .replace(/\s(style|class|lang|align|id|dir|data-[\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<\/?(font|span)\b[^>]*>/gi, "");
}

/**
 * The document as markdown. Trailing blank lines are dropped: TipTap keeps an
 * empty paragraph after a final image/list (so the caret has somewhere to go),
 * and that must not be stored — or every save after an image would differ.
 */
export function getMarkdown(editor: Editor): string {
  return editor.getMarkdown().replace(/\s+$/, "");
}

/** Per editor: the markdown onChange last reported (or what was loaded) — the dirty guard. */
const guards = new WeakMap<Editor, { last: string | null; created: boolean }>();

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}

/**
 * The TipTap options for the fleet's editor — what createEditor uses, and what
 * the React/Preact adapters pass to their own useEditor, so all three behave
 * the same. `getEditor` is how the paste/drop handlers reach the instance.
 */
export function editorOptions(c: EditorConfig, getEditor: () => Editor | null): Partial<EditorOptions> {
  const g = { last: null as string | null, created: false };
  const upload = async (files: File[], at?: number) => {
    const ed = getEditor();
    if (!ed || !c.uploadImage) return;
    for (const file of files) {
      try {
        const r = await c.uploadImage(file);
        const src = safeUrl(r?.src, "image");
        if (!src || src.startsWith("blob:")) throw new Error(`upload of «${file.name}» returned no usable address`);
        const node = { type: "image", attrs: { src, alt: r.alt ?? "" } };
        if (at == null) ed.chain().focus().insertContent(node).run();
        else ed.chain().focus().insertContentAt(at, node).run();
      } catch (e) {
        c.onError?.(asError(e));
      }
    }
  };
  return {
    extensions: [
      ...editorExtensions(c),
      // its own marked instance — see markdown.ts: blocks must not leak between editors on one page
      Markdown.configure({ marked: new Marked() as never }),
      ...(c.placeholder ? [Placeholder.configure({ placeholder: c.placeholder })] : []),
    ],
    content: c.content ?? "",
    contentType: "markdown",
    editable: c.editable ?? true,
    editorProps: {
      transformPastedHTML: sanitizePastedHTML,
      handlePaste(_view, event) {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length || !c.uploadImage) return false;
        event.preventDefault();
        void upload(files);
        return true;
      },
      handleDrop(view, event) {
        const files = imageFiles((event as DragEvent).dataTransfer?.files);
        if (!files.length || !c.uploadImage) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos;
        void upload(files, pos);
        return true;
      },
    },
    onBeforeCreate({ editor }) {
      guards.set(editor, g);
    },
    onCreate({ editor }) {
      markLoaded(editor);
    },
    onUpdate({ editor }) {
      const md = getMarkdown(editor);
      // TipTap's own setup (an empty paragraph after a final image) runs BEFORE onCreate and fires
      // an update — measured. Nobody can edit before the editor exists, so that is the loaded state.
      if (!g.created) {
        g.last = md;
        return;
      }
      if (md === g.last) return;
      g.last = md;
      c.onChange?.(md);
    },
  } as Partial<EditorOptions>;
}

/**
 * «What is loaded now is the clean state.» createEditor calls it right after construction (TipTap's
 * own onCreate comes a tick later, and an edit made before it must still count); an adapter that
 * builds the editor itself calls it once the instance exists. Calling it again is harmless.
 */
export function markLoaded(editor: Editor): void {
  const g = guards.get(editor);
  if (!g || g.created) return;
  g.created = true;
  g.last = getMarkdown(editor);
}

/** Insert an image through the consumer's upload (a file picker's File). Resolves true when inserted. */
export async function insertImage(editor: Editor, c: Pick<EditorConfig, "uploadImage" | "onError">, file: File): Promise<boolean> {
  if (!c.uploadImage) return false;
  try {
    const r = await c.uploadImage(file);
    const src = safeUrl(r?.src, "image");
    if (!src || src.startsWith("blob:")) throw new Error(`upload of «${file.name}» returned no usable address`);
    return editor.chain().focus().insertContent({ type: "image", attrs: { src, alt: r.alt ?? "" } }).run();
  } catch (e) {
    c.onError?.(asError(e));
    return false;
  }
}

/** Set (or with null/"" remove) the link on the selection. Refuses javascript:/data: addresses. */
export function setLink(editor: Editor, href: string | null): boolean {
  if (!href) return editor.chain().focus().extendMarkRange("link").unsetLink().run();
  const safe = safeUrl(/^[a-z][a-z0-9+.-]*:|^[/#.]/i.test(href) ? href : `https://${href}`, "link");
  if (!safe) return false;
  return editor.chain().focus().extendMarkRange("link").setLink({ href: safe }).run();
}

/** Replace the document WITHOUT firing onChange (loading is not editing). */
export function setMarkdown(editor: Editor, markdown: string): void {
  editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
  // keep the guard in step: the next REAL edit is compared against what was loaded
  const g = guards.get(editor);
  if (g) g.last = getMarkdown(editor);
}

export type ToolbarAction = "bold" | "italic" | "strike" | "code" | "h1" | "h2" | "h3" | "paragraph" | "bulletList" | "orderedList" | "blockquote" | "undo" | "redo";

export interface ToolbarState {
  active: Record<Exclude<ToolbarAction, "undo" | "redo">, boolean>;
  /** The link under the caret, or null. */
  link: string | null;
  can: { undo: boolean; redo: boolean };
}

/** What a toolbar shows — read it in your framework's editor-state selector, not on every render. */
export function toolbarState(editor: Editor): ToolbarState {
  const a = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs);
  return {
    active: {
      bold: a("bold"), italic: a("italic"), strike: a("strike"), code: a("code"),
      h1: a("heading", { level: 1 }), h2: a("heading", { level: 2 }), h3: a("heading", { level: 3 }),
      paragraph: a("paragraph"), bulletList: a("bulletList"), orderedList: a("orderedList"), blockquote: a("blockquote"),
    },
    link: a("link") ? ((editor.getAttributes("link").href as string | undefined) ?? null) : null,
    can: { undo: editor.can().undo(), redo: editor.can().redo() },
  };
}

/** Run one toolbar action. */
export function run(editor: Editor, action: ToolbarAction): boolean {
  const c = editor.chain().focus();
  switch (action) {
    case "bold": return c.toggleBold().run();
    case "italic": return c.toggleItalic().run();
    case "strike": return c.toggleStrike().run();
    case "code": return c.toggleCode().run();
    case "h1": return c.toggleHeading({ level: 1 }).run();
    case "h2": return c.toggleHeading({ level: 2 }).run();
    case "h3": return c.toggleHeading({ level: 3 }).run();
    case "paragraph": return c.setParagraph().run();
    case "bulletList": return c.toggleBulletList().run();
    case "orderedList": return c.toggleOrderedList().run();
    case "blockquote": return c.toggleBlockquote().run();
    case "undo": return c.undo().run();
    case "redo": return c.redo().run();
  }
}

/** A framework-free editor mounted on `element`. */
export function createEditor(o: CreateEditorOptions): Editor {
  let editor: Editor | null = null;
  editor = new Editor({ element: o.element, ...editorOptions(o, () => editor) });
  markLoaded(editor);
  return editor;
}

export { Editor } from "@tiptap/core";
export { editorExtensions, type SchemaOptions } from "./schema";
export { fromMarkdown, toMarkdown } from "./markdown";
export { safeUrl } from "./server";
export { defineBlock, insertBlock, escapeHTML, blockAttrs, type Block, type BlockDefinition } from "./blocks";
