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
  canvasHeight="45vh"                    // shorter body on mobile → picker panel stays visible
  showRegionCode={false}                 // hide the clinical code-badge in patient-facing flows
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
- **Body type from a profile.** Pass `sex="male" | "female"` to run it fully
  controlled (the parent owns it), and `showSexToggle={false}` to hide the picker —
  common when the body type comes from the user's profile and a mid-flow toggle would
  just be noise. Omit both to get the built-in toggle (uncontrolled).
- **Mobile panel visibility.** The picker panel is a flex-sibling below the body; on a
  narrow viewport a full-height body pushes it a screen down. Pass `canvasHeight`
  (default `"60vh"`; a bare number = px) — a shorter body on mobile keeps the panel
  visible the moment a region is selected. You drive the responsive value; the package
  stays non-opinionated (no forced bottom-sheet).
- **Hide the code-badge.** The selection panel shows the region's clinical **code**
  ("HIP · right") next to the readable name — useful for a clinician, noise in a
  patient-facing flow. Pass `showRegionCode={false}` (default `true`) to hide it and
  keep only the human name. The badge carries `data-testid="bodymap3d-region-code"`.
- **Report view.** Lock every region (`config` with `selectable: false`) and the
  interactive hover-hint is suppressed — a locked 3D body reads as a *report*, not a
  form. Set `ui.hoverHint` to show a display caption instead.
