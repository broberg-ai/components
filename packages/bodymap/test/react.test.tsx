// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BodyMap } from "../src/react";
import { serializeReport, type PainReport } from "../src/index";

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

  // ---- F052.7 front/back view toggle ----------------------------------------

  it("has a front/back toggle; default view is front (chest visible, lumbar absent)", () => {
    render(<BodyMap />);
    expect(screen.getByTestId("bodymap-view-front")).toBeTruthy();
    expect(screen.getByTestId("bodymap-view-back")).toBeTruthy();
    expect(screen.getByTestId("bodymap-region-chest")).toBeTruthy();
    expect(screen.queryByTestId("bodymap-region-lumbar")).toBeNull();
  });

  it("switching to back reveals THORA/LUMBAR/HIP and hides chest/groin; onViewChange fires", () => {
    const onViewChange = vi.fn();
    render(<BodyMap onViewChange={onViewChange} />);
    fireEvent.click(screen.getByTestId("bodymap-view-back"));
    expect(onViewChange).toHaveBeenCalledWith("back");
    expect(screen.getByTestId("bodymap-region-lumbar")).toBeTruthy();
    expect(screen.getByTestId("bodymap-region-thora")).toBeTruthy();
    expect(screen.getByTestId("bodymap-region-hip_left")).toBeTruthy();
    expect(screen.queryByTestId("bodymap-region-chest")).toBeNull();
    expect(screen.queryByTestId("bodymap-region-groin")).toBeNull();
  });

  it("marks LUMBAR on the back view; the point persists in the report across a view switch (Britta 8/10)", () => {
    let last: PainReport | undefined;
    render(<BodyMap onChange={(r) => (last = r)} />);
    fireEvent.click(screen.getByTestId("bodymap-view-back"));
    fireEvent.click(screen.getByTestId("bodymap-region-lumbar"));
    expect(screen.getByTestId("bodymap-panel").textContent).toContain("Lænd");
    fireEvent.click(screen.getByTestId("bodymap-intensity-8"));
    expect(last).toHaveLength(1);
    expect(last![0]).toMatchObject({ region: "lumbar", intensity: 8 });
    // switch to front: lumbar is not rendered, but the point survives in the report
    fireEvent.click(screen.getByTestId("bodymap-view-front"));
    expect(screen.queryByTestId("bodymap-region-lumbar")).toBeNull();
    expect(last).toHaveLength(1);
    expect(last![0]).toMatchObject({ region: "lumbar", intensity: 8 });
  });

  it("serializes a back-marked LUMBAR to bodymap/v1 {region:LUMBAR, side:center} with view back", () => {
    let last: PainReport = [];
    render(<BodyMap onChange={(r) => (last = r)} />);
    fireEvent.click(screen.getByTestId("bodymap-view-back"));
    fireEvent.click(screen.getByTestId("bodymap-region-lumbar"));
    fireEvent.click(screen.getByTestId("bodymap-intensity-8"));
    const env = serializeReport(last, { view: "back" });
    expect(env).toMatchObject({ schema: "bodymap/v1", view: "back" });
    expect(env.points[0]).toMatchObject({ region: "LUMBAR", side: "center", intensity: 8 });
  });

  it("defaultView='back' renders the back regions on first paint", () => {
    render(<BodyMap defaultView="back" />);
    expect(screen.getByTestId("bodymap-region-lumbar")).toBeTruthy();
    expect(screen.queryByTestId("bodymap-region-chest")).toBeNull();
  });
});
