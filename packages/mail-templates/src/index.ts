// F040.2 — @broberg/mail-templates: the ENGINE behind a mail template.
//
// Extracted from cardmem F298 (packages/shared/src/mail-template.ts, mail-render.ts,
// mail-classes.ts), which aggregated four projects' MEASUREMENTS — fd-sundhed,
// sanne, vn-leker, trail. Every rule below is here because someone paid for it in
// production; the comments keep the reason, so a later "simplification" can see
// what it would undo.
//
// What this package owns: the template SHAPE (blocks + brand), the one correct
// render order, placeholder filling, the per-tenant override over a coded default,
// and the content hash a host versions on. What it does NOT own: storage (the host
// keeps versions and overrides), the shell (@broberg/mail-core) and sending
// (@broberg/mail).

import { z } from "zod";

// ─────────────────────────────────────────────────────────────── escaping

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape text for HTML. Covers quotes too, so the same function is safe in an attribute. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Escape an attribute value. Same job as escapeHtml here; named so a call site says which it means. */
export function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// ─────────────────────────────────────────────────────────────── the shape

/** A body BLOCK. The template supplies structure; the shell supplies markup.
 *
 *  vn-leker, reviewing their own v1: a body field that takes `<p class style>`
 *  works while one person writes both halves — a foreign filler either loses all
 *  formatting (plain text) or breaks the layout (HTML). */
export const MailBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string() }),
  z.object({ type: z.literal("heading"), text: z.string() }),
  /** The note box with a coloured left edge. */
  z.object({ type: z.literal("note"), text: z.string() }),
  z.object({ type: z.literal("button"), text: z.string(), url: z.string() }),
  z.object({ type: z.literal("divider") }),
  /** A slot for PRE-RENDERED html (a letter body with headings and lists) — the
   *  only block that does not escape. Deliberately narrow: a value filling it is
   *  still escaped unless the caller lists its key in rawValueKeys, so a template
   *  author cannot make a plain value raw by choosing this block. */
  z.object({ type: z.literal("html"), text: z.string() }),
]);
export type MailBlock = z.infer<typeof MailBlock>;

/** A brand COLOUR — REFUSED, not escaped, when it is not one.
 *
 *  Proved against the built shell: an accent colour of
 *  `#fff;"></td></tr></table><a href="https://phish.example">Log ind her</a>…`
 *  put that anchor into the mail. An escaped non-colour still leaves the building
 *  as a broken mail nobody sees an error for; a refusal is an error the project
 *  reads while it still has the file open. */
export function isBrandColor(v: string): boolean {
  const s = v.trim();
  if (!s || s.length > 32) return false;
  if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/.test(s)) return true;
  // digits, commas, dots, spaces, % only — nothing that can close an attribute
  if (/^(rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/]+\)$/.test(s)) return true;
  // a CSS colour name: letters only (`rebeccapurple` is real)
  return /^[a-zA-Z]{3,20}$/.test(s);
}

