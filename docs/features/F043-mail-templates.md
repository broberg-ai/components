# F043 — Branded email shell (@broberg/mail-templates)

> L1 Identity · runtime-package · effort **S** · impact **medium** · owner `components`. Status: Backlog.
> Graduate-candidate: no — small core npm that stays in `components`.

## Motivation

Three fleet repos have independently built their own branded transactional-email
HTML — cardmem (`brandedSignInEmailHtml`), xrt81 (`emailShell()` + per-message
templates), sanneandersen (`magicLinkTemplate`/`bookingConfirmationTemplate`) —
plus cms-admin's `renderInviteEmail`. Cross-repo survey (2026-07-01): all four
converge on the SAME structural skeleton — a rounded card (~18px), a colored
accent bar at the top, a header/logo area, a body slot, an optional "fact box"
(structured key/value rows), and a muted footer — while every repo's actual
**colors and copy differ** (cardmem clay/ink/ivory, xrt81 clay/ink/olive/sand,
sanneandersen sage/gold/cream, cms-admin dark+gold). That's the correct split:
the STRUCTURE is duplicated logic (4 independent re-implementations of the same
table-based, email-client-safe layout); the BRAND is legitimately per-product
and must stay a parameter, never hardcoded into the shared package.

Trigger: cms asked (2026-07-01, via intercom) whether a shared primitive exists
before building an admin-notification + customer-receipt email pair for the F30
form pipeline. No shared package existed — this plan closes that gap.

## Solution

**runtime-package.** (a) Identical structure in 4 repos, confirmed via direct
code survey. (b) Stable: transactional-email-safe HTML (table layout, inline
styles, no external CSS/JS) doesn't change once it works across mail clients.
(c) Painful: every new repo currently hand-rolls the same table-layout/inline-CSS
boilerplate from scratch, with the accent-bar/card/footer trick re-derived each
time (see xrt81's own internal shell/body split — it already discovered the
right seam independently).

## Scope

### In scope
- A framework-agnostic shell renderer: `renderEmailShell(opts)` → a complete,
  email-client-safe HTML string. Opts carry ALL brand-specific values
  (accentColor, cardBg, textColor, logoText/logoHtml, footerHtml, bodyHtml) —
  nothing brand-specific is hardcoded in the package.
- A `factBox(rows: {label,value}[])` helper — the structured key/value block
  seen in xrt81 (booking facts) and sanneandersen (booking details); this is
  exactly the shape an admin-notification email needs (rendering submitted
  form fields).
- A `ctaButton(text, url, opts?)` helper — the button pattern present in every
  surveyed template.
- Extract from `xrt81`'s `apps/server/src/lib/mail.ts` (`emailShell`) — it is
  the most mature reference: already separates shell from content and already
  parameterizes tenant name/tagline, closest to a clean generic API without
  invented redesign.

### Out of scope
- Sending (that's `@broberg/mail` — this package renders HTML only, never
  calls Resend/fetch).
- Per-brand color/copy decisions — those stay in each consuming repo.
- A visual template EDITOR / CMS-side WYSIWYG — out of scope entirely; this is
  a code-level render primitive.
- Migrating cardmem/sanneandersen/cms-admin's EXISTING templates onto the
  package — no urgency signaled (cms said "no hast," ships its own for now);
  adoption is a separate follow-up once a real second consumer wants it, same
  as every other package here.

## Architecture

### Best source (reference implementation)
`broberg/xrt81` — `apps/server/src/lib/mail.ts` (`emailShell` wrapper, tenant
name/tagline params) + `apps/server/src/lib/mail-templates.ts` (per-message
body renderers: magic-link, meeting invite, host-assigned, GA invite,
club-message, etc.) — the only repo that already split shell-vs-body
internally, so the extraction is "generalize what already exists" not "invent
a new design."

### Other implementations seen (structure-compatible, brand-incompatible)
- `broberg/cardmem` — `apps/server/src/auth.ts:34-86` `brandedSignInEmailHtml`:
  clay accent bar (4px top), white rounded card on ivory, clay logo/icon box.
- `webhouse/sanneandersen` — `site/src/lib/auth/email-templates.ts`
  `magicLinkTemplate`/`bookingConfirmationTemplate`: sage-green accent,
  off-white card on cream, fact-box + calendar CTA — the richest fact-box
  usage, good cross-check for that helper's shape.
- `webhouse/cms` — `cms-admin`'s `lib/email.ts` `renderInviteEmail`: dark
  card, gold accent bar, footer — proves the shell must support BOTH light
  and dark card backgrounds (a fixed light-card assumption would break this).
