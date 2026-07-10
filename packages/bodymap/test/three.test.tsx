// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BodyMap3D } from "../src/three.js";
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
