# @broberg/bodymap

Interactive body **pain-map**: a genderless body a patient clicks to mark where it
hurts, producing a structured `PainReport` (the shared `bodymap/v1` wire format) —
never a bare image. The clinical region taxonomy, the data model and the selection
engine are **framework-neutral**; the renderer is swappable. This release ships the
headless core, a 2D SVG React renderer (front + back view) **and** a rotatable
3D renderer (vanilla three.js) — all on the same core and the same
`bodymap/v1` wire.

```bash
npm i @broberg/bodymap
```

## The data model

One `PainReport` is an array of points — one per marked region, latest wins:

```ts
type PainPoint = {
  region: string;      // a region key, e.g. "shoulder_left"
  intensity: number;   // 0–10
  type?: "stikkende" | "dump" | "konstant" | "jagende";
  timestamp: string;   // ISO
};
type PainReport = PainPoint[];
```

The taxonomy is the authoritative fd-sundhed clinical set: **18 side-less codes**
(HEAD, NECK, SHOULDER, UARM, ELBOW, FARM, WRIST, HAND, CHEST, THORA, LUMBAR, HIP,
GROIN, THIGH, KNEE, LOWLEG, ANKLE, FOOT) × a `side` (`left` / `right` / centre) →
30 concrete regions. `REGIONS` is the full list; `getRegion(key)` looks one up.

## Core (no React)

```ts
import { createPainSelection, serializeReport, deserializeReport } from "@broberg/bodymap";

const sel = createPainSelection();
sel.set("shoulder_left", 7, "jagende");
sel.set("lumbar", 4);
sel.getReport();                 // validated PainReport

const wire = serializeReport(sel.getReport(), { view: "front" });
// → { schema: "bodymap/v1", view: "front",
//     points: [{ region: "SHOULDER", side: "left", intensity: 7, quality: "jagende" }, …] }

deserializeReport(wire);         // bodymap/v1 → internal PainReport
```

`serializeReport` maps each region key to its side-less clinical **code** + side, so
the report is portable across the web components and the native mobile apps.
`painReportSchema` (zod) is exported for validating untrusted input.

## 2D renderer (React)

```tsx
import { BodyMap } from "@broberg/bodymap/react";

<BodyMap
  defaultValue={[]}                        // or `value` for a controlled component
  onChange={(report) => save(report)}      // full validated PainReport on every change
  config={{ groin: { visible: false } }}   // per-app region toggles (optional)
/>;
```

Click a region → pick intensity (0–10) and quality → the region fills by intensity
and `onChange` fires. No native form controls; every control carries a
`data-testid` (`bodymap-region-<key>`) for E2E/visual testing. `react` is an
optional peer dependency — the core works without it.

### Per-app region config

```ts
type RegionConfig = Record<string, { visible?: boolean; selectable?: boolean }>;
```

An absent key is visible + selectable. Hidden ⇒ never selectable. `resolveRegions`
and `isSelectable` apply the config for custom renderers.

## 3D renderer (React + three.js)

A rotatable 3D body on the **same** core + wire — a realistic Blender Studio human
base mesh (CC0), drag to rotate, scroll to zoom, hover to highlight, click a body
part to mark pain (the part colours by intensity). Vanilla three.js (not
react-three-fiber) so it runs in React, Preact and a Capacitor webview alike.

```tsx
import { BodyMap3D } from "@broberg/bodymap/three";

<BodyMap3D
  models={{ male: "/models/body-male.glb", female: "/models/body-female.glb" }}
  onChange={(report) => save(report)}   // same PainReport (bodymap/v1)
  palette={palette}                      // same BodymapPalette
  locale="da"                            // da | en (region names + UI)
  autoRotate={false}                     // idle when static (battery + Lens-friendly)
/>;
```

- **`three` is an optional peer** — only this subpath pulls it in (`npm i three`).
  The 2D renderer + core stay three-free.
- **You host the models.** The package ships reference GLBs at
  `@broberg/bodymap/models/body-male.glb` + `…/body-female.glb` (~512 KB each) —
  copy them to your `public/` (or `import url from "@broberg/bodymap/models/body-male.glb?url"`
  with a bundler that emits asset URLs) and pass the URLs via `models`. Nothing is
  bundled into the JS, and no model is fetched from a third party.
- **On-demand rendering.** The scene renders only while auto-rotating or while a
  gesture is settling, then goes idle — so it doesn't drain a phone's battery and a
  headless Lens/Playwright run can actually land clicks.
- **WebGL-safe.** With no WebGL context the component renders a graceful fallback
  instead of crashing.
- **Same contract as 2D.** `onChange` emits the identical `PainReport`, so swapping
  `<BodyMap>` for `<BodyMap3D>` needs zero change to your report handling. It honours
  the per-app `config` too — a non-selectable region isn't pickable in 3D either.
- **No WebXR/VR.** This is a rotatable in-page 3D canvas, not an immersive session —
  WebXR is intentionally out (a Capacitor webview can't host it reliably).
- Every control carries a `data-testid` (`bodymap3d-canvas`, `bodymap3d-sex-*`,
  `bodymap3d-intensity-<n>`, `bodymap3d-type-<quality>`, `bodymap3d-ready`).

## Colour control — `BodymapPalette`

Both renderers theme off one palette (consumer-defined):

```ts
import { defaultPalette, heatFor, baseColorFor, type BodymapPalette } from "@broberg/bodymap";

const palette: BodymapPalette = {
  body: "#c8ccdd",
  hover: "#5CC4B7",
  selected: "#141969",
  heat: { low: "#FFE049", mid: "#F09A3E", high: "#D61C64" },
  regions: { chest: "#e6e9f2" },   // optional per-region base colours
};

heatFor(8, palette);               // → "#D61C64"  (intensity → heat colour)
baseColorFor("chest", palette);    // → "#e6e9f2"  (per-region override, else body)
```

## Roadmap

- True **per-zone mesh segmentation** for the 3D renderer (v0.2.0 assigns each
  vertex to its nearest region anchor; sharp painted zones come next)
- **Preact** adapter

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
