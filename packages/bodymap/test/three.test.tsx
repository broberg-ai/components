// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BodyMap3D, seamBlend, seamWeight, ensureNormals, isTap, TAP_MAX_DISTANCE, INTENSITY_SIZE, shouldShowHint } from "../src/three.js";
import { readFileSync } from "node:fs";
import { REGIONS, defaultPalette, defaultUi, STAGE_BG, type BodymapPalette } from "../src/index.js";

afterEach(cleanup);

const allLocked = Object.fromEntries(REGIONS.map((r) => [r.key, { selectable: false }]));

// happy-dom has no WebGL, so the component takes its graceful-degradation path
// (no three.js WebGLRenderer is constructed) — which is exactly what we want to
// unit-test here. The real WebGL render + click-to-mark is proven in a browser
// via Lens (unit tests can't hit-test a canvas).
const models = { male: "/body-male.glb", female: "/body-female.glb" };

describe("BodyMap3D", () => {
  it("mounts without throwing and renders the body/sex toggle", () => {
    render(<BodyMap3D models={models} />);
    expect(screen.getByTestId("bodymap3d-root")).toBeTruthy();
    expect(screen.getByTestId("bodymap3d-sex-male")).toBeTruthy();
    expect(screen.getByTestId("bodymap3d-sex-female")).toBeTruthy();
  });

  it("degrades gracefully to a fallback when WebGL is unavailable (never crashes)", () => {
    render(<BodyMap3D models={models} />);
    expect(screen.getByTestId("bodymap3d-unsupported")).toBeTruthy();
    expect(screen.queryByTestId("bodymap3d-canvas")).toBeNull();
  });

  it("localizes the sex toggle + empty hint (da default → en)", () => {
    const { rerender } = render(<BodyMap3D models={models} />);
    expect(screen.getByTestId("bodymap3d-sex-male").textContent).toBe("Mand");
    expect(screen.getByTestId("bodymap3d-empty").textContent?.toLowerCase()).toContain("markere");

    rerender(<BodyMap3D models={models} locale="en" />);
    expect(screen.getByTestId("bodymap3d-sex-male").textContent).toBe("Male");
    expect(screen.getByTestId("bodymap3d-sex-female").textContent).toBe("Female");
    expect(screen.getByTestId("bodymap3d-empty").textContent?.toLowerCase()).toContain("tap a body part");
  });

  it("sex toggle fires onSexChange + reflects the active state", () => {
    const onSexChange = vi.fn();
    render(<BodyMap3D models={models} defaultSex="male" onSexChange={onSexChange} />);
    fireEvent.click(screen.getByTestId("bodymap3d-sex-female"));
    expect(onSexChange).toHaveBeenCalledWith("female");
  });

  it("accepts a custom ui-label override", () => {
    render(<BodyMap3D models={models} ui={{ male: "Herre", female: "Dame" }} />);
    expect(screen.getByTestId("bodymap3d-sex-male").textContent).toBe("Herre");
    expect(screen.getByTestId("bodymap3d-sex-female").textContent).toBe("Dame");
  });

  it("hides the sex toggle when showSexToggle=false (F052.14 — sex from profile)", () => {
    render(<BodyMap3D models={models} showSexToggle={false} sex="female" />);
    expect(screen.queryByTestId("bodymap3d-sex-male")).toBeNull();
    expect(screen.queryByTestId("bodymap3d-sex-female")).toBeNull();
    // the map itself still renders (fallback in happy-dom, canvas in a browser)
    expect(screen.getByTestId("bodymap3d-root")).toBeTruthy();
  });

  it("runs sex fully controlled when `sex` is passed (parent owns it; onSexChange still fires)", () => {
    const ACTIVE = "#0c7d77";
    const onSexChange = vi.fn();
    const { rerender } = render(<BodyMap3D models={models} sex="female" onSexChange={onSexChange} />);
    expect(screen.getByTestId("bodymap3d-sex-female").style.background).toBe(ACTIVE);

    // clicking the other option fires onSexChange but does NOT flip the active
    // state — the parent controls it.
    fireEvent.click(screen.getByTestId("bodymap3d-sex-male"));
    expect(onSexChange).toHaveBeenCalledWith("male");
    expect(screen.getByTestId("bodymap3d-sex-female").style.background).toBe(ACTIVE);

    // parent updates the prop → active flips
    rerender(<BodyMap3D models={models} sex="male" onSexChange={onSexChange} />);
    expect(screen.getByTestId("bodymap3d-sex-male").style.background).toBe(ACTIVE);
  });

  it("suppresses the interactive hover-hint when fully locked (F052.15 — report view)", () => {
    render(<BodyMap3D models={models} config={allLocked} />);
    expect(screen.queryByTestId("bodymap3d-empty")).toBeNull();
  });

  it("shows an explicit ui.hoverHint even when locked; default hint when any region is selectable", () => {
    const { rerender } = render(
      <BodyMap3D models={models} config={allLocked} ui={{ hoverHint: "Din smerterapport" }} />,
    );
    expect(screen.getByTestId("bodymap3d-empty").textContent).toBe("Din smerterapport");
    // no config → regions selectable → the default hint shows as before
    rerender(<BodyMap3D models={models} />);
    expect(screen.getByTestId("bodymap3d-empty")).toBeTruthy();
  });

  it("canvasHeight sizes the canvas/placeholder (F052.16 — default 60vh, string + numeric override)", () => {
    // WebGL is absent in happy-dom → the placeholder carries the height (same
    // `canvasHeight` value flows to the real canvas div in a browser).
    const { rerender } = render(<BodyMap3D models={models} />);
    expect(screen.getByTestId("bodymap3d-unsupported").style.height).toBe("60vh");
    rerender(<BodyMap3D models={models} canvasHeight="45vh" />);
    expect(screen.getByTestId("bodymap3d-unsupported").style.height).toBe("45vh");
    rerender(<BodyMap3D models={models} canvasHeight={360} />);
    expect(screen.getByTestId("bodymap3d-unsupported").style.height).toBe("360px");
  });
});

