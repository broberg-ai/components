// @broberg/editor/server — F101.1. Markdown (the stored document) → HTML for a
// page, in Node/Bun with no browser.
//
// SAFE BY CONSTRUCTION. This is not "render, then sanitize": the HTML is BUILT
// from the document tree, so only the elements below can ever come out, every
// text and attribute is escaped, and a link or image address must be http(s),
// mailto (links) or relative. Raw HTML typed into the markdown is text, never
// markup (cms: «SANITÉR HTML'en server-side før render»).
import type { JSONContent } from "@tiptap/core";
import { fromMarkdown } from "./markdown";
import type { SchemaOptions } from "./schema";

export interface RenderOptions extends SchemaOptions {
  /** Called for a node this renderer does not know (it is left out, never passed through). */
  onUnknown?: (type: string) => void;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** http(s), mailto (links only) or a relative address; anything else (javascript:, data:, …) is dropped. */
export function safeUrl(url: unknown, kind: "link" | "image"): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  if (!u) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(u.replace(/[\u0000-\u001f\s]/g, ""))?.[1]?.toLowerCase();
  if (!scheme) return u.startsWith("//") ? null : u; // relative ("/x", "x.png", "#a"); protocol-relative is refused
  if (scheme === "http" || scheme === "https") return u;
  if (scheme === "mailto" && kind === "link") return u;
  return null;
}

const attr = (name: string, value: string | null | undefined) => (value == null || value === "" ? "" : ` ${name}="${esc(value)}"`);

function marks(text: string, ms: JSONContent["marks"]): string {
  let out = esc(text);
  for (const m of ms ?? []) {
    if (m.type === "bold") out = `<strong>${out}</strong>`;
    else if (m.type === "italic") out = `<em>${out}</em>`;
    else if (m.type === "strike") out = `<s>${out}</s>`;
    else if (m.type === "underline") out = `<u>${out}</u>`;
    else if (m.type === "code") out = `<code>${out}</code>`;
    else if (m.type === "link") {
      const href = safeUrl(m.attrs?.href, "link");
      if (href) out = `<a href="${esc(href)}" rel="noopener noreferrer"${attr("title", m.attrs?.title as string)}>${out}</a>`;
    }
  }
  return out;
}

function node(n: JSONContent, o: RenderOptions): string {
  const kids = () => (n.content ?? []).map((c) => node(c, o)).join("");
  switch (n.type) {
    case "doc": return kids();
    case "text": return marks(n.text ?? "", n.marks);
    case "paragraph": return `<p>${kids()}</p>`;
    case "heading": {
      const l = Math.min(6, Math.max(1, Number(n.attrs?.level) || 1));
      return `<h${l}>${kids()}</h${l}>`;
    }
    case "blockquote": return `<blockquote>${kids()}</blockquote>`;
    case "bulletList": return `<ul>${kids()}</ul>`;
    case "orderedList": {
      const start = Number(n.attrs?.start);
      return `<ol${Number.isInteger(start) && start !== 1 ? ` start="${start}"` : ""}>${kids()}</ol>`;
    }
    case "listItem": return `<li>${kids()}</li>`;
    case "codeBlock": {
      const lang = typeof n.attrs?.language === "string" && /^[\w+-]+$/.test(n.attrs.language) ? ` class="language-${n.attrs.language}"` : "";
      return `<pre><code${lang}>${(n.content ?? []).map((c) => esc(c.text ?? "")).join("")}</code></pre>`;
    }
    case "horizontalRule": return "<hr>";
    case "hardBreak": return "<br>";
    case "image": {
      const src = safeUrl(n.attrs?.src, "image");
      // alt is always present (empty = decorative), so a screen reader never reads the file name.
      return src ? `<img src="${esc(src)}" alt="${esc(typeof n.attrs?.alt === "string" ? n.attrs.alt : "")}"${attr("title", n.attrs?.title as string)}>` : "";
    }
    default:
      o.onUnknown?.(String(n.type));
      return "";
  }
}

/** Render a TipTap JSON document to safe HTML. */
export function renderDocHTML(doc: JSONContent, o: RenderOptions = {}): string {
  return node(doc, o);
}

/** Render stored markdown to safe HTML (Node/Bun, no DOM). */
export function renderHTML(markdown: string, o: RenderOptions = {}): string {
  return renderDocHTML(fromMarkdown(markdown, o), o);
}

export { fromMarkdown, toMarkdown } from "./markdown";
