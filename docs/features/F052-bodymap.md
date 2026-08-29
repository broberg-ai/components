# F052 — @broberg/bodymap — interactive body pain-map

> **Status:** planned · **Owner:** components · **Consumers:** FD Sport · FD Sundhed · FD Site
> **Locked decisions (Christian, 2026-07-04):** realistic-neutral look · ~15-20 regions · 2D MVP first, 3D later on the same core · model = **Blender Studio Human Base Meshes (CC0), APPROVED**.

## 1. Motivation

A rotatable/clickable human body where a patient points at **where it hurts**. The output is not a picture — it is a **structured pain code** (`PainReport`): which region, how intense (0-10), what type. That code goes into a journal, to a physiotherapist, or into Trail as a Neuron.

All three FD apps need this (FD Sport, FD Sundhed, FD Site). Without a shared component each would hand-roll its own body + region logic = exactly the drift the `@broberg/*` inventory exists to prevent. Reuse-first check: Discovery search for bodymap/smertekort/3d/anatomy returned **nothing** — this is net-new, not a duplicate.

## 2. Scope

**In scope**
- A framework-neutral **core**: region taxonomy (region → label + clinical code), the `PainReport` data model (zod-validated), a selection engine, and per-app **region config** (which regions are visible/selectable).
- A **2D SVG renderer** (MVP) — a neutral, colour-blocked body, ~15-20 named clickable regions → select → intensity + type → `PainReport`.
- A **3D renderer** (later) built on **vanilla Three.js** — same core, swappable.
- Thin **React** adapter now, **Preact** adapter for Stack B.
- The **3D model pipeline**: Blender Studio CC0 base → segment into named region meshes → Draco `.glb`.

**Non-goals**
- **WebXR / VR inside a Capacitor app** — the webview does not expose WebXR; VR would need a real browser. Not built; documented as a constraint.
- **Anatomical-atlas detail** (muscles/organs) — a pain-map needs ~15-20 surface regions, not 1,500 anatomical parts.
- **Gender-specific bodies** — one genderless figure (clinical neutrality).
- **Storing patient data** — the package is network-free; the consuming app owns the `PainReport` destination + its GDPR handling.
- Bundling the 3D model in the npm — the `.glb` is a separately-hosted asset; the package takes a `modelUrl`.

## 3. Architecture — the renderer is swappable, everything else is stable

The single most important decision: **separate the renderer from the core** so 2D→3D is a component swap, not a rewrite for the three apps.

```
@broberg/bodymap            core (framework-neutral, dep: zod)
  - REGIONS taxonomy        region key -> { label, code, side? }
  - PainReport model        zod schema { region, intensity 0-10, type?, timestamp }
  - selection engine        add/update/remove point, get report (no DOM/React)
  - RegionConfig            per-app visible/selectable per region (the toggle)
@broberg/bodymap/react      <BodyMap> (2D SVG) + <BodyMap3D> (Three.js)
@broberg/bodymap/preact     same, preact/hooks, no Tailwind/shadcn
```

Consumers code against the **region/selection API**, never the renderer. Upgrading 2D→3D = swapping `<BodyMap>` for `<BodyMap3D>`; the `onChange(report)` contract is identical.

**Why vanilla Three.js, not react-three-fiber:** R3F is a React renderer and does **not** run under Preact. For a fleet package serving React, Preact AND a plain Capacitor webview, vanilla Three.js is the only engine that runs identically everywhere. The React/Preact adapters just mount the vanilla engine into a ref.

## 4. The model — Blender Studio Human Base Meshes (CC0, APPROVED)

**License analysis (why this one):**
- Anatomy atlases (Z-Anatomy, BodyParts3D, AnatomyTOOL) = **CC-BY-SA** — copyleft on the model + attribution. Heavy.
- Good-looking Sketchfab models are often **CC-BY-NC** (NonCommercial → illegal in a commercial clinical product) or **Free Standard** (attribution required) — and download now needs an Epic Games account.
- **Blender Studio Human Base Meshes = CC0** — public domain, commercial-closed fine, no attribution, no share-alike; 17 clean quad-topology figures (realistic + stylized, male + female); downloaded **directly from blender.org, no Sketchfab/Epic account**. Best-looking clean CC0 option. **Approved by Christian.**

**Pipeline (F052.5):** take a neutral figure → segment the surface into the ~15-20 named region meshes (mesh name == region code) → decimate + Draco-compress → `.glb`. The colour-block = the region = the clinical code. Asset hosted once (the three apps point at the same `modelUrl`), not bundled in the npm.

## 5. Consumers & rollout

- **FD Sport · FD Sundhed · FD Site** — same package, per-app `RegionConfig` (Site may show a subset; Sundhed all clinical regions; Sport the sport-relevant ones).
- **Rollout:** 2D MVP (F052.1-.3) ships first — a usable pain-map all three apps can adopt now. 3D (F052.5-.6) lands later on the same core with zero consumer rewrite. Preact adapter (F052.4) when a Stack B FD app needs it.

## 6. Compliance

A `PainReport` tied to a patient is **health PII**. The package itself is UI + data-model with **no network calls** → clean in isolation. The *destination* (Trail Neuron? FD backend?) must stay EU-resident + consent-based (fleet GDPR rule). The region list must be **signed off by FD's clinical lead** before the model is segmented (codes must match their terminology).

## 7. Dependencies