/** A font STACK may hold quotes and commas, never a tag delimiter or a quote that closes its attribute. */
export function isFontStack(v: string): boolean {
  return v.trim().length > 0 && v.length <= 200 && !/[<>"`;{}]/.test(v);
}

/** Ceilings on what a stored override may hold — far above any real template, low
 *  enough that a hostile body costs one issue, not one per element. */
export const MAX_BLOCKS = 100;
export const MAX_FOOTER_LINES = 20;
export const MAX_COPY_KEYS = 200;

const brandColor = z
  .string()
  .refine(isBrandColor, { message: "not a colour: use #rrggbb, rgb()/hsl(), or a CSS colour name" })
  .optional();
const brandFontStack = z
  .string()
  .refine(isFontStack, { message: "not a font stack: use single quotes for family names, e.g. 'DM Sans',Arial,sans-serif" })
  .optional();

/** Brand values, ALL optional — and EMPTY is a value, not an absence (fd-sundhed
 *  renders different, correct copy for an empty partner name). */
export const MailBrand = z
  .object({
    partner: z.string().optional(),
    senderName: z.string().optional(),
    senderTitle: z.string().optional(),
    senderEmail: z.string().optional(),
    /** Both delivery forms: a hosted URL works from any sender; a CID only if the
     *  sender attaches the bytes with that Content-ID (sanne shipped a broken logo twice). */
    logoUrl: z.string().optional(),
    /** px. Outlook ignores CSS dimensions on an image; only the HTML attribute holds. */
    logoWidth: z.number().int().positive().max(600).optional(),
    logoCid: z.string().optional(),
    colorAccent: brandColor,
    colorInk: brandColor,
    fontSans: brandFontStack,
    fontSerif: brandFontStack,
    webfontHref: z.string().optional(),
    footerLines: z.array(z.string()).max(MAX_FOOTER_LINES).optional(),
  })
  .passthrough();
export type MailBrand = z.infer<typeof MailBrand>;

/** Greeting, sign-off and other fixed phrases are DATA, per language (vn-leker runs da/no/sv). */
// A record has no .max(): count the keys BEFORE zod walks them, or 200k bad keys
// cost 200k issues (GHSA-mrhx-c7xc-m3w5 / buddy #4342).
export const MailCopy = z
  .unknown()
  .refine((v) => v === null || typeof v !== "object" || Object.keys(v).length <= MAX_COPY_KEYS, {
    message: `at most ${MAX_COPY_KEYS} phrases`,
  })
  .pipe(z.record(z.string(), z.string()));
export type MailCopy = z.infer<typeof MailCopy>;

/** One template, keyed on its PURPOSE (fd-sport's model: a project has a set, not one file). */
export const MailTemplate = z.object({
  purpose: z.string().min(1),
  subject: z.string().min(1),
  blocks: z.array(MailBlock).min(1).max(MAX_BLOCKS),
  /** Required-or-derived, never silently empty — see derivePreheader. */
  preheader: z.string().optional(),
  brand: MailBrand.optional(),
  copy: MailCopy.optional(),
});
export type MailTemplate = z.infer<typeof MailTemplate>;

/** What a tenant stores to change a coded default. Every field optional; `purpose` is the key, not a field. */
export const MailTemplateOverride = z.object({
  subject: z.string().min(1).optional(),
  blocks: z.array(MailBlock).min(1).max(MAX_BLOCKS).optional(),
  preheader: z.string().optional(),
  brand: MailBrand.optional(),
  copy: MailCopy.optional(),
});
export type MailTemplateOverride = z.infer<typeof MailTemplateOverride>;

/** The class vocabulary the shell styles — SMALL AND CLOSED. fd-sundhed's dark-mode
 *  rules target classes IN the content, so the hooks have to be agreed names. */
export const MAIL_CLASSES = {
  bg: "cm-bg",
  card: "cm-card",
  p: "cm-p",
  sm: "cm-sm",
  btn: "cm-btn",
  box: "cm-box",
} as const;

// ─────────────────────────────────────────────────────────────── small rules

/** The preheader, DERIVED when not given: the first paragraph or heading, cut on a
 *  word. Omitted, the inbox shows whatever words fall first (vn-leker #6). */
export function derivePreheader(blocks: MailBlock[], given?: string): string {
  const explicit = (given ?? "").trim();
  if (explicit) return explicit;
  const first = blocks.find((b) => b.type === "paragraph" || b.type === "heading");
  const text = first && "text" in first ? first.text.trim() : "";
  if (text.length <= 120) return text;
  return `${text.slice(0, 117).replace(/\s+\S*$/, "")}…`;
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** A link in a mail must be ABSOLUTE — `/da/shop/bog` has no page to resolve
 *  against (sanne's customer). Returns the reason so a refusal can NAME the link.
 *
 *  `filled: true` at render time: a url that is EXACTLY one `{{token}}` is accepted
 *  when a template is authored (it must not have to know the host's routes) and
 *  refused once filling has happened, because a surviving token is a dead button. */
export function checkUrl(url: string, opts?: { filled?: boolean }): { ok: true } | { ok: false; reason: string } {
  const u = url.trim();
  if (!u) return { ok: false, reason: "empty url" };
  if (opts?.filled && /\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/.test(u))
    return { ok: false, reason: `link still contains an unfilled placeholder "${u}" — the button would be dead, so it is shown as plain text instead` };
  if (/^\{\{\s*[a-zA-Z0-9_.]+\s*\}\}$/.test(u)) return { ok: true };
  if (/^https?:\/\//i.test(u)) return { ok: true };
  if (/^mailto:/i.test(u)) return { ok: true };
  if (u.startsWith("/"))
    return { ok: false, reason: `relative link "${u}" — a mail has no page to resolve it against. Use an absolute https:// URL.` };
  return { ok: false, reason: `unsupported link "${u}" — use https:// or mailto:` };
}

// ─────────────────────────────────────────────────────────────── rendering

/** The @broberg/mail-core primitives the body needs, INJECTED.
 *
 *  mail-core reads files at module scope (node:fs, for the logo attachment), so
 *  importing it here would break every browser bundle that renders a preview —
 *  cardmem measured exactly that on `vite build`. The host passes mail-core's own
 *  functions; there is no fallback, because a fallback IS a second implementation. */
export interface MailPrimitives {
  heading: (text: string, opts: { accentColor?: string; fontSerif?: string }) => string;
  paragraph: (text: string) => string;
  noteBox: (html: string, opts: { accentColor: string }) => string;
  cta: (href: string, label: string, opts: { accentColor: string }) => string;
}

function withClass(html: string, cls: string): string {
  return html.replace(/^\s*<([a-z0-9]+)/i, (_m, tag) => `<${tag} class="${cls}"`);
}

/** Blocks → body html, styled inline by mail-core and carrying the class hooks. */
export function renderBlocks(
  blocks: MailBlock[],
  opts: { accentColor: string; primitives: MailPrimitives; fontSerif?: string },
): { html: string; notes: string[] } {
  const notes: string[] = [];
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        out.push(withClass(opts.primitives.heading(b.text, { accentColor: opts.accentColor, ...(opts.fontSerif ? { fontSerif: opts.fontSerif } : {}) }), MAIL_CLASSES.p));
        break;
      case "paragraph":
        out.push(withClass(opts.primitives.paragraph(b.text), MAIL_CLASSES.p));
        break;
      case "note":
        // A coloured left EDGE, not a filled panel: in Outlook iOS card and footer
        // both became #484848, so a zone defined by fill stops existing.
        out.push(withClass(opts.primitives.noteBox(escapeHtml(b.text), { accentColor: opts.accentColor }), MAIL_CLASSES.box));
        break;
      case "button": {
        const check = checkUrl(b.url, { filled: true });
        if (!check.ok) {
          // Plain TEXT, not dropped: a missing button is a silent change; a visible
          // non-link is a visible one, and the note says why.
          notes.push(check.reason);
          out.push(withClass(opts.primitives.paragraph(b.text), MAIL_CLASSES.p));
          break;
        }
        out.push(withClass(opts.primitives.cta(b.url, b.text, { accentColor: opts.accentColor }), MAIL_CLASSES.btn));
        break;
      }
      case "divider":
        out.push("<hr>");
        break;
      case "html":
        out.push(b.text);
        break;
    }
  }
  return { html: out.join("\n"), notes };
}

/** Fill `{{name}}` placeholders, escaping each value.
 *
 *  A MISSING value stays as the literal placeholder and is named in `missing` —
 *  a visible `{{navn}}` is caught; a silently blank sentence is not. An EMPTY value
 *  is honoured as empty (`in values`, not truthiness). `rawKeys` names values that
 *  are already HTML — opt-in per call, so a caller must say which key it trusts. */
export function fillPlaceholders(
  text: string,
  values: Record<string, string>,
  rawKeys: readonly string[] = [],
): { text: string; missing: string[] } {
  const raw = new Set(rawKeys);
  const missing: string[] = [];
  const filled = text.replace(TOKEN, (whole, key: string) => {
    if (!(key in values)) {
      missing.push(key);
      return whole;
    }
    const v = values[key] ?? "";
    return raw.has(key) ? v : escapeHtml(v);
  });
  return { text: filled, missing: [...new Set(missing)] };
}

/** Fill WITHOUT escaping, for a destination that escapes for itself (a subject line,
 *  a button url). A separate function, not an `escape: false` flag someone flips on a text field. */
export function fillPlaceholdersRaw(text: string, values: Record<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const filled = text.replace(TOKEN, (whole, key: string) => {
    if (!(key in values)) {
      missing.push(key);
      return whole;
    }
    return values[key] ?? "";
  });
  return { text: filled, missing: [...new Set(missing)] };
}

export interface RenderedTemplate {
  /** The BODY html — wrap it in @broberg/mail-core's renderShell. */
  html: string;
  /** Plain text, filled without escaping: a mail client never renders a subject as HTML. */
  subject: string;
  /** Explicit or derived — never silently empty. */
  preheader: string;
  /** Placeholders with no value, from body, subject and button urls. */
  missing: string[];
  /** Findings that did not stop the render but a person should see. */
  notes: string[];
}

/** The WHOLE render, in the one order that is correct: render blocks, THEN fill.
 *
 *  Both steps escape, so the other order escapes twice:
 *    fill THEN render  →  "Sørensen & Søn"  →  "Sørensen &amp;amp; Søn"
 *    render THEN fill  →  "Sørensen & Søn"  →  "Sørensen &amp; Søn"   ✓
 *  The wrong order looks right for every customer without an `&` in their name.
 *
 *  ONE exception, for the same reason: a button URL is filled FIRST, unescaped, so
 *  it goes through checkUrl (a value resolving to a relative or javascript: link
 *  degrades to text) and then the cta primitive's own attribute escaping. */
export function renderTemplate(
  template: Pick<MailTemplate, "subject" | "blocks" | "preheader">,
  opts: {
    /** Resolved by the caller (the shell needs the same value — two places deciding a brand colour disagree). */
    accentColor: string;
    fontSerif?: string;
    primitives: MailPrimitives;
    /** Value keys that are already HTML. See fillPlaceholders. */
    rawValueKeys?: readonly string[];
  },
  values: Record<string, string> = {},
): RenderedTemplate {
  const urlMissing: string[] = [];
  const blocks = template.blocks.map((b) => {
    if (b.type !== "button") return b;
    const f = fillPlaceholdersRaw(b.url, values);
    urlMissing.push(...f.missing);
    return { ...b, url: f.text };
  });
  const rendered = renderBlocks(blocks, { accentColor: opts.accentColor, primitives: opts.primitives, ...(opts.fontSerif ? { fontSerif: opts.fontSerif } : {}) });
  // Brace text that is NOT a token ("{{brevets brødtekst indsættes her}}") matches
  // neither `missing` nor anything else — fd-sundhed shipped one for two days.
  // Checked BEFORE filling, where a filled token is not yet gone.
  for (const m of rendered.html.matchAll(/\{\{([^}]*)\}\}/g)) {
    if (/^\s*[a-zA-Z0-9_.]+\s*$/.test(m[1] ?? "")) continue;
    rendered.notes.push(`"${m[0]}" looks like a placeholder but is not one — it will be delivered to the recipient verbatim. A placeholder is a single key, e.g. {{body}}.`);
  }
  const body = fillPlaceholders(rendered.html, values, opts.rawValueKeys ?? []);
  const subject = fillPlaceholdersRaw(template.subject, values);
  const preheader = fillPlaceholdersRaw(derivePreheader(template.blocks, template.preheader), values);
  return {
    html: body.text,
    subject: subject.text,
    preheader: preheader.text,
    missing: [...new Set([...body.missing, ...subject.missing, ...urlMissing, ...preheader.missing])],
    notes: rendered.notes,
  };
}

// ─────────────────────────────────────────────────────────────── per-tenant overrides

/** The EFFECTIVE template: a stored override over the coded default.
 *
 *  subject, blocks and preheader REPLACE; brand and copy MERGE key by key, so a
 *  tenant that sets only its accent keeps the default's sender and footer. */
export function resolveTemplate(standard: MailTemplate, override?: MailTemplateOverride | null): MailTemplate {
  if (!override) return standard;
  const out: MailTemplate = { ...standard };
  if (override.subject !== undefined) out.subject = override.subject;
  if (override.blocks !== undefined) out.blocks = override.blocks;
  if (override.preheader !== undefined) out.preheader = override.preheader;
  if (override.brand !== undefined) out.brand = { ...(standard.brand ?? {}), ...override.brand };
  if (override.copy !== undefined) out.copy = { ...(standard.copy ?? {}), ...override.copy };
  return out;
}

export interface EffectiveTemplate {
  purpose: string;
  effective: MailTemplate;
  /** The coded default — what "reset" goes back to. */
  default: MailTemplate;
  /** True when the tenant's override changes at least one field. */
  isCustom: boolean;
}

/** Every coded template with its tenant's override applied — what an editor lists.
 *
 *  An override whose purpose has no coded default is NAMED in `unknownOverrides`,
 *  not dropped: a template renamed in code would otherwise lose a tenant's edits
 *  with nothing to show for it. */
export function listEffectiveTemplates(
  defaults: readonly MailTemplate[],
  overrides: Readonly<Record<string, MailTemplateOverride | null | undefined>> = {},
): { templates: EffectiveTemplate[]; unknownOverrides: string[] } {
  const known = new Set(defaults.map((d) => d.purpose));
  const templates = defaults.map((d) => {
    const o = overrides[d.purpose];
    const isCustom = !!o && Object.values(o).some((v) => v !== undefined);
    return { purpose: d.purpose, effective: resolveTemplate(d, o), default: d, isCustom };
  });
  const unknownOverrides = Object.keys(overrides).filter((p) => !known.has(p) && overrides[p]);
  return { templates, unknownOverrides };
}

// ─────────────────────────────────────────────────────────────── versioning

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, val]) => val !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, val]) => [k, stable(val)]),
    );
  }
  return v;
}

/** The canonical content a version's hash is taken over: stable key ORDER, so a
 *  moved JSON key is not reported as a change (a hash that cries wolf teaches
 *  everyone to ignore it). Extra fields a host adds to its template are included. */
export function canonicalContent(t: MailTemplate & Record<string, unknown>): string {
  return JSON.stringify(stable({ ...t, preheader: t.preheader ?? null, brand: t.brand ?? null, copy: t.copy ?? null }));
}

/** SHA-256 hex over canonical content. Submission and sync check must call THIS — two hashers drift. */
export async function hashContent(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
