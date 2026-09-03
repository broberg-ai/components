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

Every other color has a sensible neutral default (`cardBg` #fffffe — see below, `textColor` auto-derived for contrast against `cardBg`, `backdropColor` light grey) — but `accentColor` doesn't, on purpose. A default accent color IS a brand choice; shipping one would silently brand every consumer that forgets to set it. Pass your product's own accent explicitly.

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

## Signatures — three tiers, one axis each

```ts
signOff([
  { text: "Med venlig hilsen" },                                    // lead
  { text: "Christian Broberg", tier: "name" },                      // + bold
  { text: "CEO & Founding Partner · WebHouse ApS", tier: "meta" },  // + muted colour
]);
```

**Each tier changes exactly one axis against `lead`** — `name` adds weight,
`meta` adds a muted colour, and neither touches size. That is an invariant with a
test behind it, not a matter of taste, and it is why there is no fourth tier
coming: there is no fourth axis left to spend.

Two things it deliberately does **not** do:

- **`name` is bold, not bold-and-darker.** On a real palette `#1a1c2b` is 16.86:1
  on white and `#0b0e15` is 19.29:1 — both so far past every threshold that the
  step cannot be seen. The weight does the work; the colour shift was decoration.
- **`meta` has no size of its own.** A tier carrying a *relative* size step turns
  a 17/17-bold/15 signature into 15/15-bold/13 in a palette with a smaller base,
  and 13px secondary text is the exact thing one consumer measured their way out
  of (13.5px `#8486a6` at 3.5:1, failing WCAG in **light** mode before anyone
  mentioned dark). 15px is a measured floor for secondary text in mail.

`meta`'s colour is a real value (`#4a4d63`, 8.29:1 on white, 7.54:1 on the
default backdrop) and never an `opacity`. **An opacity is not a low contrast
value — it is a contrast value for ONE background.** `opacity:0.65` of `#1a1c2b`
measures 5.29:1 while the ground stays white and lands somewhere nobody measured
the moment a client tints or inverts; no contrast tool can read it, because there
is no colour there to read.

### The legacy form still works, byte for byte

`signOff(line1, line2, sign)` renders identically to how it always has — asserted
against a snapshot captured from the shipped build, because repos are calling it
in production mail. It has one fixed axis (size) and its big slot is the **last**
argument, which is why the array form exists: a name-then-title signature had to
be forced into it, and rendered the job title larger than the person.

The one correction: an empty `sign` no longer emits a blank line and an empty
`<span style="font-size:20px;"></span>`.

## The centred 180px logo is a deliberate shared choice

`renderShell` centres the logo at `max-width:180px`, and that is on purpose
rather than pending. A consumer arrived with their own 40px mark beside the
sender name and dropped it for this one — *"one shared expression is worth more
than our variant."* Recorded so the next consumer does not have to ask.

**But the brand hooks themselves stay caller-supplied.** Do not wrap
`logoUrl` / `accentColor` / `fontSerif` in a constant inside a consuming repo:
**the mail carries the SENDER's identity, and the sender is not always the repo
the template lives in.** A shared shell with per-send branding is the point; a
shell with the branding baked in is a different, worse product.

## Brand values are validated, and an invalid one throws

`accentColor`, `cardBg`, `textColor` and `backdropColor` must be a CSS colour —
hex (`#rgb`, `#rrggbb`, `#rrggbbaa`), `rgb()`/`rgba()`, `hsl()`/`hsla()`, or a
named colour (all 148, `rebeccapurple` included). `fontSans` / `fontSerif` must
not contain `< > "` or a backtick. Anything else **throws**, naming the field.

**It rejects rather than escapes, deliberately.** An escaped non-colour still
leaves the building and renders as literal garbage inside a `style` attribute —
the customer sees a broken mail and nobody sees an error. Throwing fails at the
caller, where someone can act on it.

This matters if you resolve branding **per tenant from a database**. These values
are interpolated into HTML attributes, so before the guard existed an accent
colour of

