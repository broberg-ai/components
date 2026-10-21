# @broberg/mail-templates

The engine behind a mail template. A template is **data** — blocks and brand — and this package turns it into the body of a mail, safely, in the one order that is correct. It also resolves a tenant's override over your coded default and gives you the content hash to version on.

- **Not storage.** You keep templates, overrides and versions in your own database.
- **Not the shell.** Wrap the body with `renderShell` from `@broberg/mail-core`.
- **Not sending.** Send with `@broberg/mail`.

Extracted from cardmem F298, which aggregated what four projects measured in real inboxes. Browser-safe: it imports only `zod`.

```bash
npm i @broberg/mail-templates @broberg/mail-core
```

## The shape

```ts
import { MailTemplate } from "@broberg/mail-templates";

const welcome = MailTemplate.parse({
  purpose: "welcome",                       // the key — a project has a SET of templates
  subject: "Velkommen {{navn}}",
  blocks: [
    { type: "heading", text: "Hej {{navn}}" },
    { type: "paragraph", text: "Din konto hos {{firma}} er klar." },
    { type: "note", text: "Linket udløber om 24 timer." },
    { type: "button", text: "Log ind", url: "{{login_url}}" },
    { type: "divider" },
    { type: "html", text: "{{letter}}" },  // pre-rendered html; see rawValueKeys
  ],
  preheader: "Din konto er klar",          // omitted → derived from the first paragraph
  brand: { senderName: "Team", colorAccent: "#0f7391", logoUrl: "https://…/logo.png", logoWidth: 140 },
  copy: { signoff: "Med venlig hilsen" },  // fixed phrases are data, per language
});
```

`MailBrand` **refuses** a colour or font stack that could break out of its attribute (`#fff;"></td>…`) and names the field — an escaped non-colour would ship as a broken mail nobody sees an error for.

## Render

```ts
import { renderTemplate } from "@broberg/mail-templates";
import { heading, paragraph, noteBox, cta, renderShell } from "@broberg/mail-core";

const r = renderTemplate(welcome, {
  accentColor: "#0f7391",                   // the same value you give the shell
  primitives: { heading, paragraph, noteBox, cta },
  rawValueKeys: ["letter"],                 // values that are ALREADY html
}, { navn: "Søren", firma: "Sørensen & Søn", login_url: "https://app.example/l/abc", letter: "<p>…</p>" });

r.html;       // body — every value escaped exactly once
r.subject;    // plain text, NOT escaped (a mail client never renders it as html)
r.preheader;  // explicit or derived, never empty by accident
r.missing;    // placeholders with no value: ["…"] — they stay visible as {{name}}
r.notes;      // e.g. a button whose url was relative, shown as text instead
```

The mail-core functions are passed in rather than imported: mail-core reads files at load time and would break a browser bundle (a template preview). There is no built-in fallback on purpose.

Rules you get for free:

- **Render first, then fill.** The other order escapes `&` twice for every customer whose name contains one.
- **Missing ≠ empty.** A missing value stays as `{{navn}}` and is listed in `missing`; `""` is a valid value.
- **A button is a link only if its url is absolute** (`https://`, `mailto:`) after filling. Otherwise it is rendered as plain text and the reason is in `notes`.
- **Brace prose that is not a token** (`{{indsæt tekst her}}`) is reported in `notes`.

## Per-tenant overrides

```ts
import { resolveTemplate, listEffectiveTemplates } from "@broberg/mail-templates";

const effective = resolveTemplate(welcome, tenantOverride);   // subject/blocks/preheader replace; brand/copy merge

const { templates, unknownOverrides } = listEffectiveTemplates([welcome, reset], overridesByPurpose);
// templates: [{ purpose, effective, default, isCustom }]  — what an editor lists, with "reset to default"
// unknownOverrides: purposes that have an override but no coded default — named, never dropped
```

## Versioning

```ts
import { canonicalContent, hashContent } from "@broberg/mail-templates";

const hash = await hashContent(canonicalContent(template));   // stable under key order
```

Store a new version when the hash changes. Use these two functions on both sides of a comparison — two hashers drift.
