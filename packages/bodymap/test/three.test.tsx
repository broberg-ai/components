// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BodyMap3D, seamBlend, seamWeight, needsComputedNormals } from "../src/three.js";
import { REGIONS } from "../src/index.js";

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
    const ACTIVE = "#0e8f8a";
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

describe("needsComputedNormals — the one line that drew lines on the body", () => {
  it("is FALSE when the model ships normals — the case that was broken", () => {
    // computeVertexNormals() averages face normals per vertex INDEX, and this
    // mesh has split vertices along its UV seams, so recomputing lit every seam
    // as a visible crease. The GLB already had correct smooth normals.
    const geo = { getAttribute: (n: string) => (n === "normal" ? { count: 12010 } : undefined) };
    expect(needsComputedNormals(geo)).toBe(false);
  });

  it("is TRUE when the model ships none — the fallback must survive the fix", () => {
    // A model with no normals renders flat/black. Removing the call outright
    // would have traded one visible bug for a worse one.
    const geo = { getAttribute: (_n: string) => undefined };
    expect(needsComputedNormals(geo)).toBe(true);
  });

  it("looks at the NORMAL attribute specifically, not at 'has any attribute'", () => {
    // A geometry always has `position`. A guard written against the wrong key
    // would pass both tests above and still recompute on every real model.
    const geo = {
      getAttribute: (n: string) => (n === "position" ? { count: 12010 } : undefined),
    };
    expect(needsComputedNormals(geo)).toBe(true);
  });
});