```
#fff;"></td></tr></table><a href="https://phish.example">Log ind her</a><table><tr><td x="
```

put that anchor into the rendered mail. No script is involved — a login link
inside an otherwise genuine, correctly-branded transactional mail is the whole
attack, and clients that strip script still render it. Validate at your own
boundary too; this is the last line, not the only one.

## Sizing the logo — set `logoWidth`, and set it even when 180 is what you want

```ts
renderShell({ …, logoUrl, logoWidth: 56 })
```

Omit it and you get the historic centred slot unchanged (`max-width:180px`, no
width attribute) — byte-identical to every mail sent before the field existed.

**Set it if you can.** A supplied width is emitted as an HTML `width` **attribute**
as well as in the style, and **the attribute is the only half Outlook reads** —
its Word engine ignores CSS dimensions on an image, so without the attribute it
draws your mark at its full *file* size.

That is also why the default remains Outlook-unsafe, deliberately: making 180
emit an attribute would fix it for everyone and would change what every existing
consumer's mail looks like in one client, which is not a change to make silently.

**Why this field exists.** A consumer shipped a 480×480 mark — 2× for a 40px
logo, the correct decision — and the shell drew it 180px wide on a 520px card.
**The better the source you supply, the worse the result**; a 96px file would have
looked fine. This hits the careful consumer, not the careless one.

No `height` attribute is emitted: this package serves non-square logos, and a
forced square distorts them in exactly the client that honours attributes.

**Rendering a logo without `logoWidth` warns once per process.** It changes no
mail — it is there so you find out whether *your* asset is affected, rather than
us guessing on your behalf. Known so far: one consumer's mark is 480×480 (2× for
a 40px logo, the correct call by their supplier) and was therefore broken in
Outlook. How many others is unmeasured, because only your repo knows your file's
width. If the warning fires and your source is under 180px wide, you were fine;
if it is wider, pass `logoWidth`.

`logoWidth` is how you **draw** the logo. If you also need to **produce** it at a
sane size, that is `@broberg/media-transform` — complementary, not an alternative.

## `fill()` escapes — and the order matters

```ts
fill(template, vars)      // every value HTML-escaped
fillHtml(template, vars)  // raw; the unsafe one is the one you have to name
```

**Before 0.6.0, `fill()` did not escape.** `vars` is dynamic by definition — a
customer's name, a booking reference, something someone typed — so if you were on
an earlier version and passed anything user-supplied through it, assume it
rendered as markup. Measured on 0.5.0:

```
fill("<p>Hej {name}</p>", { name: '<a href="https://phish.example">Log ind</a>' })
→ <p>Hej <a href="https://phish.example">Log ind</a></p>
```

**⚠️ Render first, then fill.**

```
render THEN fill   "Sørensen & Søn"  →  "Sørensen &amp; Søn"      ✓
fill THEN render   "Sørensen & Søn"  →  "Sørensen &amp;amp; Søn"  ✗
```

Render first and `{token}` is ordinary text that survives escaping untouched, so
each value is escaped exactly once. The wrong order fails in the worst available
direction: perfect for every customer whose name has no `&`, `<` or quote — most
of them — reaching production looking correct and breaking on one real person, in
their inbox, where nobody is watching. If you call both, compose them into one
function so a call site cannot get the order wrong. (Filed by cardmem, who hit it
in their own template store.)

## `SHELL_VERSION` — and what it was worth before 0.6.0

`SHELL_VERSION` is emitted into every mail as `<!-- @broberg/mail-core shell vN -->`
right after the doctype, so you can tell *"my template changed"* from *"their
shell changed"* by reading a stored render.

**It read `"1"` across 0.2.x, 0.3.x and 0.4.x while the rendering changed three
times** — the footer rule, the footer text colour, the card background,
`signOff`'s emphasis. A stored `"1"` therefore proves nothing about which shell
rendered a mail. It is `"2"` from 0.6.0, and a test now compares the rendered
output against a fixture keyed by the marker: change the output without bumping
the version and the build fails. Two numbers answer two questions — read the
installed package version alongside it.
