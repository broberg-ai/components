# F110 — @broberg/legal: one set of legal documents, the same text everywhere, in every language

**Status:** planned — written 31 Oct 2026 (dansk tid) on the owner's order, before any code.
**Owner of the package:** components. **Owner of the WORDING:** Christian, after legal review.

> **NOT LEGAL ADVICE.** The texts this epic produces are drafts. Nothing ships to a public page
> before a qualified lawyer / DPO has reviewed the Danish master text (F110.3 AC). The package is
> the mechanism; the wording is a decision.

## Open questions — answered by the owner before the texts are written

1. **Retention — purpose-bound, Meta's model (owner, 31 Oct: «JEG vil ikke være ringere stillet» than
   Facebook).** Not one number for everything: data is kept **as long as its purpose needs it**, with
   the criteria and examples written out (Meta's wording, measured below). Proposed: (a) data that
   IS the product — Jam content, helpdesk cases, account — for the account's lifetime; (b) the
   **analysis copy** of conversations, pseudonymised, **max 6 months** (Meta deletes search metadata
   it does not need within six months too); (c) genuinely anonymous aggregates without limit;
   (d) deletion on request within 90 days, backups within a further 90 (Meta's own figures).
   The owner confirms or changes (a)–(d).
2. **Where we are a PROCESSOR** (customer platforms: fd-sundhed, sanneandersen, customer sites),
   the conversations are the customer's. Our own product analysis on them is only lawful if the
   DPA says so and the customer has a basis for it. Recommendation: **excluded by default**,
   opt-in per customer in the DPA.
3. **Health data (art. 9)** — fd-sundhed is a health platform. Legitimate interest cannot carry
   art. 9 data. Recommendation: **never in product analytics** unless filtered out first or an
   explicit art. 9(2) basis exists.
4. **Who reviews the texts** (lawyer / DPO), and is **Danish the governing language** when the
   English translation differs? Recommendation: yes, Danish prevails.
5. **Hosted endpoint domain** — ANSWERED 31 Oct: `legal.broberg.ai`. Danish prevails («we are a danish company»).

## Motivation

The owner, 31 Oct 2026: *«et generisk DA/EN API hvor ALLE vores sites/apps/platforme/agenter/tools
etc kan hente og vise/visuelt formatere en GDPR så vi bruger den samme ALLE steder … De må ikke
indholdsmæssigt ændres men de må gerne styles og ombrydes … ALLE data skal være 100% ens.»* And:
*«Skal laves med i18n … så de nemt kan oversættes og vises på flere sprog via samme API.»*

Today every product writes its own: broberg.ai/privatliv, /trust, jams.party/privatliv,
/sikkerhed, /vilkaar. They are honest and well written — and already drifting (Jam has its own
processor table; broberg.ai's lists 22 vendors). Five hand-written copies of the same legal
facts is the drift this repo exists to prevent.

## Measured before planning

- The five pages, read in full (31 Oct). Two PROMISES conflict with conversation analysis and
  must be changed **before** any conversation is stored for it:
  - broberg.ai (Aidan): *«Samtalen gemmes udelukkende i din egen browser — ikke på vores server»*.
  - jams.party/vilkaar: *«Vi bruger det kun til at levere tjenesten til dig»*; /privatliv:
    *«Oplysningerne bruges kun til at give dig Jam»*.
  A new purpose cannot be applied retroactively to data collected under the old promise.
- **Anonymising chat text is not solved.** `@broberg/secret-scan` 0.15.0 (F079.6, today) finds
  CPR, phone and e-mail and states in its own result that NAMES, addresses and health details are
  NOT examined. So the honest promise is *pseudonymised*, not *anonymised* — and pseudonymised
  data is still personal data (retention, rights, LIA all apply).

## Benchmark: Meta, read 31 Oct 2026 (the owner asked)

Read in full from the printable privacy policy (effective 23 July 2026, 31,924 words) and the terms
(5,916 words). What we can match — lawfully — and what Meta was fined for:

| Meta does | Lawful for us? |
|---|---|
| Retention «as long as we need it … case by case», with listed criteria and concrete examples | **Yes** — adopted as the retention model (Q1) |
| Account content kept for the account's lifetime; unneeded search metadata deleted within 6 months | **Yes** — same split: product data vs. analysis copy |
| «Develop, research and test improvements» on legitimate interests, with a right to object | **Yes** — our conversation-analysis basis, with an LIA |
| A legal-basis table per purpose (consent / contract / legitimate interest / legal obligation) | **Yes** — adopted as the structure of `privacy` |
| Special-category data only with **explicit consent** | **Yes** — matches Q3 |
| Deletion within 90 days, backups within a further 90 | **Yes** — Q1 (d) |
| Behavioural ads on «contract» because the user accepted the terms | **No** — Irish DPC fined Meta EUR 390m for exactly that (Jan 2023); CJEU C-252/21 (4 Jul 2023) |
| Personal data to the US without adequate safeguards | **No** — EUR 1.2bn fine (May 2023); we stay EU-first |

So the owner is not worse placed than Meta on what is lawful: same breadth of purposes, same
retention model, same legal-basis structure. What we deliberately do not copy is what Meta paid for.

## Design

### Five documents (the owner's "3-4", plus the support agreement added 31 Oct)

| id | Danish title | what it is | accepted? |
|---|---|---|---|
| `terms` | Vilkår for brug | the agreement for using our products | **YES** — clickwrap |
| `privacy` | Privatlivspolitik | information about processing (incl. the new section *Analyse af samtaler for at forbedre vores produkter*) | **NO** — informed, never "accepted" |
| `trust` | Tillid og sikkerhed | where data lives, sub-processors, security controls | no |
| `dpa` | Databehandleraftale (skabelon) | B2B, when we process for a customer | signed (Contract Manager) |
| `support` | Supportaftale (skabelon) | B2B support terms — owner 31 Oct: «support aftale skal også være med i vores faste API» | signed (Contract Manager) |

**The acceptance clause, done the legally sound way:** `terms` carries a fixed clause — *by
creating an account or using the service you accept these terms* — **and** every product asks
for an active acceptance (an unticked checkbox / an explicit button) at sign-up, recorded with
the version. Continued use after notice covers non-material changes; material changes ask again.
The privacy policy is **not** accepted: GDPR consent cannot be bundled into terms, and the
processing rests on the bases the policy names (6.1.b contract, 6.1.f legitimate interest after a
documented LIA, 6.1.c legal obligation), never on "you accepted our privacy policy".

### Content is data; presentation is the site's

- One **master text per document in Danish**, stored as structured JSON: `sections[] → { id,
  heading, blocks[] }` with block types `p`, `list`, `table`, `note`, `contact`. Stable ids per
  section AND paragraph, so a translation, a diff and a link all address the same thing.
- **Product facts are data, not prose.** What differs per product (which data categories, which
  sub-processors, where it runs, whether conversation analysis applies) lives in ONE product
  registry inside the package (`products/jam.json`, `products/broberg-ai.json`, …). Fixed
  templates turn facts into sentences, so two products with the same facts get byte-identical
  text, and a site can never word its own exception.
- **Sites may style and re-flow, never edit.** The API returns blocks; a site renders them with
  its own components. A provided renderer (`renderHtml`, a Preact/React component) exists for
  convenience; nothing forces it.
- **Every document carries `version` (date), `effectiveFrom`, and `contentHash`** (sha256 of the
  canonical JSON). A site shows the version; an acceptance records version + hash, so "which text
  did this user accept?" has an exact answer.

### i18n (the owner's follow-up)

- `getDocument({ doc, locale, product })`, locales **`da`** (master) and **`en`** at launch; more
  languages are files, not API changes.
- **Structural parity is a test, not a hope:** every locale must have exactly the master's
  section and block ids, in the same order; a missing or extra paragraph fails the build.
- A translation carries `translationOf: { version, contentHash }` of the Danish master, so a
  stale translation is detectable (the master moved, the English did not) — and the API reports
  it instead of serving it as current.
- Builds on `@broberg/i18n`'s locale conventions (BCP-47 tags, fallback rules) rather than a
  second locale system; the documents themselves are content, not UI message catalogs.

### Two ways to read it

1. **npm** `@broberg/legal` — zero-dependency, the documents bundled; works in Next, Vite+Preact,
   Bun, Node.
2. **Hosted JSON** (for Swift apps, agents, tools in other languages) — the SAME bundle served
   read-only, e.g. `GET https://legal.broberg.ai/v1/{product}/{doc}.{locale}.json`, with ETag =
   contentHash. One source: the endpoint serves the published package, never a second copy.

### Acceptance record helper

`recordAcceptance({ subject, product, doc:'terms', version, contentHash, at })` shape + a
`needsReaccept(record, current)` that answers yes on a material change. Storage stays in each app
(as with chat retention: a storage-free package cannot own rows) — the package owns the shape and
the decision, the app owns the row.

## Stories

- **F110.1** Decisions + LIA template — the five open questions answered and recorded; an LIA
  template for "conversation analysis for product improvement" in `docs/legal/`.
- **F110.2** The package: schema, `getDocument`, versions + content hash, parity test, renderer.
- **F110.3** The Danish master texts for the four documents, built from the five existing pages
  and the conversation-analysis standard — reviewed by a lawyer before publication.
- **F110.4** English translation with structural parity and staleness detection.
- **F110.5** Hosted JSON endpoint (owner's yes for the domain).
- **F110.6** Acceptance: clickwrap guidance + `needsReaccept`.
- **F110.9** Contract Manager's default DPA built on `dpa` — analysis is the default, the customer may object.
- **F110.10** The support agreement as the fifth document; Contract Manager generates its support agreement and DPA from legal.broberg.ai (merge fields as placeholders, version + contentHash stored on every signed contract).
- **F110.7** Rollout: broberg.ai and jams.party render from the package; their conflicting
  promises are changed and users notified BEFORE any conversation is stored for analysis.

## Non-goals

- **The conversation-analysis pipeline itself** (collection, pseudonymisation, 6-month deletion
  job). That is technical enforcement and its own epic; this one is the text and the API. The
  text must not promise anything the pipeline does not yet do — F110.7 is gated on it.
- Writing law. The package carries reviewed text; it does not decide what is lawful.
- Customer-owned policies on sites we run for others (there the customer is controller).

## Reuse (F217 — Discovery checked 31 Oct: privacy, legal, gdpr, terms, privatlivspolitik, retention, dpa, consent, i18n)

Nothing owns legal documents. Reused, not rebuilt:
- `@broberg/i18n` (trail) — locale tags and fallback.
- `@broberg/consent-cookie` — the cookie section links to its banner; no second cookie text.
- Contract Manager (contracts.broberg.ai) — signing the DPA.
- `@broberg/secret-scan` — the pseudonymisation promise is worded to what it actually does
  (`notExamined`).

## Dependencies

- A lawyer/DPO review (owner names who).
- DNS for the hosted endpoint (owner's yes; cardmem creates it).
- The conversation-analysis pipeline epic (to be planned) before F110.7 can switch analysis on.

## Rollout

1. Owner answers the five questions (F110.1).
2. Package + Danish drafts (F110.2, F110.3) → lawyer review → English (F110.4).
3. broberg.ai and jams.party switch to the package (F110.7) — the old promises change, users are
   told, THEN analysis may start in the products where it is lawful.
4. Release report to every consumer; Discovery row.
