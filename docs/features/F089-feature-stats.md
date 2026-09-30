# F089 — `@broberg/feature-stats`: which features are actually used

## Motivation

Christian's idea (inbox, dispatched 1/10 2026): *"NPM module to track stats on feature usage in an app/platform. Reusable in both stack A + B."*

The question every product in the fleet has and none can answer from data: **which features are used, how often, and which are never used** (the ones we could remove or should explain better). Today the only signal is someone remembering to ask.

## Assumption (stated, since the dispatcher asked us not to ask)

**Aggregate counts, not per-user tracking.** A row is `(feature, day, count)`. No user id, no session, no IP, no page path, no cookie.

Why this is the reasonable default and not a limitation we backed into:

- It is the same line the fleet already drew for `@broberg/device-stats` (D-aaf46c): a named person plus what they did is personal data, and on a health or clinic site it can be special-category data. An aggregate count of `export.pdf` on a day is neither.
- It needs no consent prompt: nothing is stored on or read from the device. [Likely, not legal advice. Same reasoning as device-stats Tier 0.]
- It answers the product question ("is X used?") fully. The per-user question ("who uses X?") is a different module with a different legal profile. If Christian wants that, it is a new card, not an option on this one.

## Scope

**Core (`@broberg/feature-stats`, framework-free, zero deps):**

- `defineFeatures(['export.pdf', 'chat.send', …] as const)`: the ONE list of feature keys, typed. `track('exprot.pdf')` is a type error, not a silent new row.
- `createFeatureStats({ features, store, onError?, now? })` → `track(feature, n = 1)`: **fire-and-forget** (never throws into or blocks the feature it measures; store failures go to `onError`), and `read({ since?, until? })`.
- **Unknown or malformed keys are refused at runtime too** (`onError`, not recorded). That covers the untyped path (a beacon from the browser) and is also the privacy guard: a key like `open-doc-<userId>` can never become a row, because the list is fixed at build time.
- `summarize(rows, features)` → per-feature totals, sorted, **including declared features with 0 uses**. The zeros are the point.
- `createMemoryFeatureStore()` for tests/SSR.
- `createSqlFeatureStore(db, { dialect: 'sqlite' | 'postgres', table? })`: persistence through anything with `execute({ sql, args })`. `@broberg/db-sdk`'s `DbClient` fits structurally, so there is no hard dependency. Upsert with `ON CONFLICT (feature, day) DO UPDATE SET count = count + excluded.count` (both dialects). `migrate()` creates the table.

**Bindings (thin, per stack):**

- `/hono`: `featureStatsRoute(stats)`, a POST handler for browser beacons (Stack B).
- `/next`: `featureStatsHandler(stats)`, an App Router `POST` route handler (Stack A).
- `/client`: `trackFeature(feature, { endpoint })` via `navigator.sendBeacon` (fetch keepalive fallback). No storage, no identifiers, never throws.

Server-side `track()` inside the feature's own handler is the primary path; the beacon exists for features that live only in the browser.

## Non-goals

- Per-user or per-session analytics, funnels, retention cohorts.
- Page/URL analytics (explicitly a separate module per D-aaf46c).
- A dashboard UI. `summarize()` returns data; rendering is the app's (or a later card's).
- Tenant/customer dimension. It is useful for platforms, but a sole-trader tenant is a person. Revisit on request.

## Architecture

```
app code ── track('export.pdf') ──► FeatureStats ──► FeatureStore.increment(feature, day, n)
browser ── sendBeacon ──► /hono | /next handler ──┘        ├─ memory
                                                            └─ sql (db-sdk / any execute())
read({since}) ──► rows ──► summarize(rows, features) ──► [{feature, count}] incl. zeros
```

`day` is the UTC date `YYYY-MM-DD` (storage is UTC; a human-facing render formats it in Europe/Copenhagen, per fleet rule).

## Stories

- **F089.1**: core: defineFeatures, createFeatureStats (track/read), refusal of unknown keys, memory store, summarize with zeros.
- **F089.2**: SQL store: sqlite + postgres upsert, migrate, read-back proven against a real libSQL file DB.
- **F089.3**: bindings: /hono, /next, /client beacon, each refusing unknown keys with 400 and never throwing.
- **F089.4**: publish 0.1.0 (bootstrap needs Christian's npm OTP; see CLAUDE.md), Discovery roster, README.

## Reuse

Discovery searched 1/10 2026 (`feature usage stats`, `analytics`): nearest are `@broberg/device-stats` (device only, deliberately no path/user; different question) and `@broberg/event-log` (append-only per-event audit log with actor; wrong shape for counting, and it carries an actor). Neither answers "how often is feature X used". Build, reusing: `@broberg/db-sdk` for persistence (structural interface, no hard dep), and device-stats' Tier-0 privacy reasoning. No provider SDK involved.

## Acceptance (epic)

- Both stacks can count a feature server-side and from the browser, persist to Turso/SQLite or Postgres, and list every declared feature with its count, including those at zero.
- No row can carry anything but a declared feature key, a UTC day and a count.
