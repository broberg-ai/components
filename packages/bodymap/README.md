# @broberg/bodymap

Interactive body **pain-map**: a genderless body a patient clicks to mark where it
hurts, producing a structured `PainReport` (the shared `bodymap/v1` wire format) —
never a bare image. The clinical region taxonomy, the data model and the selection
engine are **framework-neutral**; the renderer is swappable. This release ships the
headless core + a 2D SVG React renderer (front view). A rotatable 3D renderer
(vanilla Three.js) and a 2D back view land in follow-up `0.1.x` releases on the
same core.

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

- 2D **back view** (LUMBAR / THORA / HIP posterior) — `0.1.x`
- Rotatable **3D** renderer (vanilla Three.js, realistic Blender Studio CC0 body,
  click-to-colour by pain) — `0.1.x`
- Preact adapter

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
