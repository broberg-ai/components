# @broberg/legal

**Status: 0.2.0. Every document is a DRAFT (`draft: true`, rendered as «UDKAST») until the owner's lawyer has reviewed it (F110.3).**

One set of legal documents for every broberg.ai product: `terms`, `privacy`, `trust`, `dpa` and
`support`. The text is the same everywhere. Danish is the master and prevails; English sits beside it.
**components writes the text; each product fills in its OWN facts and shows the documents on its OWN
site.** legal.broberg.ai is an API, not a website: anything there that is not the API sends visitors
to broberg.ai.

---

## MUST: how a product shows its legal documents

Every product with a visible service shows these documents and never writes its own (owner decision
D-7effa0). This is a fixed onboarding step for every new project (the TERMS/GDPR card). Six steps:

### 1. Write your product's facts, once, in YOUR repo

The texts have open slots (`facts` blocks) for what differs per product. You fill them with a
`ProductFacts` object kept in your own repo, for example `legal/facts.ts`:

```ts
import type { ProductFacts } from "@broberg/legal";

export const FACTS: ProductFacts = {
  id: "jam",                       // your product id: lower-case, stable
  name: "Jam",                     // the name users know
  hosting: [                       // where data is stored and processed
    { what: "Appen", where: "Stockholm, Sverige (EU)" },
    { what: "Databasen", where: "Amsterdam, Holland (EU)" },
  ],
  dataCategories: [                // what personal data you hold
    "Navn, e-mail og profilbillede fra login",
    "Dit indhold, som du selv gemmer",
  ],
  subprocessors: [                 // every vendor that touches personal data
    { name: "Fly.io", purpose: "Drift af app og database", location: "Sverige og Holland", transfer: "Databehandleraftale med EU-standardkontrakter" },
  ],
  conversationAnalysis: true,      // does the four-part conversation analysis apply?
  healthData: false,               // health data (GDPR art. 9)? physio apps: read docs/guides/health-data-physio.md
};
```

- List only facts that are TRUE today. If you are unsure, leave it out and ask; never guess.
- Facts are data, never prose. Do not type a vendor name or an exception into the text. The package
  turns your facts into tables and sentences through fixed templates.
- The facts change when your product changes (a new vendor, a new region). Update the file in the
  same change.

### 2. Get the texts: the npm package (recommended for JS/TS)

```ts
import { getDocument, renderHtml } from "@broberg/legal";   // pin an exact version
import { FACTS } from "./legal/facts";

const doc = getDocument({ doc: "privacy", locale: "da", facts: FACTS });
doc.title; doc.version; doc.effectiveFrom; doc.draft; doc.contentHash;
renderHtml(doc);   // semantic HTML with data-legal-id on every section and block; style it yourself
```

The texts ship **inside** the package, so your site needs no network for them and cannot lose them
when legal.broberg.ai is down. New texts reach you as a new package version; components sends a
release report saying whether the wording changed.

### 3. Or get them over HTTP (any stack)

```
GET https://legal.broberg.ai/v1/documents              → { documents: [{ doc, locale, version, effectiveFrom, draft, hash }] }
GET https://legal.broberg.ai/v1/{doc}.{da|en}.json     → the template: sections with facts slots open, + version, draft, stale, hash
```

Fill the slots with your facts: in JS/TS, `resolveTemplate(template, FACTS)` from this package. In
another language, render each `facts` block like this: `hosting` is a table (What | Where);
`dataCategories` is a list; `subprocessors` is a table (Vendor | Used for | Where | Transfer);
`conversationAnalysis` is one sentence saying whether your product is covered by the section on
conversation analysis. A missing English translation falls back to Danish; `stale: true` means the
English text is older than the Danish one, so show the Danish one or a notice.

### 4. Cache: keep your own copy, and only fetch a new edition when there is one (HTTP route)

Your terms page must never go down because legal.broberg.ai is down or being updated.

1. **Keep a snapshot in your repo or build** (`legal/snapshot/{doc}.{locale}.json`, the templates as
   fetched). Your pages render from the snapshot. They never call the API on a page view.
2. **Check for a new edition at most once a day:** `GET /v1/documents` and compare each `hash` with
   your snapshot's. Same hash means there is nothing to do.
3. **Only when a hash changed:** fetch that template, check it (it parses, `hash` matches the list,
   `sections` is not empty), then replace the snapshot file in one step (write to a temp file, then
   rename).
4. **If anything fails** (timeout, 5xx, a check fails), keep the old snapshot, log it, and try again
   tomorrow. Never empty a page because a fetch failed.
5. Every answer carries an `ETag` and `cache-control: public, max-age=86400`. A request with
   `If-None-Match: "<hash>"` answers an empty `304` when nothing changed.

The service runs cold: the first call after a quiet spell takes a second or two. That is fine for a
daily check and one more reason never to call it on a page view.

### 5. Show the documents on YOUR site

- One page per document on your own domain, for example `/vilkaar`, `/privatliv`, `/tillid`.
  `dpa` and `support` belong in customer contracts (Contract Manager fills `{customer.name}` and the
  other placeholders); a public site shows `terms`, `privacy` and `trust`.
- Style and re-flow freely. **Never edit the text.**
- Show the version and the «gælder fra» date (`version`, `effectiveFrom`). While `draft` is true, show
  the «UDKAST» marker (`renderHtml` does it for you).
- Link all of them in your footer. **Never link users to legal.broberg.ai**; it redirects to broberg.ai.

### 6. Acceptance

Terms are accepted at sign-up with an **unticked** «Jeg accepterer vilkårene» checkbox; the privacy
policy is linked and shown, never "accepted". Store `{ doc, version, contentHash }` with the
acceptance, so "which text did they accept?" has an exact answer.

---

## Reference

- `getDocument({ doc, locale, facts })`: a finished document from the bundled templates plus your facts.
- `getTemplate({ doc, locale })`: the template, as the API serves it. `listDocuments()`: what `/v1/documents` serves.
- `resolveTemplate(template, facts)`: a finished document from a template you fetched. It gives the
  same `contentHash` as `getDocument` with the same facts.
- `renderHtml(document)`: semantic HTML. `EXAMPLE_FACTS`: a filled-in example.
- **contentHash** = sha256 of the canonical JSON of the finished document; **hash** = the same for a template.
- **Placeholders** (`{customer.name}` and the rest) are a fixed list; an unknown one is refused.
- Zero dependencies (a built-in SHA-256, proven against FIPS vectors and node:crypto).

**0.2.0 (F110.14), breaking:** the fleet product registry and `library` are gone, and
`getDocument` takes `facts` instead of `product`. The per-product HTTP routes and the human pages are
gone too: legal.broberg.ai is an API.

Plan: `docs/features/F110-legal-documents.md`, `docs/features/F110.14-legal-is-an-api.md`.
