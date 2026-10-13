# @broberg/editor

The fleet's shared WYSIWYG editor, on [TipTap](https://tiptap.dev) (ProseMirror). Epic F101.

- **The stored document is markdown.** You save a string; you render it on the server with `@broberg/editor/server`.
- **Framework-free core**, plus `/react` (Next.js-safe) and `/preact` built from ONE implementation.
- **Your design.** The reference toolbar is optional; `useEditor` + `useToolbarState` let you draw your own.
- **Images go through YOUR upload** (R2 via `@broberg/media`, …). The package never uploads anything itself.
- **Your own blocks** (a product from the shop, a video, …) with `defineBlock`, stored in the markdown so they survive a save.

```sh
npm i @broberg/editor
```

## React / Next.js

```tsx
"use client";
import { RichTextEditor } from "@broberg/editor/react";
import "@broberg/editor/css/editor.css"; // optional — on @broberg/theme tokens

<RichTextEditor
  docKey={news.id}                 // a NEW key loads another document (the editor is rebuilt)
  content={news.markdownDa}        // read when the editor is (re)built
  onChange={(md) => setDraft(md)}  // only on a real change — loading is not editing
  uploadImage={async (file) => ({ src: await uploadToR2(file), alt: file.name })}
  onError={(e) => toast(e.message)}
  placeholder="Skriv en nyhed…"
/>
```

The editor is created in an effect, never during render, so server rendering returns an empty container and hydration is clean (TipTap's `immediatelyRender: false`, by construction).

One document per language: give each its own `docKey` (`${id}:da`, `${id}:no`, …).

## Preact

Same API: `import { RichTextEditor, useEditor, useToolbarState, Toolbar } from "@broberg/editor/preact"`.

## Draw your own toolbar

```tsx
import { useEditor, useToolbarState, run, setLink } from "@broberg/editor/react";

const { editor, ref } = useEditor({ content, onChange });
const state = useToolbarState(editor);           // re-renders only when it changes
<button aria-pressed={state?.active.bold} onClick={() => editor && run(editor, "bold")}>B</button>
<div ref={ref} />
```

`run(editor, action)`: `bold · italic · strike · code · h1 · h2 · h3 · paragraph · bulletList · orderedList · blockquote · undo · redo`.
`setLink(editor, href | null)` adds `https://` to a bare domain and refuses `javascript:` / `data:`.

## Server: markdown → HTML

```ts
import { renderHTML } from "@broberg/editor/server";
const html = renderHTML(news.markdownDa, { blocks });   // Node / Bun, no browser
```

The HTML is BUILT from the document tree, not sanitized afterwards: only headings, paragraphs, lists, quotes, code, links, images and your blocks can come out; every text and attribute is escaped; a link or image address must be `http(s)`, `mailto` (links) or relative. Raw HTML typed into the markdown is shown as text. Links get `rel="noopener noreferrer"`.

`fromMarkdown(md)` / `toMarkdown(json)` convert to and from TipTap JSON when you need the tree.

## Images

`uploadImage(file) => Promise<{ src, alt? }>` is called from the toolbar's image button, from paste and from drag-and-drop. The image is inserted only AFTER your upload answered, with the address you returned — never a `blob:` URL that dies on reload. A failed upload leaves the document untouched and calls `onError`.

## Your own blocks

```ts
import { defineBlock, escapeHTML } from "@broberg/editor/server";

export const product = defineBlock({
  name: "product",                // lowercase; also the markdown keyword
  attrs: ["sku"],                 // anything else is dropped
  required: ["sku"],
  label: "Vare",
  renderHTML: (a) => `<a class="product" href="/varer/${encodeURIComponent(a.sku!)}">${escapeHTML(a.sku!)}</a>`,
});
export const blocks = [product];
```

Stored as `:::product {sku="VN-1234"} :::`. Pass the SAME `blocks` list to the editor (`blocks={blocks}`) and to `renderHTML`. In the editor it shows as a box with its label and values (as text); give `renderEditor(attrs) => HTMLElement` for your own preview. Insert it from code with `insertBlock(editor, product, { sku })`, or let the reference toolbar call your picker:

```tsx
<RichTextEditor blocks={blocks} blockPickers={{ product: () => openMyProductSearch() /* → { sku } | null */ }} />
```

`renderHTML` returns YOUR HTML as-is — escape what you interpolate.

## What it handles for you (cms' production traps, each a test)

1. SSR / Next.js: no editor on the server. 2. Toolbar state without a re-render per keystroke. 3. No false «changed» on load. 4. A new `docKey` never carries the previous document. 5. Word / Google Docs paste arrives without their styles. 6. Custom blocks have a markdown form. 7. No `blob:` URL in what is saved. Also: empty paragraphs are not stored (saved markdown == markdown on reload).

## Example

`examples/editor` (Bun, port 5204): upload, a product picker, Save, and `/preview` rendered on the server — driven end-to-end by Lens.