- `broberg/trail` — `apps/admin-server/src/email.ts` `sendMagicLink`: plain
  unstyled HTML, no branding — confirms not every repo needs this; ship-dark
  is the right default (a repo that wants plain HTML just doesn't import it).

### Public API
```ts
// @broberg/mail-templates
export interface EmailShellOptions {
  accentColor: string;       // top bar + CTA button color, e.g. "#D97757"
  cardBg?: string;            // default "#ffffff" — cms-admin's dark card passes e.g. "#1a1a1a"
  textColor?: string;         // default derived for contrast against cardBg
  backdropColor?: string;     // page background behind the card
  logoHtml?: string;          // header slot — wordmark/logo markup, plain text ok
  bodyHtml: string;           // the message-specific content
  footerHtml?: string;        // default a minimal "sent by X" line
}
export function renderEmailShell(opts: EmailShellOptions): string;

export interface FactRow { label: string; value: string; }
export function factBox(rows: FactRow[], opts?: { accentColor?: string }): string;

export function ctaButton(text: string, url: string, opts?: { color?: string }): string;
```

## Stories

- **F043.1** — Extract `renderEmailShell` from xrt81's `emailShell` — _AC:_
  matches xrt81's rendered output byte-for-byte when called with xrt81's
  current params (regression-safe extraction); accepts a dark `cardBg` without
  breaking (cms-admin cross-check); zero framework imports; unit-tested against
  a snapshot of each surveyed repo's actual param set (cardmem/xrt81/sanne/cms
  style — proves the API is genuinely general, not xrt81-shaped only).
- **F043.2** — `factBox` + `ctaButton` helpers — _AC:_ `factBox` renders N
  label/value rows matching sanneandersen's booking-detail visual structure
  (table rows, not flex/grid — email-client-safe); `ctaButton` renders an
  email-safe button (table-based or bulletproof-button pattern, not a bare
  `<button>`) that resolves to `url` and respects `accentColor`.
- **F043.3** — README + adoption guide for cms's F30 admin-notification +
  customer-receipt pair — _AC:_ a worked example showing
  `renderEmailShell({accentColor: "<cms brand color>", bodyHtml: factBox(formFields) })`
  producing the admin-notification shape cms asked for, and a second example
  for the "thanks for reaching out" customer receipt.

## Acceptance criteria

1. `@broberg/mail-templates` builds + typechecks clean; zero framework imports,
   zero dependency on `@broberg/mail` (pure render, no send coupling).
2. Each story meets its own AC.
3. Byte-for-byte regression match against xrt81's current rendered output
   (the extraction changes nothing visually for its origin repo).
4. `factBox` cross-checked visually against sanneandersen's booking-detail
   block and cms-admin's dark-card style — both pass without shell changes.

## Dependencies

None blocking. Complements `@broberg/mail` (send) — a consumer typically pairs
`renderEmailShell(...)` → `mailer.send({ html })`.

## Rollout

Runtime-package, no strangler migration required at ship time — this is a
**net-new** shared primitive; existing templates (cardmem/xrt81/sanneandersen/
cms-admin) are NOT migrated as part of this epic (no urgency signaled, each
already works). Adoption happens per-repo, opportunistically, same bar as
every other `@broberg/*` package: migrate when a repo touches that code anyway
or when a THIRD consumer's ask makes re-deriving the pattern painful again.
cms's F30 admin-notification/receipt pair is the first real consumer and
motivates F043.3's worked example.

Graduate-candidate: no — stays in `components`.

## Open Questions

- Table-based HTML (max email-client compat, incl. Outlook) vs. modern
  flex/grid CSS (cleaner code, breaks in Outlook/older clients) — table-based
  is almost certainly correct for a shared primitive; confirm by checking
  which approach xrt81's `emailShell` already uses before "generalizing" it.
- Does `factBox` need an icon/emoji-per-row slot (sanneandersen's booking
  emails use a checkmark hero + fact rows) or is label/value enough for v0.1.0?
  Lean toward label/value-only now; extend additively if a consumer needs more.
- Dark-mode email-client auto-invert is a known transactional-email footgun
  (some clients auto-darken images/colors) — worth a README callout once
  built, not a blocker for the plan.

## Effort estimate

**S** — small, well-understood extraction from a mature reference (xrt81).

## Risks

Low. The main risk is scope creep toward a full "template engine" (conditionals,
loops, i18n) — resist that; this stays a handful of pure string-building
functions, matching the fleet's "own primitives, not policy" convention
(same discipline as `@broberg/apikey`).
