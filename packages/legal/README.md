# @broberg/legal

**Status: 0.1.0 — every document is a DRAFT (`draft: true`, rendered as «UDKAST») until the owner's lawyer has reviewed it (F110.3).**

One set of legal documents for every broberg.ai product — `terms`, `privacy`, `trust`, `dpa`,
`support` — the same text everywhere, Danish as the master (Danish prevails), English beside it.
Sites **style and re-flow**; they never edit. Served as npm and at `legal.broberg.ai` (F110.5).

**Using the HTTP service? Cache it (F110.13).** The texts change only when legal.broberg.ai is
redeployed, and the service runs cold (no machine while nobody asks — the first call after a quiet
spell takes a second or two). Every answer carries `cache-control: public, max-age=86400,
stale-while-revalidate=604800` and an `ETag` (= `contentHash`). Keep your copy, and when it is a day
old ask again with `If-None-Match: <etag>` — an unchanged text answers an empty `304`. The **npm
package does not call the service at all**: the texts ship inside it, so a site built with it needs
no network for them.

```ts
import { createLibrary, renderHtml } from "@broberg/legal";
const doc = library.getDocument({ doc: "privacy", locale: "da", product: "jam" });
doc.version; doc.contentHash; doc.stale; doc.sections; // sections → blocks with stable ids
renderHtml(doc); // semantic HTML, data-legal-id on every section and block
```

- **Content is data:** sections → blocks (`p`, `note`, `list`, `table`) with ids that are the
  same in every locale. **Product facts** (hosting, data categories, sub-processors, whether
  conversation analysis applies) come from one registry and are turned into text by fixed
  per-locale templates — a site cannot word its own exception.
- **contentHash** = sha256 of the canonical JSON of the resolved document. An acceptance or a
  signed contract records version + contentHash, so "which text?" has an exact answer.
- **stale:** a translation made from an older master is still returned but marked stale.
- **Placeholders** (`{customer.name}` …) are a fixed list; an unknown one is refused.
- Zero dependencies (a built-in SHA-256, proven against FIPS vectors and node:crypto).

Plan: `docs/features/F110-legal-documents.md`.
