// F052.4 — <BodyMap> under Preact: same regions, same data-testids, same onChange(PainReport).
// Runs src/react.tsx with react aliased to preact (vitest.preact.config.ts) — the same
// transformation the ./preact build applies.
import { describe, it, expect, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { BodyMap } from "../src/react";
import { REGIONS, type PainReport } from "../src/index";

let root: HTMLElement;
afterEach(() => { render(null, root); root.remove(); });
const mount = (props: Record<string, unknown>) => {
  root = document.createElement("div");
  document.body.appendChild(root);
  act(() => { render(h(BodyMap as never, props), root); });
};
const byId = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (id: string) => act(() => { byId(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

describe("<BodyMap> under Preact (F052.4)", () => {
  it("renders the same regions with the same data-testid scheme as the React adapter", () => {
    mount({});
    expect(byId("bodymap-root")).toBeTruthy();
    const front = Array.from(root.querySelectorAll('[data-testid^="bodymap-region-"]')).map((e) => e.getAttribute("data-testid"));
    expect(front.length).toBeGreaterThanOrEqual(12);
    for (const id of front) expect(REGIONS.some((r) => `bodymap-region-${r.key}` === id)).toBe(true);
    expect(byId("bodymap-panel")!.textContent).toContain("Vælg en kropsdel");
  });

  it("clicking a region and an intensity fires onChange with a validated PainReport", () => {
    let last: PainReport | undefined;
    mount({ onChange: (r: PainReport) => (last = r) });
    click("bodymap-region-knee_right");
    expect(byId("bodymap-panel")!.textContent).toContain("Knæ, højre");
    click("bodymap-intensity-7");
    expect(last).toHaveLength(1);
    expect(last![0]).toMatchObject({ region: "knee_right", intensity: 7 });
  });

  it("honours RegionConfig: a hidden region is not rendered", () => {
    mount({ config: { knee_right: { visible: false } } });
    expect(byId("bodymap-region-knee_right")).toBeNull();
    expect(byId("bodymap-region-knee_left")).toBeTruthy();
  });

});
