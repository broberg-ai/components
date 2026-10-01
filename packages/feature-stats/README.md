# @broberg/feature-stats

**Which features are actually used, and which never are.** Aggregate per-day
counters, `(feature, day, count)`, and nothing else: no user id, no session, no
IP, no page path, no cookie.

```bash
npm i @broberg/feature-stats
```

## Why only counts

The question is "is export-to-PDF used?", not "who used it". A count of
`export.pdf` on a day is not personal data, and it needs no consent prompt,
because nothing is stored on or read from the device. *(Same reasoning as
`@broberg/device-stats` Tier 0. This is our reading, not legal advice.)* The
moment a user id enters, it becomes "this named person did this", which on a
health or clinic site is special-category data. That is a different module.

The list of feature keys is fixed at build time and enforced at runtime too, so
a key like `open-doc-<userId>` can never become a row, even from a browser
beacon.

## Use: server side (both stacks)

```ts
import { createFeatureStats, createSqlFeatureStore, defineFeatures, summarize } from "@broberg/feature-stats";
import { createClient } from "@broberg/db-sdk";

export const FEATURES = defineFeatures(["export.pdf", "chat.send", "share.link"] as const);

const store = createSqlFeatureStore(createClient(), { dialect: "sqlite" }); // or "postgres"
await store.migrate();

export const stats = createFeatureStats({ features: FEATURES, store, onError: console.error });

// inside the feature itself:
stats.track("export.pdf");      // fire-and-forget: never throws, never waits
stats.track("exprot.pdf");      // ✗ type error, and refused at runtime too

// the report:
summarize(await stats.read({ since: "2026-09-01" }), FEATURES);
// [{ feature: "chat.send", count: 812 }, { feature: "export.pdf", count: 40 }, { feature: "share.link", count: 0 }]
//                                                                             ^ the zeros are the point
```

`day` is the **UTC** date (`YYYY-MM-DD`). Format it for people in
`Europe/Copenhagen`.

## Use: from the browser

For features that live only in the browser. Mount the handler on the server,
call `trackFeature` in the client.

```ts
// Stack B (Hono)
import { featureStatsRoute } from "@broberg/feature-stats/hono";
app.post("/api/feature-stats", featureStatsRoute(stats));

// Stack A (Next App Router): app/api/feature-stats/route.ts
import { featureStatsHandler } from "@broberg/feature-stats/next";
export const POST = featureStatsHandler(stats);

// browser
import { trackFeature } from "@broberg/feature-stats/client";
trackFeature("export.pdf", { endpoint: "/api/feature-stats" });
```

The handler answers `204` when it counted and `400` (nothing counted) for bad
JSON, an undeclared key or a body over 1,024 characters. `trackFeature` uses
`navigator.sendBeacon`, falls back to `fetch` with `keepalive`, and never throws.

**The endpoint is unauthenticated by design.** Anyone who can reach it can add
to a declared counter, but cannot create a new one. If inflated counts would
matter to you, mount it behind your app's own auth middleware.

## Storage

`createSqlFeatureStore(db, { dialect, table? })` works with anything that has
`execute({ sql, args })`: `@broberg/db-sdk`'s `DbClient` and a raw
`@libsql/client` both fit as-is. One row per `(feature, day)`, upserted with
`count = count + excluded.count`. `createMemoryFeatureStore()` is for tests.

Your own store only needs `increment(feature, day, by)` (which must **add**)
and `read({ since?, until? })`.

## Not in scope

Per-user or per-session analytics, funnels, page/URL analytics, a dashboard,
a tenant dimension.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
