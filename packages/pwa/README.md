# @broberg/pwa

The fleet's **PWA primitive**. Today it ships the piece four repos hand-rolled
independently — the *"a new version is available, tap to reload"* lifecycle —
as one small, framework- and bundler-agnostic package instead of a fifth copy.

```bash
npm i @broberg/pwa
```

## 0.4.0 — READ, don't remember (F054.8)

**Take 0.4.0.** Before it, `updateReady` could only ever go **up**, and only from
an event: one read of `registration.waiting` at attach, plus `updatefound`. The
interval and focus checks called `registration.update()` and never looked at
`registration.waiting` at all. So the banner got **exactly one chance to be
seen** — dismiss it once, or miss the seconds it was up, and nothing in the
package could raise it again for that tab. The client then sat on the old bundle
indefinitely.

It fails in the reassuring direction: deploy green, server on the new build,
feature live — and the only symptom available to anyone is a person saying a
feature is missing. That is how cardmem found it, in their own copy of this
pattern.

**What changes for you:**

| | 0.3.x | 0.4.0 |
|---|---|---|
| `updateReady` | rises once, ever | re-derived from `registration.waiting` on every interval / focus / visibility tick |
| `subscribe()` | emits at most **once** | emits whenever the answer moves, **in both directions** |
| "Later" | your problem | `snooze()` — 30 min by default, persisted, then it comes back |

**`updateReady` CAN NOW GO FALSE.** If your code assumes it only ever rises — a
`useState` you never reset, a banner you unmount by hand — read that line before
upgrading. Everything else is additive.

```ts
const { updateReady, applyUpdate, snooze } = usePwaUpdate();
// "Update" → applyUpdate()     "Later" → snooze(), NOT a local setState(false)
```

**The pattern to look for in your own code**, named by cardmem when they read
this report against their adoption — it is not hypothetical, it is what a
consumer writes when the flag can only ever rise:

```ts
// ⚠️ the 0.3.x shape: a local mirror, reset only on dismiss
const [needRefresh, setNeedRefresh] = useState(false);
useEffect(() => { if (updateReady) setNeedRefresh(true); }, [updateReady]);
const onDismiss = () => setNeedRefresh(false);   // ← the only way down
```

That mirror cannot fall when `updateReady` does, and dismissing it is permanent
— which is the original defect, reproduced one layer up. Drop the mirror and
render from `updateReady` directly; wire "Later" to `snooze()`.

So an upgrade here is a small **migration**, not a free version bump. It is the
one place 0.4.0 asks anything of you.

### Upgrading does NOT fix this on its own if you have your own dismissal

fd-sundhed found this by reading their own installed code rather than this
report, and it is the half that would otherwise produce a green claim and an
unchanged user. Their banner carries a second dismissal on top of the hook:

```ts
const [dismissed] = useState(() => sessionStorage.getItem(KEY) === "1");
if (!updateReady || dismissed) return null;   // "Later" hides it for the whole tab
```

The defect is **doubled** — ours in the hook, theirs in the component — and only
ours goes away with a `pnpm up`. Upgrade, report it fixed, and the person still
never sees the banner again.

**So before you upgrade, grep your own component for a second way the banner can
be hidden**: a `sessionStorage`/`localStorage` flag, a `dismissed` state, a
`useRef` that latches. Whatever holds it down has to become the snooze, or the
snooze is decorative.

### If you need something stricter than 30 minutes

`snoozeMs` is a plain number, so a large one is available and this package will
not stop you. The honest statement is therefore narrower than "a mute is
impossible": there is no OPTION named mute, and the default comes back.

If the policy you actually want is *"gone for the rest of this tab"*, express it
as scope rather than duration — `snoozeStorage: sessionStorage` with a long
`snoozeMs`. It dies with the tab instead of pretending to be permanent, so a
person who closes and reopens the app is asked again, and nobody has to reason
about a timestamp in the year 2255.

`snooze()` is deliberately not a mute, and there is no option to make it one: a
banner that can be silenced forever is the defect above, made official. The
snooze is persisted (`localStorage` by default, `snoozeStorage: null` for
memory-only) so the reload the banner is *asking for* cannot defeat it.


- **`@broberg/pwa`** — `createPwaUpdater()`, a zero-dependency controller for the
  service-worker update lifecycle (works with Serwist, Workbox or a hand-rolled SW).
- **`@broberg/pwa/react`** — `usePwaUpdate()` hook + an **unstyled** `<PwaUpdateBanner>`
  skeleton (you style it with your own tokens).
- **`@broberg/pwa/sw`** — `listenForSkipWaiting()`, the service-worker side of the handshake.

