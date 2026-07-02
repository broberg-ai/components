# @broberg/mail-core

Branded HTML email **shell + primitives** for the broberg.ai fleet — layer 1 (visual structure) of the mail stack. Generalized from sanneandersen's hand-rolled shell, cross-checked against xrt81/cardmem/cms's own branded templates.

```bash
npm i @broberg/mail-core      # exact-pin for prod-auth deps
```

**Not this package:** sending (→ `@broberg/mail`) or template-content/per-tenant override resolution (→ `@broberg/mail-templates`, F040). This package only turns brand params + body HTML into a complete, email-client-safe document.

```ts
import { renderShell, heading, paragraph, cta, factBox, signOff, makeLogoAttachment } from "@broberg/mail-core";

const html = renderShell({
  accentColor: "#2E6B62",       // required — no fleet-wide default, nothing silently branded
  cardBg: "#FAF9F6",             // optional, default "#ffffff"
  subject: "Welcome to X",
  preheader: "Glad to have you",
  logoUrl: "cid:logo",           // pair with makeLogoAttachment for inline CID logos
  bodyHtml: [
    heading("Welcome!"),
    paragraph("Thanks for signing up."),
    factBox([{ label: "Plan", value: "Pro" }, { label: "Started", value: "2026-07-02" }]),
    cta("https://example.com/start", "Get started", { accentColor: "#2E6B62" }),
    signOff("Talk soon,", "The team", "— X"),
  ].join(""),
  footerLines: ["Acme Inc · Some Street 1"],
});
```

## Why `accentColor` is required, not defaulted

Every other color has a sensible neutral default (`cardBg` white, `textColor` auto-derived for contrast against `cardBg`, `backdropColor` light grey) — but `accentColor` doesn't, on purpose. A default accent color IS a brand choice; shipping one would silently brand every consumer that forgets to set it. Pass your product's own accent explicitly.

## Dark cards work

`textColor` auto-derives from `cardBg`'s perceived luminance — a dark `cardBg` (e.g. `#1a1a1a`) gets light text by default, no manual `textColor` needed (though you can still override it).

## Email-client compatibility

Table-based layout throughout (`role="presentation"` tables, not flex/grid), inline styles, `prefers-color-scheme` + Outlook.com's `[data-ogsc]` dark-mode-inversion guards. `cta()` renders a table-cell button, never a bare `<a>`/`<button>` some clients strip styling from.

## Logo attachments

`makeLogoAttachment(filePath)` reads a file from a **caller-supplied full path** (never assumes `process.cwd()`) and returns a Resend-shaped inline (CID) attachment — or `null` if the file is missing, so a missing logo degrades gracefully instead of breaking a transactional send.

```ts
const attachment = makeLogoAttachment("/app/public/brand/logo.png");
if (attachment) {
  await resend.emails.send({ ..., attachments: [attachment] });
}
```
