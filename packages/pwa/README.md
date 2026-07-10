# @broberg/pwa

The fleet's **PWA primitive**. Today it ships the piece four repos hand-rolled
independently — the *"a new version is available, tap to reload"* lifecycle —
as one small, framework- and bundler-agnostic package instead of a fifth copy.

```bash
npm i @broberg/pwa
```

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