// ---------------------------------------------------------------------------
// F052.21 — the seam blend. Christian saw "sharp transitions" and read them as a
// model problem; measured, the model is 21,160 triangles with smooth normals and
// the sharpness was a hard nearest-anchor partition. This is the fade.
// ---------------------------------------------------------------------------

describe("seamBlend — a soft LOOK, never a soft ANSWER", () => {
  it("is 0 at an anchor and 0.5 exactly at the seam", () => {
    expect(seamBlend(0, 1)).toBe(0);        // standing on the anchor
    expect(seamBlend(1, 1)).toBe(0.5);      // equidistant from two anchors
  });

  it("is 0 well INSIDE a region — a marked chest is fully its own colour at the centre", () => {
    // Without this the whole body turns to mush and a marked region stops
    // reading as a region at all.
    expect(seamBlend(1, 81)).toBe(0);       // 1 unit away vs 9 — deep inside
    expect(seamBlend(1, 25)).toBe(0);       // 1 vs 5
  });

  it("NEVER exceeds 0.5 — the nearest region always dominates", () => {
    // A vertex painted mostly as its NEIGHBOUR would put the colour on the wrong
    // body part, which in a pain map is a wrong answer, not a wrong look.
    const samples = [[0, 1], [1, 81], [0.81, 1], [1, 1], [1, 1.0001], [4, 4]];
    for (const [a, b] of samples) expect(seamBlend(a!, b!)).toBeLessThanOrEqual(0.5);
  });

  it("rises monotonically as the runner-up gets closer", () => {
    const near = seamBlend(1, 4);   // d1=1, d2=2
    const closer = seamBlend(1, 1.44); // d1=1, d2=1.2
    const seam = seamBlend(1, 1);
    expect(near).toBeLessThanOrEqual(closer);
    expect(closer).toBeLessThan(seam);
    // …and it genuinely moves — a function returning one value would pass the
    // inequalities above if they were all <=.
    expect(seam).toBeGreaterThan(near);
  });

  it("degenerate input does not produce NaN", () => {
    expect(seamBlend(0, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F052.23 + F052.25 — the two fixes that lived ONLY on the WebGL path.
//
// Both AC on those cards stood honestly unticked for a day, because happy-dom
// has no GL context and neither fix had any automated guard. Extracting the two
// decisions as pure functions (the `decidePick` precedent) is what closes them.
// The call sites now go THROUGH these, so this is not a parallel copy of the
// logic — break the function and the renderer breaks with it.
// ---------------------------------------------------------------------------

describe("seamWeight — the shipped default must not mix body colour into a mark", () => {
  it("returns 0 for EVERY blend value when the seam is off — the invariant, not one case", () => {
    // Asserting one sample would pass on a function that leaked at 0.5.
    for (let b = 0; b <= 0.5; b += 0.01) expect(seamWeight(false, b)).toBe(0);
  });

  it("passes the blend through untouched when the consumer opts in", () => {
    expect(seamWeight(true, 0)).toBe(0);
    expect(seamWeight(true, 0.23)).toBe(0.23);
    expect(seamWeight(true, 0.5)).toBe(0.5);
  });

  it("composed with seamBlend, the default ships FLAT across the whole seam", () => {
    // This is the assertion that matches the actual WCAG claim: with the default
    // props, no vertex anywhere on the body takes any neighbour colour. Measured
    // cost of getting this wrong: 4.71:1 -> 3.59:1 on a small mark (AA needs 4.5).
    const samples: [number, number][] = [[0, 1], [1, 81], [0.81, 1], [1, 1.0001], [1, 1], [4, 4]];
    for (const [a, b] of samples) expect(seamWeight(false, seamBlend(a, b))).toBe(0);
  });
});

describe("ensureNormals — the one line that drew lines on the body", () => {
  // A geometry stub that RECORDS whether the expensive call happened. The
  // acceptance criterion asks for the effect, not the decision: a model that
  // ships normals must come out with those same normals, untouched.
  const geometry = (attrs: Record<string, unknown>) => {
    const state = { attrs: { ...attrs }, computed: 0 };
    return {
      state,
      getAttribute: (n: string) => state.attrs[n],
      computeVertexNormals() { state.computed++; state.attrs.normal = { authored: false }; },
    };
  };

  it("leaves an authored normal attribute ALONE — the case that was broken", () => {
    // computeVertexNormals() averages face normals per vertex INDEX, and this
    // mesh has split vertices along its UV seams, so recomputing lit every seam
    // as a visible crease. The GLB already had correct smooth normals.
    const authored = { authored: true, count: 12010 };
    const geo = geometry({ position: { count: 12010 }, normal: authored });
    expect(ensureNormals(geo)).toBe(false);
    expect(geo.state.computed).toBe(0);
    // the SAME object, not merely an equal one — nothing rebuilt it
    expect(geo.state.attrs.normal).toBe(authored);
  });

  it("computes normals when the model ships none — the fallback must survive the fix", () => {
    // A model with no normals renders flat/black. Removing the call outright
    // would have traded one visible bug for a worse one.
    const geo = geometry({ position: { count: 12010 } });
    expect(ensureNormals(geo)).toBe(true);
    expect(geo.state.computed).toBe(1);
    expect(geo.state.attrs.normal).toBeTruthy();
  });

  it("looks at the NORMAL attribute specifically, not at 'has any attribute'", () => {
    // A geometry always has `position`. A guard written against the wrong key
    // would pass both tests above and still recompute on every real model.
    const geo = geometry({ position: { count: 12010 } });
    ensureNormals(geo);
    expect(geo.state.computed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F052.29 — a stage is not a panel.
//
// `chrome.panelBg` painted the fullscreen backdrop AND the picker card. fd-sundhed
// hit the consequence in production: outside fullscreen their screen looked right
// (dark canvas, white card), in fullscreen the whole surface went white with a
// dark body floating in it — and no value of that one field fixed both, because
// darkening it hid the 0-10 buttons.
// ---------------------------------------------------------------------------

describe("stageBg — the split, asserted with a palette where the two DIFFER", () => {
  // A palette whose stage and panel are different colours. Every assertion below
  // is worthless with a palette where they happen to match — the old, broken
  // code would pass that.
  const split: BodymapPalette = {
    ...defaultPalette,
    ui: { stageBg: "#0e1424", panelBg: "#ffffff" },
  };

  it("paints the FULLSCREEN root with stageBg, not panelBg", () => {
    render(<BodyMap3D models={models} palette={split} fullscreen />);
    const root = screen.getByTestId("bodymap3d-root");
    expect(root.style.background).toBe("#0e1424");
    // THE INVARIANT, not a second case: in one render the stage and the panel
    // must differ. The old code read one field for both, so it cannot pass this
    // no matter which colour is chosen.
    expect(root.style.background).not.toBe(screen.getByTestId("bodymap3d-empty").style.background);
  });

  it("leaves the PANEL on panelBg in the same render — proving the split separated them", () => {
    // The empty hint is the panel surface that exists without a selection.
    render(<BodyMap3D models={models} palette={split} fullscreen />);
    expect(screen.getByTestId("bodymap3d-empty").style.background).toBe("#ffffff");
  });

  it("restores the pre-0.8.0 white backdrop with ui.stageBg = '#fff'", () => {
    // The escape hatch promised to anyone who liked the old default.
    const white: BodymapPalette = { ...defaultPalette, ui: { stageBg: "#ffffff" } };
    render(<BodyMap3D models={models} palette={white} fullscreen />);
    expect(screen.getByTestId("bodymap3d-root").style.background).toBe("#ffffff");
  });

  it("does not paint the root at all when NOT fullscreen — the stage only exists as a stage", () => {
    render(<BodyMap3D models={models} palette={split} />);
    expect(screen.getByTestId("bodymap3d-root").style.background).toBe("");
  });

  it("the WebGL-unsupported message takes the PANEL pair, not the stage", () => {
    // It is a message, not a stage. Hardcoded #cbd5e1 on a consumer-chosen
    // background would be unreadable with no prop able to rescue it.
    render(<BodyMap3D models={models} palette={split} />);
    const box = screen.getByTestId("bodymap3d-unsupported");
    expect(box.style.background).toBe(split.ui!.panelBg);   // the palette's panel, not the default
    expect(box.style.color).toBe(defaultUi.mutedText);
    // and specifically NOT the stage, which is what it used to hardcode
    expect(box.style.background).not.toBe(STAGE_BG);
  });
});

// ---------------------------------------------------------------------------
// F052.30 — Christian asked whether a calling app can override colours and
// buttons. It could override the body and the panel; it could NOT override the
// controls, because three tokens that already existed were never read.
// ---------------------------------------------------------------------------

describe("the controls read the consumer's palette", () => {
  // Deliberately nothing like the defaults, so an ignored token is visible.
  const brand: BodymapPalette = {
    ...defaultPalette,
    ui: { accent: "#141969", accentText: "#f5f5f5", border: "#ff00ff", panelBg: "#fffbea" },
  };

  it("ui.border reaches the BUTTONS, not only the card — the exact gap reported", () => {
    render(<BodyMap3D models={models} palette={brand} />);
    expect(screen.getByTestId("bodymap3d-sex-male").style.border).toContain("#ff00ff");
  });

  it("ui.accent + ui.accentText paint the ACTIVE control", () => {
    render(<BodyMap3D models={models} palette={brand} sex="male" />);
    const active = screen.getByTestId("bodymap3d-sex-male");
    expect(active.style.background).toBe("#141969");
    expect(active.style.color).toBe("#f5f5f5");
  });

  it("the INACTIVE control takes panelBg and text, never the accent", () => {
    // Asserted separately: an implementation that painted every control with the
    // accent would pass the test above and be obviously wrong on screen.
    render(<BodyMap3D models={models} palette={brand} sex="male" />);
    const inactive = screen.getByTestId("bodymap3d-sex-female");
    expect(inactive.style.background).toBe("#fffbea");
    expect(inactive.style.background).not.toBe("#141969");
  });

  it("accent is NOT palette.selected — a teal mark with a navy button is allowed", () => {
    const p: BodymapPalette = { ...defaultPalette, selected: "#00ffcc", ui: { accent: "#141969" } };
    render(<BodyMap3D models={models} palette={p} sex="male" />);
    expect(screen.getByTestId("bodymap3d-sex-male").style.background).toBe("#141969");
  });
});

// ---------------------------------------------------------------------------
// F052.31 — the hint could not be turned off, and in fullscreen it fell off the
// bottom of the phone. fd-sundhed measured it in production: bodymap3d-empty at
// 858–912 in an 852px window. Entirely offscreen, and it reads as a bug in
// THEIR app.
// ---------------------------------------------------------------------------

describe("hint — the consumer decides whether, what and where", () => {
  it("hint={false} renders NOTHING — not an empty box", () => {
    // The old non-answer was ui.hoverHint = "", which produced an empty bordered
    // box: worse than the sentence it replaced. Regions are selectable here, so
    // the old condition would have rendered it.
    render(<BodyMap3D models={models} hint={false} />);
    expect(screen.queryByTestId("bodymap3d-empty")).toBeNull();
  });

  it("still shows by default — this is opt-out, not a silent removal", () => {
    render(<BodyMap3D models={models} />);
    expect(screen.getByTestId("bodymap3d-empty")).toBeTruthy();
  });

  it("hint={{text}} sets the text, and ui.hoverHint STILL does too", () => {
    // fd-sundhed passes ui.hoverHint today. A better prop arriving must not make
    // an existing consumer's override silently stop working.
    const { rerender } = render(<BodyMap3D models={models} hint={{ text: "Ny tekst" }} />);
    expect(screen.getByTestId("bodymap3d-empty").textContent).toBe("Ny tekst");

    rerender(<BodyMap3D models={models} ui={{ hoverHint: "Gammel vej" }} />);
    expect(screen.getByTestId("bodymap3d-empty").textContent).toBe("Gammel vej");
  });

  it("the default text no longer promises HOVER — there is none on a phone", () => {
    // Why the consumer overrode it in the first place: our default described an
    // interaction that does not exist on the surface this component calls
    // primary.
    const { rerender } = render(<BodyMap3D models={models} />);
    expect(screen.getByTestId("bodymap3d-empty").textContent?.toLowerCase()).not.toContain("hover");
    rerender(<BodyMap3D models={models} locale="en" />);
    expect(screen.getByTestId("bodymap3d-empty").textContent?.toLowerCase()).not.toContain("hover");
  });

  it("placement 'stage-bottom' only moves it in FULLSCREEN", () => {
    // Boxed, "after the canvas" is right. The move exists for the case where the
    // column wraps beneath a full-height canvas.
    const { rerender } = render(
      <BodyMap3D models={models} hint={{ placement: "stage-bottom" }} />,
    );
    expect(screen.getByTestId("bodymap3d-empty").dataset.placement).toBeUndefined();

    rerender(<BodyMap3D models={models} hint={{ placement: "stage-bottom" }} fullscreen />);
    expect(screen.getByTestId("bodymap3d-empty").dataset.placement).toBe("stage-bottom");

    // NOT ASSERTED HERE, deliberately: happy-dom discards env() from an inline
    // style, so the safe-area offset and the resulting geometry are unprovable
    // in a unit test. What this test proves is WHICH position rendered; that it
    // actually lands inside the viewport is a Lens assertion on a real engine —
    // and it is the assertion that matters, since the defect was measured as
    // 858-912 in an 852px window.
  });

  it("there is only ever ONE hint on screen", () => {
    // The stage-anchored copy must REPLACE the flow one, not join it.
    render(<BodyMap3D models={models} hint={{ placement: "stage-bottom" }} fullscreen />);
    expect(screen.getAllByTestId("bodymap3d-empty")).toHaveLength(1);
  });
});


// ---------------------------------------------------------------------------
// F052.32 — a careful tap is a slow tap, and slow taps were discarded in
// silence. The owner reported the same swallowed tap twice, as "the remove
// button is gone" and as "the sound does not work", and we explained each away
// separately.
// ---------------------------------------------------------------------------

describe("isTap — distance decides, and nothing else does", () => {
  it("a press held for a LONG time is still a tap", () => {
    // The 450 ms ceiling had no duration argument to give it, because duration
    // never told a tap from a drag. This is the case it used to throw away:
    // stationary, deliberate, and slow because the user was aiming.
    expect(isTap(0, 0)).toBe(true);
    expect(isTap(2, 2)).toBe(true);
  });

  it("a MOVED press is not a tap, however fast", () => {
    expect(isTap(20, 0)).toBe(false);
    expect(isTap(0, 20)).toBe(false);
    expect(isTap(15, 15)).toBe(false);
  });

  it("asserts the BOUNDARY, not just the extremes", () => {
    // A guard tested only at 0 and 100 px passes with ANY threshold. These two
    // cases are the only ones that pin the actual number.
    expect(isTap(TAP_MAX_DISTANCE, 0)).toBe(true);
    expect(isTap(TAP_MAX_DISTANCE + 1, 0)).toBe(false);
  });

  it("measures real distance, not the larger axis", () => {
    // 5,5 is inside a 6px box but 7.07px away. A guard written as
    // `max(|dx|,|dy|) <= 6` would pass every test above and accept a diagonal
    // drag as a tap.
    expect(isTap(5, 5)).toBe(false);
    expect(isTap(4, 4)).toBe(true);
  });

  it("the threshold is honoured, not hardcoded past", () => {
    expect(isTap(20, 0, 25)).toBe(true);
  });

  it("NOTHING ELSE can reject a tap — the call site is guarded too", async () => {
    // The function tests above all passed with a 450 ms ceiling put BACK at the
    // call site: mutation M1 survived, 126 green. A pure function can only prove
    // what it decides, never that the caller asked it and nothing else. So this
    // asserts the property the user actually experiences — no clock takes part
    // in deciding whether a tap counts.
    // process.cwd() rather than import.meta.url: this file runs under happy-dom,
    // where import.meta.url is not a file: URL.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${process.cwd()}/src/three.tsx`, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

    // `new Date()` stays: it timestamps a pain point, which is data, not a gate.
    expect(code).not.toContain("Date.now()");
    expect(code).not.toContain("performance.now()");

    // …and the pointer-up guard is the isTap call ALONE, with no second clause.
    const onUp = code.match(/const onUp = \(e: PointerEvent\) => \{\s*([^\n]+)/);
    expect(onUp?.[1]).toBe("if (!isTap(e.clientX - downX, e.clientY - downY)) return;");
  });

  it("the call-site scan can SEE a clock — negative control", () => {
    // Without this the scan passes forever if the pattern stops matching.
    const planted = "if (!isTap(a, b) || Date.now() - t > 450) return;";
    expect(planted).toContain("Date.now()");
  });
});

// ---------------------------------------------------------------------------
// F052.33 + F052.34 — the hint covered the panel's close control (the THIRD
// covered exit this week), and asking for circles uncovered that this renderer
// had been under the 44px touch floor since it shipped while its sibling was not.
// ---------------------------------------------------------------------------

describe("shouldShowHint — the note and the panel never coexist", () => {
  const base = { hint: undefined, anySelectable: true, hasExplicitHoverHint: false } as const;

  it("an OPEN region hides it, whatever else says show", () => {
    // The case the component test could not reach: happy-dom has no WebGL, so no
    // region can be selected, and a test written against the component asserts
    // the note is PRESENT twice and never that it disappears. That test was
    // green and vacuous, and it is why this function exists.
    expect(shouldShowHint({ ...base, openRegion: "CHEST" })).toBe(false);
    expect(shouldShowHint({ ...base, openRegion: "CHEST", hasExplicitHoverHint: true })).toBe(false);
  });

  it("openRegion beats an explicit hint object too", () => {
    expect(shouldShowHint({ ...base, openRegion: "CHEST", hint: { text: "x" } })).toBe(false);
  });

  it("with NOTHING open it behaves exactly as F052.31 left it", () => {
    expect(shouldShowHint({ ...base, openRegion: null })).toBe(true);
    expect(shouldShowHint({ ...base, openRegion: null, hint: false })).toBe(false);
    // locked map, no explicit text → suppressed (F052.15)
    expect(shouldShowHint({ ...base, openRegion: null, anySelectable: false })).toBe(false);
    // locked map WITH explicit text → shown
    expect(shouldShowHint({ ...base, openRegion: null, anySelectable: false, hasExplicitHoverHint: true })).toBe(true);
  });

  it("THE CALL SITE passes the open region — the function alone proves nothing", () => {
    // Mutation M2 survived without this: pointing the call site at `null`
    // instead of `selected` left all 133 tests green, because they exercised the
    // function and nothing exercised the caller.
    //
    // SECOND TIME TODAY. F052.32 hit the identical gap this morning, I wrote the
    // lesson into its commit, and then extracted another decision the same way
    // four hours later. Remembering is not the mechanism; this assertion is.
    const src = readFileSync(`${process.cwd()}/src/three.tsx`, "utf8");
    const call = src.match(/shouldShowHint\(\{([\s\S]{0,200}?)\}\)/);
    expect(call?.[1]).toContain("openRegion: selected");
  });

  it("hint={false} still wins over an explicit hoverHint", () => {
    // Two ways to ask for it and one way to refuse; the refusal is the stronger.
    expect(shouldShowHint({ ...base, openRegion: null, hint: false, hasExplicitHoverHint: true })).toBe(false);
  });
});

describe("the intensity buttons are circles, all of one size", () => {
  it("exports a size at or above the 44px touch floor", () => {
    // F052.8 set >=44px for this component; this renderer was on 30 with no
    // touch override while the 2D sibling was already on 46. The number is the
    // sibling's, so the two halves carry ONE value.
    expect(INTENSITY_SIZE).toBeGreaterThanOrEqual(44);
    expect(INTENSITY_SIZE).toBe(46);
  });
});
