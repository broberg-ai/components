// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderHook, screen, fireEvent, cleanup } from "@testing-library/react";
import { PwaUpdateBanner, usePwaUpdate } from "../src/react.js";

afterEach(cleanup);

describe("PwaUpdateBanner", () => {
  it("renders nothing when no update is ready", () => {
    const { container } = render(<PwaUpdateBanner updateReady={false} onUpdate={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders an a11y status banner with the three testids when ready", () => {
    render(<PwaUpdateBanner updateReady onUpdate={() => {}} onDismiss={() => {}} />);
    const banner = screen.getByTestId("pwa-update-banner");
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByTestId("pwa-update-confirm")).toBeTruthy();
    expect(screen.getByTestId("pwa-update-dismiss")).toBeTruthy();
    expect(screen.getByTestId("pwa-update-close")).toBeTruthy();
  });

  it("fires onUpdate and onDismiss on the right buttons", () => {
    const onUpdate = vi.fn();
    const onDismiss = vi.fn();
    render(<PwaUpdateBanner updateReady onUpdate={onUpdate} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId("pwa-update-confirm"));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("pwa-update-dismiss"));
    fireEvent.click(screen.getByTestId("pwa-update-close"));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("overrides labels + applies className and ships no hardcoded inline colours", () => {
    render(
      <PwaUpdateBanner
        updateReady
        onUpdate={() => {}}
        onDismiss={() => {}}
        className="my-banner"
        labels={{ title: "Ny version", update: "Opdatér" }}
      />,
    );
    expect(screen.getByTestId("pwa-update-banner").className).toContain("my-banner");
    expect(screen.getByTestId("pwa-update-title").textContent).toBe("Ny version");
    expect(screen.getByTestId("pwa-update-confirm").textContent).toBe("Opdatér");
    expect(screen.getByTestId("pwa-update-banner").getAttribute("style")).toBeNull();
  });
});

describe("usePwaUpdate", () => {
  it("returns state + applyUpdate and cleans up on unmount (inert when disabled)", () => {
    const { result, unmount } = renderHook(() => usePwaUpdate({ disabled: true }));
    expect(result.current.updateReady).toBe(false);
    expect(typeof result.current.applyUpdate).toBe("function");
    expect(() => result.current.applyUpdate()).not.toThrow();
    expect(() => unmount()).not.toThrow();
  });
});
