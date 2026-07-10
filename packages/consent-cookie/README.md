# @broberg/consent-cookie

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