- Core: `zod` (validation) only.
- 3D renderer: `three` (peer). No react-three-fiber.
- No existing `@broberg/*` overlaps (Discovery-checked). Publishes via the standard bootstrap → Trusted Publisher → OIDC `bodymap-v*` tag flow.

## 8. Stories

- **F052.1** Headless core — region taxonomy + PainReport (zod) + selection engine + RegionConfig.
- **F052.2** 2D SVG renderer + React adapter (MVP) — `<BodyMap>`, ~15-20 clickable regions, data-testid, feedback.
- **F052.3** Publish v0.1.0 (2D MVP) + README + OIDC + Discovery + first FD consumer pilot.
- **F052.4** Preact adapter (Stack B parity).
- **F052.5** 3D model pipeline — Blender Studio CC0 base → segment → Draco `.glb` + validation.
- **F052.6** 3D renderer (vanilla Three.js) — `<BodyMap3D>` swappable on the same core; WebXR out. *(shipped 0.2.0 — `@broberg/bodymap/three`; on-demand rendering + WebGL fallback + models-as-prop + RegionConfig; Lens-verified in a real browser)*
- **F052.7** 2D front/back view toggle — back regions (LUMBAR/THORA/HIP) for the fd-sundhed pilot. *(shipped 0.1.1)*
- **F052.8** Touch-first mobile — >=44px hit-areas, pinch-zoom + pan, tap-guard, responsive stacked layout, thumb-sized controls. Bodymap is PRIMARILY a mobile surface (Christian: touch = highest priority of all). *(shipped 0.1.2)*
- **F052.9** Read-only / display mode — show a saved report (journal, PDF, clinician view) with no picker. *(shipped 0.1.3)*
- **F052.10** Palette / branding — consume BodymapPalette + per-region colours + `--bmap-*` CSS vars in 2D (fd-sundhed gap #2). *(shipped 0.1.3)*
- **F052.11** Accessibility — keyboard operation + live-state ARIA + focus + reduced-motion. *(shipped 0.1.2)*
- **F052.12** i18n — labels/locale prop so map + report render in any language (da + en shipped). *(shipped 0.1.3)*
- **F052.13** Before/after compare — show pain-report change over time (the push-to-update nudge is the consumer app's job via @broberg/webpush). *(shipped 0.1.4)*

## 9. Open questions

- Exact region list + clinical codes — **needs FD clinical sign-off** before F052.5.
- Which FD app pilots the 2D MVP first?
- `PainReport` destination (Trail Neuron vs FD backend) — decides the compliance wiring on the consumer side.


## The 3D path cannot be photographed — and that is where the bugs were

Reported by **fd-sundhed**, 2026-08-29, from their own Lens run (2b85eebf,
iphone-15, against production): **the WebGL canvas captures as a black square.**
The canvas appears, they tapped 50%,28%, hit no region — and they cannot see
where the body is standing, so they cannot aim.

Not reproduced independently here; it is their measurement, and it is filed as a
Lens capability gap (`lens-gap`, idea 01a04e70) rather than worked around. The
fleet contract is explicit that reaching for raw Playwright to get past a Lens
limitation is a violation, and the escalation is the correct path.

**Two facts that belong next to each other:**

1. The 3D path cannot be photographed by any consumer.
2. On the same day, **four separate defects** were found in that same
   `three.tsx` WebGL path — the hint falling off the bottom of the phone
   (F052.31), the intensity control sitting 14px under the 44px touch floor
   (F052.34), a 450ms tap ceiling discarding a careful press (F052.32), and the
   hint covering the panel's close button (F052.33).

Every one of those was found by **reading a screenshot semantically** — which is
exactly what stops working when the screenshot is a black rectangle. The
causation runs the obvious way: nobody can look at it, so nobody sees what is
wrong with it.

**The consequence, stated plainly:** when we tell a consumer "that is fixed",
they cannot confirm it with an image. They can read the code and trust our run.
**A shared component whose correctness can only be asserted by its author has no
independent check** — and this one is going into a municipal health product.

### CORRECTION, same day — the cause is NOT ours, and I nearly shipped a fix for it

fd-sundhed then measured that the package sets no `preserveDrawingBuffer`
(confirmed here: `new THREE.WebGLRenderer({ antialias: true })` is the only
renderer construction in `src/three.tsx`) and offered it as a hypothesis, marked
as a hypothesis. It is the textbook cause of a WebGL canvas reading back black.

**I reproduced the opposite, twice, against the packaged build:**

```
run c082f324   390x844 viewport, waitFor 4000ms    -> the body renders fully
run 4f14129e   device iphone-15, NO waitFor, 675ms -> the body renders fully
```

Chromium, no `preserveDrawingBuffer`, and Lens photographs the canvas correctly
anyway — including on their exact device preset and with no wait at all.

**So the missing flag is real and is not the cause.** I was one step from
changing a published package's renderer configuration on a plausible diagnosis my
own measurement contradicts, and the only reason I did not is that this package
ships a demo I could serve and shoot in ninety seconds.

**What survives:** their inability to photograph their body map is real; my
explanation of it was not. And a consumer genuinely cannot configure the
renderer — a real limitation on its own merits, not a fix for this.

**Cheaper explanations to eliminate first**, since a black canvas has several:
does the `.glb` 200 from their *deployed* url (a canvas with no model is black —
a deploy problem wearing a capture problem's clothes); is the canvas inside an
ancestor with a transform/filter/backdrop-filter; is it mounted lazily behind
something their run never opens.
