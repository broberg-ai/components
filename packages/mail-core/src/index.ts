/**
 * Branded HTML email shell + primitives — layer 1 (visual structure) of the
 * fleet's mail stack. No sending (that's @broberg/mail) and no template
 * content/override-resolution (that's @broberg/mail-templates, F040) — this
 * package only turns brand params + body HTML into a complete, email-client-
 * safe HTML document, plus the small block builders every template needs.
 *
 * Generalizes sanneandersen's site/src/lib/mail-templates/shell.ts (table
 * layout, dark-mode [data-ogsc] Outlook guards, CID logo) — every color/font/
 * copy value that file hardcoded is now a caller-supplied option.
 */

import { readFileSync, existsSync } from "node:fs";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export interface BrandColors {
  /** Top-of-card accent + CTA button color. Required — no fleet-wide default,
   *  so nothing is silently branded as some other product's identity. */
  accentColor: string;
  /** Card background. Default '#ffffff' — pass a dark value (e.g. '#1a1a1a')
   *  for a dark-card brand; textColor's default adapts automatically. */
  cardBg?: string;
  /** Body text color. Default derived from cardBg (light card → dark text,
   *  dark card → light text) so a dark-card brand isn't illegible by default. */
  textColor?: string;
  /** Page background behind the card. Default '#f4f4f5'. */
  backdropColor?: string;
  fontSans?: string;
  fontSerif?: string;
}

function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // Perceived luminance (ITU-R BT.601).
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function resolveColors(b: BrandColors) {
  const cardBg = b.cardBg ?? "#ffffff";
  const textColor = b.textColor ?? (isDark(cardBg) ? "#f5f5f5" : "#1a1a1a");
  const backdropColor = b.backdropColor ?? "#f4f4f5";
  const fontSans = b.fontSans ?? "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";
  const fontSerif = b.fontSerif ?? "Georgia,'Times New Roman',serif";
  return { accentColor: b.accentColor, cardBg, textColor, backdropColor, fontSans, fontSerif };
}

export interface ShellOpts extends BrandColors {
  subject: string;
  /** Hidden preview text shown in the mail-client inbox list. */
  preheader?: string;
  lang?: string;
  /** Pre-rendered body HTML — compose with heading/paragraph/cta/factBox/signOff. */
  bodyHtml: string;
  showFooter?: boolean;
  footerLines?: string[];
  footerHref?: string;
  footerLabel?: string;
  /** Resolved logo <img> src — a cid: reference (see makeLogoAttachment) or a hosted URL. */
  logoUrl?: string;
  logoAlt?: string;
}

/** Renders a complete, email-client-safe HTML document: table layout (not
 *  flex/grid — Outlook doesn't support it), dark-mode-inversion guards via
 *  both `prefers-color-scheme` and Outlook.com's `[data-ogsc]`, a rounded
 *  card with an accent-colored top strip, and an optional footer. */