> Web **push** notifications are a separate concern — use
> [`@broberg/webpush`](https://discovery.broberg.ai). This package never touches push.

## The update lifecycle

A service worker that finds a new version installs it and then **waits** so it
doesn't yank the page out from under the user. `@broberg/pwa` detects that
waiting worker, lets the user choose when to take it, then reloads once it's active:

```
new deploy → SW installs → SW waiting → banner → user taps Update
  → applyUpdate() posts SKIP_WAITING → SW skipWaiting() → controllerchange → reload
```

## React usage

```tsx
"use client";
import { usePwaUpdate, PwaUpdateBanner } from "@broberg/pwa/react";

export function PwaUpdater() {
  // Guards are YOUR policy — pass `disabled` for native shells / dev.
  const isNative = document.documentElement.classList.contains("native");
  const { updateReady, applyUpdate } = usePwaUpdate({
    disabled: isNative || process.env.NODE_ENV !== "production",
  });

  return (
    <PwaUpdateBanner
      updateReady={updateReady}
      onUpdate={applyUpdate}
      onDismiss={() => {/* hide for this session; it returns on next load */}}
      className="my-banner"                       // ← you own the styling
      labels={{ title: "Ny version klar", update: "Opdatér", dismiss: "Senere" }}
    />
  );
}
```

Prefer to build your own UI? Use the hook alone — `usePwaUpdate()` gives you
`{ updateReady, applyUpdate }` and nothing else. The banner is only a convenience
skeleton: it renders `role="status"` + `aria-live="polite"`, carries the stable
testids `pwa-update-confirm` / `pwa-update-dismiss` / `pwa-update-close`, and
ships **no** colours or design-system classes.

## Preact usage

Same API for the Stack B (Bun / Hono / Preact) apps — just the `/preact` subpath
(`preact` is the optional peer instead of `react`):

```tsx
import { usePwaUpdate, PwaUpdateBanner } from "@broberg/pwa/preact";

export function PwaUpdater() {
  const { updateReady, applyUpdate } = usePwaUpdate({ disabled: isNative || isDev });
  return <PwaUpdateBanner updateReady={updateReady} onUpdate={applyUpdate} className="my-banner" />;
}
```

`usePwaUpdate()` and `<PwaUpdateBanner>` behave exactly as their React
counterparts.

## Framework-agnostic core

No React? Drive the controller directly (Preact, Svelte, vanilla):

```ts
import { createPwaUpdater } from "@broberg/pwa";

const updater = createPwaUpdater({ swUrl: "/sw.js", disabled: isNative });
updater.subscribe(({ updateReady }) => renderBanner(updateReady));
// on the user's "Update" click:
updater.applyUpdate();
// later: updater.destroy();
```

### `createPwaUpdater(options)`

| option | default | meaning |
|---|---|---|
| `swUrl` | `/sw.js` | service-worker script to register |
| `pollIntervalMs` | `3_600_000` | how often to check for a new SW; `0` disables |
| `reloadOnControllerChange` | `true` | reload the page once the new SW takes control |
| `disabled` | `false` | inert no-op — pass your own guard (native shell, dev) |

Returns `{ subscribe, getState, applyUpdate, destroy }`. With no service-worker
support (or `disabled`), it's an inert no-op that never throws.

## Service-worker side

Answer the client's activation request in your service worker:

```ts
// sw.ts
import { listenForSkipWaiting } from "@broberg/pwa/sw";
listenForSkipWaiting(); // defaults to the worker's own global scope
```

With **Serwist**/**Workbox**, keep activation user-gated:

```ts
new Serwist({ /* … */, skipWaiting: false, clientsClaim: true });
```

## Install setup — manifest, icons, meta (`@broberg/pwa/manifest`, v0.2.0)

The *other* half of a PWA: the `manifest.webmanifest`, the icon set, and the
apple-touch `<meta>` tags — all as **pure, zero-dep** factories so you stop
hand-rolling `app/manifest.ts`, a `gen-pwa-icons.cjs` script, and a wall of
`<meta>` tags. Icons are emitted as self-contained **SVG** (modern manifests +
apple-touch accept SVG); no rasteriser is bundled.

```ts
import { defineManifest, serializeManifest, buildIconSet, pwaMetaTags } from "@broberg/pwa/manifest";

// 1. Icons from a monogram (or pass `svg: "<svg…>"` for real artwork).
const { files, icons } = buildIconSet({ monogram: "AK", background: "#141969", color: "#fff" });
//    files → [{ path:"/icons/icon-180.svg", content:"<svg…>", … }, …]  (write to public/)
//    icons → manifest icons[] incl. a padded maskable-512

// 2. Manifest — required members defaulted; `extra` merges last.
const manifest = defineManifest({ name: "Aalborg Klinik", shortName: "AK", themeColor: "#141969", icons });
writeFile("public/manifest.webmanifest", serializeManifest(manifest));

// 3. Head tags — typed descriptors you render in Next metadata / a Hono head / plain HTML.
pwaMetaTags({ themeColor: "#141969", title: "AK" });
// → [{tag:"link",attrs:{rel:"manifest",href:"/manifest.webmanifest"}}, {tag:"meta",attrs:{name:"theme-color",…}}, …]
```

- **`buildIconSet`** emits apple-touch (180), 192, 512 + a maskable-512 (10 % safe-zone
  inset) by default; override `sizes`, `basePath`, `maskable`. `180` goes in the
  apple-touch `<link>`, not the manifest `icons[]`.
- **Everything is a pure return value** — you own the filesystem write and the head
  render. Runs in a build script, a Route Handler, or the browser.
- Need PNG? Rasterise the returned SVGs with `sharp` on your side — the package
  stays dependency-free.

## Gotchas (baked into this package so you don't rediscover them)

- **First install is suppressed.** A worker reaching `installed` with no existing
  controller is the *first* install — there's nothing to update, so no banner.
- **No reload-loop.** `controllerchange` reloads exactly once.
- **Serwist + Next.js needs the webpack builder** — `next build` with **Turbopack**
  breaks the serwist SW build. Use `next build` (webpack).
- **Guards belong to you.** This package doesn't sniff `NODE_ENV` or a `.native`
  class — pass `disabled` so the policy lives in one place in your app.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
