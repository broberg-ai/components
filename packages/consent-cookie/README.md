# @broberg/consent-cookie

## Drop-in banner: `<broberg-consent>` (since 0.2.0)

One element works the same in Next, Vite+Preact and plain HTML. No site copies its own banner.

```html
<script type="module">import "@broberg/consent-cookie/element";</script>
<broberg-consent policy-version="2026-09" privacy-href="/privatliv"></broberg-consent>
<a href="#" data-broberg-consent-open>Cookie-indstillinger</a>
```

| Attribute | Meaning |
|---|---|
| `policy-version` | **Required.** Bump it when your cookie policy changes. The banner then comes back with «Vores cookie-politik er opdateret». |
| `privacy-href` | The «Læs mere» link. |
| `lang` | `da` (default) or `en`. Falls back to `<html lang>`. |
| `storage-key` | Cookie name. Default `broberg-consent`. |
| `cookie-domain` | e.g. `.broberg.ai` to share one choice across subdomains. |
| `consent-mode` | Send Google Consent Mode v2 signals. |
| `categories` | The OPTIONAL categories your site really uses, e.g. `categories="analytics"`. The banner text and the settings panel then name only those. `categories=""` = only necessary cookies (the text says you do not use statistics or marketing). Absent = both, as before 0.5.0. **Set it** — the default text promises statistics and marketing, which is false on a site without them. |
| `reopen-position` | `bottom-left` (default), `bottom-right`, `top-left` or `top-right` (`left`/`right` from 0.2.0 still mean the bottom corners). The floating «Cookies» handle WILL cover whatever you have in that corner. Move it, or… |
| `hide-reopen` | …drop it entirely when it disrupts your design. Then the site MUST reopen the dialog another way: any element with `data-broberg-consent-open`, e.g. on the privacy page, or a menu item that calls `el.open()`. Some way back is required by law. Since 0.6.1 it can be set or removed at any time — e.g. hidden below your own mobile breakpoint — and only the handle reacts; an open panel keeps its focus and unsaved choices. |

**No floating handle — reopen from the privacy page instead (since 0.4.0 documented; works since 0.2.0):**

```html
<broberg-consent policy-version="2026-09" hide-reopen></broberg-consent>
<!-- on /privatliv, or in the footer -->
<button type="button" data-broberg-consent-open data-testid="privacy-cookie-settings">Skift cookie-indstillinger</button>
```

- **Read consent:** `el.manager.has("analytics")`, `window.brobergConsent.has(...)`, or listen for `consent-change` (bubbles, `detail` = the record or `null`).
- **Texts, field by field:** `el.texts = { title: "…", categories: { analytics: { label, description } } }`. Any field you leave out keeps the built-in Danish/English. Since 0.5.0 you can set it after the element is on the page (a Preact/React ref works); it re-renders. An explicit `body` wins over the text built from `categories`.
- **Older shadcn tokens (bare HSL triplets like `--primary: 222 47% 11%`):** the element needs real colours. `style="--primary: hsl(var(--primary))"` on the element is a cycle and resolves to nothing. Define aliases on `:root` (e.g. `--consent-primary: hsl(var(--primary))`) and map those on the element: `--primary: var(--consent-primary)`. Measured by fd-sundhed.
- **Styling:** the element reads your @broberg/theme tokens (`--primary`, `--radius`, `--card`, `--border`, …) through the shadow boundary, each with a neutral fallback. Move the handle with `--broberg-consent-reopen-x` / `-y`. **Move the banner itself** with `--broberg-consent-banner-bottom` and `--broberg-consent-banner-left` (since 0.5.1; default 24px, 12px on screens under 520px), e.g. `broberg-consent { --broberg-consent-banner-bottom: 72px }` when a fixed bar of your own (cms inline-edit «Rediger · Log ud») sits in the bottom-left corner. It applies on desktop and mobile.
- **Compact on phones (since 0.6.0, the default for every site):** under 520px the banner is one row — «Tilpas» as a text link, then «Afvis alle» and «Accepter alle» as two equal buttons — and the heading is hidden visually (screen readers still get it). Measured with Lens on a 393×852 phone: 254px → 127px high with the default Danish text; 143px at 320px wide in English. The consent text is never shortened. Desktop is unchanged.
- **Built in, not configurable** (it is the law): «Afvis alle» and «Accepter alle» have the same style and size; no optional category starts on; withdrawing clears the record.
## Nothing marked runs before consent (since 0.3.0)