- **No WebXR/VR.** This is a rotatable in-page 3D canvas, not an immersive session —
  WebXR is intentionally out (a Capacitor webview can't host it reliably).
- Every control carries a `data-testid` (`bodymap3d-canvas`, `bodymap3d-sex-*`,
  `bodymap3d-intensity-<n>`, `bodymap3d-type-<quality>`, `bodymap3d-region-code`,
  `bodymap3d-ready`).

## Sound + haptics — the package emits the SIGNAL, you wire the effect

Both renderers take `onFeedback`, called after **every** pick with what actually
happened:

```tsx
<BodyMap onFeedback={({ outcome, region }) => { /* "select" | "clear" | "ignore" */ }} />
<BodyMap3D onFeedback={({ outcome, region }) => { /* same three outcomes */ }} />
```

The outcome is the one the core decision returned, never the intent to tap — so a
tap on a locked region cannot announce itself as a removal, and a tap the
pan/pinch guard swallowed emits **nothing at all**.

### What the package ships, and what it deliberately does not

| | |
|---|---|
| **Web vibration** | shipped, `haptics` prop, **on by default**, inert where the API is absent |
| **Sound** | **not shipped** — wire `onFeedback` to [`@broberg/soundkit`](https://www.npmjs.com/package/@broberg/soundkit) |
| **Native haptics** | **not shipped** — wire `onFeedback` to Capacitor `Haptics.impact()` |

Sound and native haptics are left to you on purpose. `@broberg/soundkit` already
exists, and pulling Web Audio (or a Capacitor dependency) into a component that is
frequently rendered read-only — a journal, a PDF, a clinician view — is a cost
every consumer would pay for a feature most will not switch on.

```tsx
// sound: any web app
import { play } from "@broberg/soundkit";
<BodyMap onFeedback={({ outcome }) => outcome !== "ignore" && play(outcome === "clear" ? "undo" : "tap")} />

// real Taptic: a Capacitor app (the ONLY route that works on an iPhone)
import { Haptics, ImpactStyle } from "@capacitor/haptics";
<BodyMap3D
  haptics={false}                                  // the web API is not there on iOS anyway
  onFeedback={({ outcome }) => {
    if (outcome === "ignore") return;
    Haptics.impact({ style: outcome === "clear" ? ImpactStyle.Medium : ImpactStyle.Light });
  }}
/>
```

### The platform fact you need before promising a buzz

**Measured, with a control:**

| Engine | `navigator.vibrate` |
|---|---|
| WebKit — Safari, and **every** browser on an iPhone | **absent** |
| Chromium — Android web | present |

So on an **iPhone web page there is no route to a buzz at all.** Not a permission
you have not asked for — the API is not there. Real Taptic on iOS requires the
**native app**. Plan the feature accordingly rather than discovering it on a
device.

### `requestVibration` never claims delivery

```ts
import { requestVibration, VIBRATION_PATTERNS } from "@broberg/bodymap";
requestVibration(VIBRATION_PATTERNS.clear);
// → "unsupported" | "skipped" | "declined" | "requested"
```

`requested` means **the browser accepted the request**, not that the phone moved.
Silent mode, a device with no vibration motor, and a page that has not yet had a
user gesture all return `true` from `navigator.vibrate` and produce nothing. There
is no word for "delivered" because nothing observable from a web page can support
one. (Same lesson `@broberg/webpush` 0.3.1 recorded when a consumer proved a push
had *arrived* on a device that never *showed* it.)

`VIBRATION_PATTERNS.ignore` is empty on purpose: a tap that changed nothing must
not feel like it did.

## Closing the picker without marking anything

Opening a region writes **nothing** to the report — only choosing an intensity
does. So until 0.7.0 there was no exit from a region you opened by accident: your
options were to mark it (writing something you did not mean) or to open a
different region (which you also did not mean).

Both renderers now carry a close control (`bodymap-close` / `bodymap3d-close`),
and in the 3D renderer `Escape` closes the open region — falling through to
leaving fullscreen only when no region is open, so one press never does two
things.

**Close is not remove, and the distinction is deliberate:**

| | |
|---|---|
| **Close** | always available. Stops editing this region. **Never touches the report.** |
| **Remove** | only when something is actually marked. Deletes the mark. |

A «Remove» button offered while the report is empty tells the user something was
stored when nothing was — so it stays gated, and the close control is what fills
the gap.

**Why it went unnoticed for so long:** every test and demo in this package taps a
region *in order to mark it*. Nobody had ever tested changing their mind. Nothing
was behaving wrongly — it was a path with no exit, and paths with no exit do not
fail, they strand people.

## Fullscreen — fill the viewport with the body

```tsx
// built-in control (default)
<BodyMap3D models={models} />

// your own button — you own the state
const [big, setBig] = useState(false);
<BodyMap3D models={models} fullscreen={big} onFullscreenChange={setBig} showFullscreenButton={false} />
<button onClick={() => setBig(true)}>Se stor</button>
```

`Escape` leaves it — **but a phone has no Escape**, so there must always be a
reachable control. That is why the built-in one exists and why switching it off is
a commitment to supplying your own.

⚠️ **If you supply your own control, render it as a SIBLING of the fullscreen
surface — not as a child of a container beneath it.** The surface is
`position: fixed`, so a button positioned `absolute` inside your original box ends
up *underneath* it. A consumer hit exactly this: their × disappeared under the
overlay, and because they had already set `showFullscreenButton={false}` there was
no way out at all. Give yours `position: fixed` and a z-index above the overlay,
and assert with `document.elementFromPoint()` that the point you can see is the
button you think it is.

The control sits inside the safe area (`env(safe-area-inset-*)` on all four sides),
and becomes a compact × in fullscreen — a text pill is wide enough to cover half a
phone's status bar. The pain report is untouched by entering or leaving.

**It is a viewport fill, not the browser Fullscreen API — deliberately.** iOS
Safari does not support fullscreen on an arbitrary element at all, and a phone is
this component's primary surface. A `position: fixed; inset: 0` overlay behaves
identically on every platform, needs no user-gesture dance, and cannot leave you
with a control that silently does nothing on the one device that matters most.

### It ships with a `ResizeObserver`, and that is not incidental

Before 0.6.0 the canvas measured the element **once at mount** and only re-measured
on a **window** resize. Everything below changes the ELEMENT without touching the
window, and each one left the picture at its old size — a body that renders small,
off-centre, or clipped, with nothing wrong in the code because the camera maths is
correct and the numbers it was handed are stale:

- entering or leaving fullscreen
- switching `canvasHeight` at your own breakpoint
- a container animating open, or a wizard step revealing the panel
- **a phone's URL bar collapsing, which changes what `vh` means**

If you saw a badly framed body on a phone before 0.6.0, this is the first thing to
retest.

## `seam` — soft region edges are OPT-IN, and here is why

```tsx
<BodyMap3D seam />          // soft colour transition between regions
<BodyMap3D />               // default: flat, full-contrast regions
```

**Default off, because the default has to be the accessible one.** The blend mixes
the *body* colour into a marked region near its boundary — and on a **small** mark,
the boundary is most of the mark.

Measured on a phone (`iphone-15`), a consumer's real palette, one knee marked,
averaged over every pixel of the mark:

| | mark colour | contrast vs body |
|---|---|---|
| `seam` on | `rgb(114, 58, 79)` | **3.59:1** — fails WCAG AA |
| `seam` off (default) | `rgb(111, 22, 56)` | **4.71:1** — passes |

At the single strongest pixel the cost is small (5.12 → 4.78), which is why a
spot-check misses it. The average is what a person sees.

**Turn it on** when marked areas are large and you have no accessibility duty — it
genuinely looks better there. **Leave it off** for anything a public authority,
a clinician or a partially-sighted user will read.

## Smooth skin: we do not recompute the model's normals

If your `.glb` ships normals, the renderer uses them. It only calls
`computeVertexNormals()` when the file has none.

This matters more than it sounds. `computeVertexNormals()` averages face normals
**per vertex index**, and a body mesh has split vertices along its UV seams — two
copies at the same position averaging different faces. The two sides then light
differently, drawing a visible crease along every seam: a line down the torso, and
across the chest, waist, shoulders, knees, elbows and ankles. The figure looks
assembled from parts. Measured side by side: with the call, every line is there;
without it, none are.

If you supply your own model, **ship it with normals.**

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
