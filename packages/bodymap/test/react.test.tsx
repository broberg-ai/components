// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BodyMap } from "../src/react";
import type { PainReport } from "../src/index";

afterEach(cleanup);

describe("<BodyMap> (2D React adapter)", () => {
  it("renders regions with data-testid and an empty panel initially", () => {
    render(<BodyMap />);
    expect(screen.getByTestId("bodymap-root")).toBeTruthy();
    expect(screen.getByTestId("bodymap-region-knee_right")).toBeTruthy();
    expect(screen.getByTestId("bodymap-panel").textContent).toContain("Klik en kropsdel");
  });

  it("clicking a region opens its picker; intensity fires onChange with a validated PainReport", () => {
    let last: PainReport | undefined;
    render(<BodyMap onChange={(r) => (last = r)} />);
    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));
    expect(screen.getByTestId("bodymap-panel").textContent).toContain("Knæ, højre");
    fireEvent.click(screen.getByTestId("bodymap-intensity-7"));
    expect(last).toHaveLength(1);
    expect(last![0]).toMatchObject({ region: "knee_right", intensity: 7 });
    fireEvent.click(screen.getByTestId("bodymap-type-dump"));
    expect(last![0]).toMatchObject({ region: "knee_right", intensity: 7, type: "dump" });
  });

  it("honours RegionConfig: hidden region not rendered; non-selectable region not clickable", () => {
    const onChange = vi.fn();
    const { rerender } = render(<BodyMap config={{ knee_right: { visible: false } }} onChange={onChange} />);
    expect(screen.queryByTestId("bodymap-region-knee_right")).toBeNull();
    rerender(<BodyMap config={{ neck: { selectable: false } }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("bodymap-region-neck"));
    expect(screen.getByTestId("bodymap-panel").textContent).toContain("Klik en kropsdel");
  });

  it("removing a point clears it from the report", () => {
    let last: PainReport | undefined;
    render(<BodyMap onChange={(r) => (last = r)} />);
    fireEvent.click(screen.getByTestId("bodymap-region-neck"));
    fireEvent.click(screen.getByTestId("bodymap-intensity-4"));
    expect(last).toHaveLength(1);
    fireEvent.click(screen.getByTestId("bodymap-remove"));
    expect(last).toHaveLength(0);
  });
});
