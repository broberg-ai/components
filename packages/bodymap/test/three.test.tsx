// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BodyMap3D } from "../src/three.js";

afterEach(cleanup);

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
});