export function renderShell(opts: ShellOpts): string {
  const { accentColor, cardBg, textColor, backdropColor, fontSans } = resolveColors(opts);
  const lang = opts.lang ?? "en";
  const showFooter = opts.showFooter ?? true;

  const logoBlock = opts.logoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 16px;">
    <tr><td>
      <img src="${escapeAttr(opts.logoUrl)}" alt="${escapeAttr(opts.logoAlt ?? "")}" style="display:block;margin:0 auto;max-width:180px;height:auto;border:0;">
    </td></tr>
  </table>`
    : "";

  const footerBlock = showFooter
    ? `<tr>
      <td bgcolor="${backdropColor}" style="background:${backdropColor};padding:16px 40px 32px;text-align:center;border-top:1px solid rgba(0,0,0,0.08);">
        ${(opts.footerLines ?? []).map((l) => `<p style="margin:0 0 4px;font-size:11px;opacity:0.65;">${escapeHtml(l)}</p>`).join("")}
        ${opts.footerHref ? `<p style="margin:0;font-size:11px;"><a href="${escapeAttr(opts.footerHref)}" style="color:${accentColor};text-decoration:none;font-weight:600;">${escapeHtml(opts.footerLabel ?? opts.footerHref)}</a></p>` : ""}
      </td>
    </tr>`
    : "";

  return `<!doctype html>
<html lang="${escapeAttr(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(opts.subject)}</title>
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  @media (prefers-color-scheme: dark) {
    .mc-bg-outer { background:${backdropColor} !important; }
    .mc-bg-card  { background:${cardBg} !important; }
    .mc-text     { color:${textColor} !important; }
  }
  [data-ogsc] .mc-bg-outer { background:${backdropColor} !important; }
  [data-ogsc] .mc-bg-card  { background:${cardBg} !important; }
  [data-ogsc] .mc-text     { color:${textColor} !important; }
</style>
</head>
<body class="mc-bg-outer mc-text" bgcolor="${backdropColor}" style="margin:0;padding:0;background:${backdropColor};font-family:${fontSans};color:${textColor};-webkit-font-smoothing:antialiased;">
${opts.preheader ? `<div style="display:none;font-size:1px;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(opts.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${backdropColor}" class="mc-bg-outer" style="background:${backdropColor};padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" bgcolor="${cardBg}" class="mc-bg-card" style="max-width:520px;width:100%;background:${cardBg};border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td bgcolor="${accentColor}" style="background:${accentColor};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
        <tr>
          <td bgcolor="${cardBg}" class="mc-bg-card" style="background:${cardBg};padding:40px 40px 0;text-align:center;">
            ${logoBlock}
          </td>
        </tr>
        <tr>
          <td bgcolor="${cardBg}" class="mc-bg-card mc-text" style="background:${cardBg};padding:32px 40px;">
            ${opts.bodyHtml}
          </td>
        </tr>
        ${footerBlock}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function heading(text: string, opts?: { fontSerif?: string; textColor?: string }): string {
  const fontSerif = opts?.fontSerif ?? "Georgia,'Times New Roman',serif";
  const textColor = opts?.textColor ?? "#1a1a1a";
  return `<h1 style="margin:0 0 12px;font-family:${fontSerif};font-size:28px;font-weight:400;color:${textColor};text-align:center;">${escapeHtml(text)}</h1>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(text)}</p>`;
}

/** Like paragraph(), but the string is injected as raw HTML (not escaped) —
 *  the caller must escapeHtml() any dynamic values themselves. */
export function paragraphHtml(html: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${html}</p>`;
}

export function signOff(line1: string, line2: string, sign: string): string {
  return `<div style="margin-top:24px;padding-top:24px;border-top:1px solid rgba(0,0,0,0.1);text-align:center;">
    <p style="margin:0;font-size:15px;line-height:1.8;">
      ${escapeHtml(line1)}<br>
      ${escapeHtml(line2)}<br>
      <span style="font-size:20px;">${escapeHtml(sign)}</span>
    </p>
  </div>`;
}

/** A bulletproof (table-cell-based, not a bare <a>/<button>) call-to-action
 *  button — the pattern every surveyed template hand-rolled per-brand. */
export function cta(href: string, label: string, opts: { accentColor: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 8px;">
    <tr>
      <td bgcolor="${opts.accentColor}" style="background:${opts.accentColor};border-radius:999px;">
        <a href="${escapeAttr(href)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

export interface FactRow {
  label: string;
  value: string;
}

/** A structured label/value block (table rows, not flex/grid — email-client
 *  safe) for rendering e.g. booking details or submitted form fields. */
export function factBox(rows: FactRow[], opts?: { accentColor?: string }): string {
  if (rows.length === 0) return "";
  const border = opts?.accentColor ? `border-left:3px solid ${opts.accentColor};` : "border:1px solid rgba(0,0,0,0.1);";
  const cells = rows
    .map(
      (r) => `<tr>
        <td style="padding:6px 12px 6px 0;font-size:13px;opacity:0.65;white-space:nowrap;vertical-align:top;">${escapeHtml(r.label)}</td>
        <td style="padding:6px 0;font-size:13px;font-weight:600;">${escapeHtml(r.value)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;${border}border-radius:8px;">
    <tr><td style="padding:12px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${cells}</table>
    </td></tr>
  </table>`;
}

/** Replace {token} placeholders with values. Unknown tokens are left as-is. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? String(vars[key]) : `{${key}}`));
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentId: string;
  contentType: string;
}

/** Reads a logo file from a caller-supplied full path and returns a
 *  Resend-shaped inline (CID) attachment, or null if the file doesn't exist —
 *  never throws, so a missing logo degrades to no-logo, not a broken send. */
export function makeLogoAttachment(filePath: string, opts?: { contentId?: string; contentType?: string }): MailAttachment | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath);
    const filename = filePath.split("/").pop() ?? "logo";
    const contentType = opts?.contentType ?? (filename.endsWith(".svg") ? "image/svg+xml" : "image/png");
    return { filename, content, contentId: opts?.contentId ?? "logo", contentType };
  } catch {
    return null;
  }
}