Mark what may only run with consent. Everything unmarked (app code, login, payments, session cookies) runs as before; nothing is intercepted.

```html
<script type="text/plain" data-consent="analytics" src="https://plausible.io/js/script.js"></script>
<script type="text/plain" data-consent="marketing">/* inline pixel */</script>
<iframe data-consent="marketing" data-consent-src="https://www.youtube-nocookie.com/embed/…"></iframe>
```

- A granted script is recreated and runs **once**, in document order (add `data-type="module"` for a module). A returning visitor's stored choice runs them on load.
- An iframe gets its `src` only after its category is granted.
- `consent-mode` on the element sends Google Consent Mode v2: `default` = denied, then `update` with the choice. Without the attribute, `gtag`/`dataLayer` are never touched.
- **Withdrawing after something ran reloads the page**: a tracker that already ran cannot be un-run. The link says so first («Træk samtykke tilbage (siden genindlæses)»).
- **The one way this can hurt a site:** marking a script it NEEDS (login, checkout). Mark only trackers.

## The choice is a cookie, renewed yearly (since 0.3.0)

The element stores the choice in a first-party cookie `broberg-consent` (Max-Age 365 days, Path=/, SameSite=Lax, Secure on https). The server can read it. Storing the choice itself needs no consent, because it is strictly necessary. A choice older than 12 months asks again (Danish practice is to renew at least yearly). `cookie-domain=".broberg.ai"` shares one choice across subdomains. `storage-key` renames the cookie.

**Not yet:** a consent log (F014.10), and one hosted script with one approved text for every site (F014.14).

The headless core below is unchanged and still exported from `.`.


The **headless core** for a GDPR consent / cookie banner. The banner *UI* is
copy-owned per brand (each product owns its policy text, categories and tokens),
but the consent *logic* — what counts as valid consent, when to re-surface after
a policy change, essential-always-on, the right to withdraw — is easy to get
subtly (and legally) wrong. This package owns that correct, tested state machine,
framework-free and SSR-safe.

```bash
npm i @broberg/consent-cookie
```

## Usage

```ts
import { createConsentManager } from "@broberg/consent-cookie";

const consent = createConsentManager({
  policyVersion: "2026-05",          // bump this when your policy changes → banner re-surfaces
  storageKey: "acme-consent",        // localStorage key (or pass your own `storage`)
});

if (consent.needsBanner()) showBanner();   // first visit OR policy changed

// user actions
consent.acceptAll();                        // grant every category
consent.rejectAll();                        // essential only
consent.setConsent({ analytics: true });    // granular; essential forced on, unlisted off

// gate side-effects
if (consent.has("analytics")) loadAnalytics();

// GDPR right to withdraw — clears consent, banner returns
consent.withdraw();

// react to changes anywhere
const off = consent.subscribe((record) => sync(record));
```

## What it gets right

- **Policy-version re-surface.** `needsBanner()` / `isOutdated()` return true when
  there is no record, when the stored `policyVersion` differs from the current one,
  or when a legacy record has no version — so a policy update re-asks users instead
  of silently keeping stale consent.
- **Essential is always on.** Essential categories can't be toggled off; `has("essential")`
  is `true` even before any decision.
- **Right to withdraw.** `withdraw()` clears the record — a legal requirement most
  hand-rolled banners forget.
- **SSR-safe + injectable storage.** `createLocalStorageConsentStorage(key)` degrades
  to memory when there's no DOM; implement `ConsentStorage` to persist server-side
  (wire it to a profile row) without changing any call sites.

## API

```ts
createConsentManager({ policyVersion, categories?, storage?, storageKey? }): ConsentManager
// getRecord · needsBanner · isOutdated · has(category) · acceptAll · rejectAll
// setConsent(selection) · withdraw · subscribe · categories

interface ConsentStorage { get(): ConsentRecord | null; set(r): void; clear(): void }
createLocalStorageConsentStorage(key)   // SSR-safe, falls back to memory
createMemoryConsentStorage()
CONSENT_CATEGORIES                       // default: essential · analytics · marketing (overridable)
```

The React / Preact banner + granular-toggle modal (built on shadcn Dialog/Switch,
on your tokens) are copy-owned adapters shipping on top of this core.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
