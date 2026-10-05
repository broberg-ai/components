# F097 — Analytics in the app shell: the app's own visitor numbers from Upmetrics

> Epic · app-shell (Preact) + a small server helper · effort M · status: planned (5/10)

## Summary
Every app built on the shell gets an «Analytics» page in its sidebar, showing its own visitors, page views, a per-day chart and its most visited pages for the last 7, 30 or 90 days, using the numbers Upmetrics already collects. Apps do not need to copy any code for it. The secret Upmetrics key stays on the app's server, and a missing or failing Upmetrics shows a clear message instead of zeros that look real.

## Motivation
Christian 5/10, via appkit (#1865): «Lav integration til at vise app'ens egen statistik fra Upmetrics, det er det nye Analytics der skal merges i app-shell». appkit already built it once in its starter (appkit 9e8632d: `starters/lean/src/web/pages/Analytics.tsx` + `src/server/analytics.ts`, Lens-proven against Upmetrics' own figures for the same period). Today every other app would have to copy those two files. The decision D-a84d0a puts shared UI in the shared package, not in copies.

## Solution
Lift appkit's page into `@broberg/app-shell` as `AnalyticsPage`, fed through an adapter whose default is `fetch('/api/analytics?days=N')`, the same pattern as `AccountPage` (F095.3). The server half is a small Hono helper that calls `fetchAnalytics` from `@upmetrics/sdk` with the app's `UPMETRICS_API_KEY` and answers JSON or a named error. Where that helper lives is the one open question (below).

## Reuse
- **Upmetrics analytics:** `@upmetrics/sdk` ≥0.9.0, `fetchAnalytics({ projectKey, days })` → `AnalyticsResponse`. Reuse it; never a raw `fetch` to upmetrics.org.
- **Shell UI:** `@broberg/app-shell` `PageHeader`, tokens from `@broberg/theme`. Reuse.
- **Discovery search "analytics"** (5/10): only `@broberg/device-stats` (which devices, not visitor counts), so no match for this. Build.
- **Charting:** no `@broberg/*` chart package. A plain CSS-bar series as in appkit's reference, no chart library. Load the `dataviz` skill before writing the chart.

## Design
Design consult 5/10: **`silent`**. components' DESIGN.md has no rules for an analytics or stat-tile surface. That is a gap, not permission. Match the nearest existing surface (AccountPage, F095.3, same card and border tokens) and propose the stat-tile pattern back into the guide (F280.11) once it has shipped. The always-on rules bind:
- **No sideways page scroll at 393 px.** Long page paths in the top-pages list truncate inside their row. The series chart shrinks its bars (`min-width: 0`), never the page.
- **Button labels never wrap** (`white-space: nowrap` on the period toggle).
- **No native controls.** The period toggle is three custom buttons with `aria-pressed`, not a `<select>`.

## Scope

### In scope
- `packages/app-shell/src/index.ts`: `AnalyticsData` type (structural, same shape as `AnalyticsResponse`: `totals` / `prev` {visitors, pageviews}, `series[]` {day, visitors, pageviews}, `topPages[]` {value, count}), `AnalyticsAdapter { load(days) }`, `createFetchAnalyticsAdapter({ url? })`, `AnalyticsError(status, code)`, `fillDays(series, days, today)`, `changePct(now, before)`.
- `packages/app-shell/src/preact.tsx`: `AnalyticsPage({ lang, adapter?, periods? })` with a period toggle (7/30/90, `aria-pressed`), two stat tiles with the change against the previous period («ingen sammenligning» when the previous period is 0), a per-day page-view series with empty days filled, top pages, and loading / unconfigured / unavailable / empty states. TEXT strings in da + en.
- `packages/app-shell/css/app-shell.css`: `.bas-analytics*` on theme tokens.
- The server helper: `analyticsRoutes({ projectKey? })` for Hono. `GET /?days=N` clamps days to 1..365 and answers `AnalyticsResponse`, `503 {error:"analytics_unconfigured"}` without a key, or `502 {error:"analytics_unavailable"}` when Upmetrics fails. The key never appears in a response or a log line. `Cache-Control: no-store`. It requires the app's session (the caller mounts it behind `sso.require`).
- README sections in both packages, and a Discovery row update on release.

### Out of scope
- Any Upmetrics data beyond what `fetchAnalytics` returns today (referrers, devices, funnels).
- An admin/role check inside the helper. Who may see analytics is the app's decision, made where it mounts the route.
- A chart library, tooltips beyond `title`, and CSV export.
- Changing Upmetrics' bucketing or adding endpoints to Upmetrics.
- The sidebar entry itself. Apps add `{ label: "Analytics", href: "/analytics" }` to their nav, as with every other page.

## Architecture

### Client (app-shell, framework-free core + Preact)
```ts
export interface AnalyticsData {
  totals: { visitors: number; pageviews: number };
  prev: { visitors: number; pageviews: number };
  series: { day: string; visitors: number; pageviews: number }[]; // day = YYYY-MM-DD
  topPages: { value: string; count: number }[];
}
export interface AnalyticsAdapter { load(days: number): Promise<AnalyticsData> }
export function createFetchAnalyticsAdapter(o?: { url?: string; fetch?: typeof fetch }): AnalyticsAdapter; // GET {url ?? "/api/analytics"}?days=N, non-2xx → AnalyticsError
```
app-shell does NOT depend on `@upmetrics/sdk`. The type is structural, so an `AnalyticsResponse` fits it without an import, and apps that do not use Upmetrics pay nothing.

### Server helper
`analyticsRoutes({ projectKey = env.UPMETRICS_API_KEY, fetchAnalytics? })` → a Hono app. It is the appkit `analyticsResult` + `clampDays` logic, unchanged in behaviour.

## Stories
- **F097.1** — app-shell 0.5.0: `AnalyticsPage` + adapter + `fillDays`, every state, da/en, data-testids (vitest).
- **F097.2** — `analyticsRoutes()` from `@upmetrics/sdk/hono` (built by upmetrics, #1879): verify its contract (200 / 503 / 502, days clamped, key never in a response) and document mounting it next to AnalyticsPage.
- **F097.3** — Release + pilot: publish, Discovery row, appkit swaps its own page for the shared one, and Lens at 393/1440 matches Upmetrics' own numbers.

## Acceptance criteria
1. With a fake adapter, `AnalyticsPage` shows visitors and page views with the change against the previous period, and «no comparison» when the previous period is 0. **Measured in vitest** on the rendered DOM; a pure render, so the test sees every way it can be wrong.
2. `fillDays` returns exactly `days` entries ending today, keeping Upmetrics' values and putting 0 on missing days. **Measured in vitest** with a fixed `today`, including a month boundary.
3. 503 shows «Analytics er ikke sat op» and 502 shows «Upmetrics svarer ikke lige nu». Neither shows zeros. **Measured in vitest** on the page with the default fetch adapter against a stubbed fetch, which is the same path the real page takes.
4. `analyticsRoutes` without a key → 503 `analytics_unconfigured`; a throwing `fetchAnalytics` → 502 `analytics_unavailable`; `days=999` → 365; the key string appears in no response body. **Measured in vitest** against the Hono app.
5. In appkit, after the swap, the page's totals equal Upmetrics' own API for the same period and the page does not scroll sideways at 393 px. **Measured by Lens on appkit's deployed build** with `critic:"dom"`, because only the live build can see a wrong key, a wrong mount or a wiggle.

## Dependencies
- F095 is first in line (owner priority, appkit #1865).
- `@upmetrics/sdk` ≥0.9.0 (`fetchAnalytics`, `AnalyticsResponse`).

## Rollout
Additive: a new export in app-shell 0.5.0 and a new helper. Nothing changes for apps that do not mount it. Rollback is the previous version, with no data or migration involved.

## Open Questions
None. Both were answered by upmetrics on 5/10 (#1879):
1. **`analyticsRoutes()` lives in `@upmetrics/sdk/hono`, built by upmetrics.** It has exactly the contract above. So F097.2 here becomes: adopt it and document mounting it, and app-shell gets NO dependency on Hono or the SDK. upmetrics will report the version.
2. **`series[].day` is Europe/Copenhagen** (upmetrics' `copenhagenDayKey` days), ordered and ending today. So `fillDays` fills on the Copenhagen calendar, NOT UTC as appkit's reference does. That reference is off by one day between midnight and 01:00/02:00 Danish time. Test it with a `today` at 23:30Z.

## Effort estimate
**M**: about 1 day (F097.1 half a day, F097.2 two hours, F097.3 the rest).
