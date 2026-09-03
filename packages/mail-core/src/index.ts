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
  /** Card background. Default '#fffffe' — one byte off white on purpose, so a
   *  client looking for EXACTLY #ffffff does not decide the mail wants
   *  inverting. Pass a dark value (e.g. '#1a1a1a')
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
  // #fffffe, not #ffffff, and the one-off byte is the whole point: several
  // clients treat EXACTLY white as "this is a light mail, invert it". One step
  // off slips that recognition and no eye can tell the difference. Measured at
  // ZERO effect in Outlook iOS specifically (F023.7) — it is on the list because
  // it works in OTHER clients, not because it rescues that one.
  const cardBg = b.cardBg ?? "#fffffe";
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
  /** Resolved logo <img> src — a cid: reference (see makeLogoAttachment) or a
   *  hosted URL. Still honoured; prefer `logo` below, which can carry BOTH. */
  logoUrl?: string;
  logoAlt?: string;
  /** The logo, expressed as EVERY form you have, in preference order (F023.7).
   *
   *  WHY BOTH RATHER THAN A CHOICE. cardmem cannot always attach when it sends
   *  on a project's behalf, so a template that can only say `cid:` is unusable
   *  there. And sanne measured the opposite failure: their `data:` URI logo was
   *  stripped by Gmail's image proxy, and ONE template missed in the migration
   *  to `cid:` broke ALONE, half a year later. A field that holds one form makes
   *  that a migration; a field that holds both makes it a fallback.
   *
   *  Preference is CID first, and it is not a style choice: a hosted logo is
   *  re-fetched every time the mail is opened, for years, so moving the file
   *  breaks every mail ever sent — retroactively. An attachment cannot rot. */
  logo?: LogoSource;
}

export interface LogoSource {
  /** contentId of an attached image — rendered as `cid:<id>`. Preferred. */
  cid?: string;
  /** Hosted URL. Used when no cid is given. */
  url?: string;
  alt?: string;
}

/** Pick the logo src from every form the caller supplied, in preference order.
 *
 *  Exported so a caller can ask what WOULD be used without rendering a shell —
 *  and so the preference itself is testable rather than buried in a template
 *  literal.
 *
 *  Returns `null` when there is nothing usable, which is a real outcome: no
 *  logo block is rendered, rather than an <img> with an empty src that shows a
 *  broken-image icon in every client. */
export function resolveLogoSrc(logo: LogoSource | undefined, fallbackUrl?: string): string | null {
  const cid = logo?.cid?.trim();
  if (cid) return `cid:${cid}`;
  const url = logo?.url?.trim() || fallbackUrl?.trim();
  if (!url) return null;
  // A data: URI is NOT a third option — Gmail's image proxy strips it, measured
  // by sanne on a live send. Refused rather than rendered, because a logo that
  // silently vanishes at one provider is the failure this field exists to stop.
  if (/^data:/i.test(url)) return null;
  return url;
}

/** Renders a complete, email-client-safe HTML document: table layout (not
 *  flex/grid — Outlook doesn't support it), dark-mode-inversion guards via
 *  both `prefers-color-scheme` and Outlook.com's `[data-ogsc]`, a rounded
 *  card with an accent-colored top strip, and an optional footer. */
/** The shell's own identity, emitted into every rendered mail (F023.7).
 *
 *  WHY IT EXISTS, in cardmem's words: a project must be able to tell "MY
 *  template changed" from "the SHARED shell changed". Without it those are one
 *  observation, and fd-sundhed's condition for adopting a shared shell is
 *  exact — «ellers er delingen en risiko-flytning, ikke en forbedring».
 *
 *  Bumped by hand when the rendered OUTPUT changes, which is deliberately not
 *  the package version: a docs-only or types-only release must not make every
 *  consumer's stored render look different. Same output, same number.
 *
 *  An HTML COMMENT rather than an attribute: comments survive every client we
 *  have measured, and an attribute on <html> is one of the first things a
 *  sanitising webmail rewrites. */
export const SHELL_VERSION = "1";

export function renderShell(opts: ShellOpts): string {
  const { accentColor, cardBg, textColor, backdropColor, fontSans } = resolveColors(opts);
  const lang = opts.lang ?? "en";
  const showFooter = opts.showFooter ?? true;

  const logoSrc = resolveLogoSrc(opts.logo, opts.logoUrl);
  const logoAlt = opts.logo?.alt ?? opts.logoAlt ?? "";
  const logoBlock = logoSrc
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 16px;">
    <tr><td>
      <img src="${escapeAttr(logoSrc)}" alt="${escapeAttr(logoAlt)}" style="display:block;margin:0 auto;max-width:180px;height:auto;border:0;">
    </td></tr>
  </table>`
    : "";

  // The footer zone is carried by a COLOURED RULE, not by its fill. fd-sundhed
  // measured card and footer BOTH becoming #484848 in Outlook iOS — the fill
  // stopped distinguishing anything and the zone ceased to exist. What survived
  // was a rule in the brand's own accent. The previous rgba(0,0,0,0.08) is a
  // near-invisible black alpha, i.e. exactly the thing that disappears there.
  //
  // And the text is a real COLOUR, never an opacity. An opacity is not a low
  // contrast value — it is a contrast value FOR ONE BACKGROUND: opacity 0.65 of
  // #1a1c2b measures 5.29:1 while the ground stays white, and lands somewhere
  // nobody measured the moment a client tints or inverts. No contrast tool can
  // read it, because there is no colour there to read.
  //   #4a4d63 on #f4f4f5   7.54:1      #c1c2d1 on #1a1c2b   9.56:1
  //   #4a4d63 on #ffffff   8.29:1      #c1c2d1 on #484848   5.18:1  (the mapped case)
  const footerText = isDark(backdropColor) ? "#c1c2d1" : "#4a4d63";
  const footerBlock = showFooter
    ? `<tr>
      <td bgcolor="${backdropColor}" style="background:${backdropColor};padding:16px 40px 32px;text-align:center;border-top:1px solid ${accentColor};">
        ${(opts.footerLines ?? []).map((l) => `<p style="margin:0 0 4px;font-size:11px;color:${footerText};">${escapeHtml(l)}</p>`).join("")}
        ${opts.footerHref ? `<p style="margin:0;font-size:11px;"><a href="${escapeAttr(opts.footerHref)}" style="color:${accentColor};text-decoration:none;font-weight:600;">${escapeHtml(opts.footerLabel ?? opts.footerHref)}</a></p>` : ""}
      </td>
    </tr>`
    : "";

  return `<!doctype html>
<!-- @broberg/mail-core shell v${SHELL_VERSION} -->
<html lang="${escapeAttr(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(opts.subject)}</title>
<style>
  /* ⚠️ THE THREE FORCE-LIGHT LAYERS BELOW HAVE ZERO EFFECT IN OUTLOOK iOS.
     Not partial — zero. Measured by fd-sundhed on a real iPhone, 2026-08-19
     18:28: asked #141969 and got #484090; asked #fffffe and got #484848, with
     card AND footer landing on the same colour so the footer stopped being a
     zone at all. The three are: these color-scheme metas + rule, the
     [data-ogsc]/[data-ogsb] rules, and #fffffe-instead-of-#ffffff.

     THEY STAY, because Apple Mail honours them. Do not add a FOURTH layer
     expecting it to fix Outlook — three have been measured at nothing.

     ⚠️ AND THE DIRECTION IS INVERTED, which is the trap: Outlook maps a DARK
     source colour to a LIGHT rendered one (#1a1c2b -> #c1c2d1, #4a4d63 ->
     #a7a9bf). So to make a too-faint line MORE readable at the recipient, make
     the source colour DARKER. Someone seeing a washed-out line will reach for
     "lighten it" and make it worse — that is the whole reason this comment sits
     here rather than in a plan-doc.

     What actually doubled legibility (2.0:1 -> 4.9:1) was structural: no
     mid-tones, structure from rule-and-space rather than fills, no gradient,
     and a button with fill AND border. */
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

/** `emphasis` italicises the FIRST occurrence of that substring in the accent
 *  colour — the "one word picked out of the headline" brand signature three
 *  consumers hand-rolled (reported by vn-leker, F023.7).
 *
 *  A substring that does not occur leaves the heading UNCHANGED rather than
 *  appending anything: a caller passing a word that is not there has made a
 *  mistake, and silently adding it to the end would render that mistake as
 *  design. Omitting `emphasis` renders byte-identically to 0.1.0.
 *
 *  `fontSerif` SHOULD be a full fallback STACK, never a single family name.
 *  vn-leker dropped their serif entirely because Outlook does not guarantee
 *  webfonts — which removed the design instead of letting Apple Mail show it.
 *  Layer it; do not choose. */
export function heading(
  text: string,
  opts?: { fontSerif?: string; textColor?: string; emphasis?: string; accentColor?: string },
): string {
  const fontSerif = opts?.fontSerif ?? "Georgia,'Times New Roman',serif";
  const textColor = opts?.textColor ?? "#1a1a1a";
  let inner = escapeHtml(text);
  const em = opts?.emphasis;
  if (em) {
    // Match on the ESCAPED needle inside the ESCAPED haystack, so a word
    // containing & or < still finds itself.
    const needle = escapeHtml(em);
    const at = inner.indexOf(needle);
    if (at !== -1) {
      const colour = opts?.accentColor ?? textColor;
      inner =
        inner.slice(0, at) +
        `<i style="color:${colour};font-style:italic;">${needle}</i>` +
        inner.slice(at + needle.length);
    }
  }
  return `<h1 style="margin:0 0 12px;font-family:${fontSerif};font-size:28px;font-weight:400;color:${textColor};text-align:center;">${inner}</h1>`;
}

/** The small uppercase label above a heading ("PROJECT UPDATE"). Letter-spaced
 *  and in the accent colour; a recurring component in every surveyed template. */
export function eyebrow(text: string, opts: { accentColor: string }): string {
  return `<p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${opts.accentColor};text-align:center;">${escapeHtml(text)}</p>`;
}

/** Free prose with a coloured left rule — a NOTE, not a table.
 *
 *  Deliberately not an option on factBox(): that renders label/value ROWS, and
 *  this takes a paragraph. Same visual family, different datatype — folding
 *  them together would be one function doing two jobs, and the caller would
 *  have to pass prose disguised as a row to reach it.
 *
 *  Takes RAW HTML like paragraphHtml(): the caller escapes dynamic values. */
export function noteBox(html: string, opts: { accentColor: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;border-left:3px solid ${opts.accentColor};border-radius:8px;">
    <tr><td style="padding:12px 16px;font-size:14px;line-height:1.6;">${html}</td></tr>
  </table>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(text)}</p>`;
}

/** Like paragraph(), but the string is injected as raw HTML (not escaped) —
 *  the caller must escapeHtml() any dynamic values themselves. */
export function paragraphHtml(html: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${html}</p>`;
}

/** One line of a signature, and the tier that styles it.
 *
 *  THE INVARIANT, and it is testable rather than a matter of taste: **each tier
 *  changes exactly ONE axis against `lead`.** There is no fourth tier waiting,
 *  because there is no fourth axis left to spend.
 *
 *    lead   the base — the size and colour of the surrounding text
 *    name   + bold          (same size, same colour)
 *    meta   + muted colour  (same size, same weight)
 *
 *  WHY `name` IS NOT ALSO DARKER, though the obvious signature makes it so:
 *  measured on vn-leker's own palette, #1a1c2b is 16.86:1 on white and #0b0e15
 *  is 19.29:1. Both are so far past every threshold that the step cannot be
 *  seen. The weight does all the work; the colour shift was decoration. Their
 *  finding, on their own design.
 *
 *  WHY `meta` HAS NO SIZE OF ITS OWN, which is the tempting third axis: a tier
 *  carrying a *relative* size step turns a 17/17-bold/15 signature into
 *  15/15-bold/13 in a palette with a smaller base — and 13px secondary text is
 *  the exact thing fd-sundhed measured their way out of (13.5px #8486a6 at
 *  3.5:1, failing WCAG in LIGHT mode, before anyone mentioned dark). They went
 *  UP in size as part of what doubled legibility. A relative step would quietly
 *  roll that back, and the fault would live in a tier definition nobody reads
 *  while choosing `meta`. 15px is a measured floor for secondary text in mail.
 */
export interface SignOffLine {
  text: string;
  tier?: "lead" | "name" | "meta";
}

/** The muted tier's colour, one value per background polarity — never an
 *  `opacity`, for the reason spelled out on the footer above: an opacity is a
 *  contrast value for ONE background only.
 *
 *  BOTH POLARITIES EXIST BECAUSE THE SHELL SUPPORTS DARK CARDS, and the first
 *  cut of this function did not: a hardcoded #4a4d63 measures **2.10:1** on a
 *  #1a1a1a card — far under the 4.5:1 floor, while the README advertises dark
 *  cards as a supported mode. That is the same defect this change removed from
 *  the footer, reintroduced one function away in the same commit. Found by
 *  reviewing the diff, not by any test — which is why the test now renders BOTH
 *  polarities and asserts they DIFFER.
 *
 *    #4a4d63 on #fffffe   8.29:1        #c1c2d1 on #1a1a1a   9.87:1
 *    #4a4d63 on #1a1a1a   2.10:1  <-    #c1c2d1 on #484848   5.18:1
 */
const SIGNOFF_META_LIGHT = "#4a4d63";
const SIGNOFF_META_DARK = "#c1c2d1";

function signOffLine(line: SignOffLine, metaColor: string): string {
  const text = escapeHtml(line.text);
  if (line.tier === "name") return `<strong style="font-weight:700;">${text}</strong>`;
  if (line.tier === "meta") return `<span style="color:${metaColor};">${text}</span>`;
  return text;
}

/** A signature block.
 *
 *  TWO FORMS, and the old one is load-bearing: three repos call
 *  `signOff(line1, line2, sign)` in production mail, so it renders
 *  byte-identically and always will.
 *
 *  THE OLD FORM'S DEFECT, which is why the array form exists: its big slot is
 *  the LAST argument and its only axis is size. A name-then-title signature had
 *  to be forced into it, and rendered the job title larger than the person —
 *  in a mail Christian opened. The API could not express the signature, so the
 *  mapping was wrong before anyone wrote a line of calling code.
 *
 *  An index-based fix (`{ emphasizeIndex }`) was proposed and rejected: it
 *  would place the name and still leave the title nowhere to go, i.e. the same
 *  defect in a new shape. It also defaults to index 0 — "Med venlig hilsen" —
 *  inverting the old form's last-line emphasis for everyone who did not pass
 *  the option. vn-leker caught that; it was worse than the bug it fixed.
 */
export function signOff(lines: SignOffLine[], opts?: { cardBg?: string }): string;
export function signOff(line1: string, line2: string, sign: string): string;
export function signOff(
  a: SignOffLine[] | string,
  b?: { cardBg?: string } | string,
  sign?: string,
): string {
  // The separator carries the original's indentation, so the legacy form is
  // byte-identical rather than merely equivalent. A test asserts that against a
  // stored snapshot; reading it here is not the proof.
  const br = "<br>\n      ";
  // `meta` follows the card it sits on, using the SAME isDark() the shell uses,
  // so the two cannot drift apart. A caller who omits cardBg gets the light
  // pair, which is exactly what the shell's own default card is.
  const metaColor =
    Array.isArray(a) && typeof b === "object" && b?.cardBg && isDark(b.cardBg)
      ? SIGNOFF_META_DARK
      : SIGNOFF_META_LIGHT;
  const body = Array.isArray(a)
    ? a.map((l) => signOffLine(l, metaColor)).join(br)
    // The legacy form — with ONE correction: an empty `sign` used to emit a
    // trailing `<br>` plus `<span style="font-size:20px;"></span>`, i.e. a blank
    // line and an empty styled element that failed nowhere and so survived.
    // vn-leker's own signature replacement left exactly that residue.
    : [escapeHtml(a), escapeHtml(typeof b === "string" ? b : "")].join(br) +
      (sign ? `${br}<span style="font-size:20px;">${escapeHtml(sign)}</span>` : "");
  return `<div style="margin-top:24px;padding-top:24px;border-top:1px solid rgba(0,0,0,0.1);text-align:center;">
    <p style="margin:0;font-size:15px;line-height:1.8;">
      ${body}
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
