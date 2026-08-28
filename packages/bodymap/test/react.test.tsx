// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BodyMap, BodyMapCompare } from "../src/react";
import { serializeReport, type PainReport } from "../src/index";

afterEach(cleanup);

describe("<BodyMap> (2D React adapter)", () => {
  it("renders regions with data-testid and an empty panel initially", () => {
    render(<BodyMap />);
    expect(screen.getByTestId("bodymap-root")).toBeTruthy();
    expect(screen.getByTestId("bodymap-region-knee_right")).toBeTruthy();
    expect(screen.getByTestId("bodymap-panel").textContent).toContain("Vælg en kropsdel");
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
    expect(screen.getByTestId("bodymap-panel").textContent).toContain("Vælg en kropsdel");
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

  // ---- F052.8 touch-first + F052.11 accessibility ---------------------------

  it("each region is a keyboard-focusable button with a live-state aria-label", () => {
    render(<BodyMap />);
    const knee = screen.getByTestId("bodymap-region-knee_right");
    expect(knee.getAttribute("role")).toBe("button");
    expect(knee.getAttribute("tabindex")).toBe("0");
    expect(knee.getAttribute("aria-label")).toContain("ikke markeret");
  });

  it("Enter on a region opens its picker (keyboard operable)", () => {
    render(<BodyMap />);
    fireEvent.keyDown(screen.getByTestId("bodymap-region-knee_right"), { key: "Enter" });
    expect(screen.getByTestId("bodymap-panel").textContent).toContain("Knæ, højre");
  });

  it("a marked region's aria-label reflects intensity + quality", () => {
    render(<BodyMap />);
    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));
    fireEvent.click(screen.getByTestId("bodymap-intensity-8"));
    fireEvent.click(screen.getByTestId("bodymap-type-dump"));
    expect(screen.getByTestId("bodymap-region-knee_right").getAttribute("aria-label")).toContain("smerte 8 af 10, dump");
  });

  it("exposes zoom controls; reset is disabled at rest and enabled after zooming", () => {
    render(<BodyMap />);
    expect(screen.getByTestId("bodymap-zoom-in")).toBeTruthy();
    expect(screen.getByTestId("bodymap-zoom-out")).toBeTruthy();
    const reset = screen.getByTestId("bodymap-zoom-reset") as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("bodymap-zoom-in"));
    expect((screen.getByTestId("bodymap-zoom-reset") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a non-selectable region is not focusable and not markable", () => {
    render(<BodyMap config={{ neck: { selectable: false } }} />);
    const neck = screen.getByTestId("bodymap-region-neck");
    expect(neck.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(neck);
    expect(screen.getByTestId("bodymap-panel").textContent).toContain("Vælg en kropsdel");
  });

  // ---- F052.10 palette / branding -------------------------------------------

  const AK = {
    body: "#c8ccdd", hover: "#5CC4B7", selected: "#141969",
    heat: { low: "#FFE049", mid: "#F09A3E", high: "#D61C64" },
    regions: { chest: "#e6e9f2" },
  };
  const vis = (tid: string) => screen.getByTestId(tid).nextElementSibling;

  it("palette recolours base, per-region override, and heat (marked)", () => {
    render(<BodyMap palette={AK} defaultValue={[{ region: "knee_right", intensity: 8, timestamp: "t" }]} />);
    expect(vis("bodymap-region-knee_right")?.getAttribute("fill")).toBe("#D61C64"); // heat.high
    expect(vis("bodymap-region-chest")?.getAttribute("fill")).toBe("#e6e9f2"); // per-region override
    expect(vis("bodymap-region-head")?.getAttribute("fill")).toBe("#c8ccdd"); // palette.body
  });

  it("without palette, unmarked fill uses the CSS-var chain with the rainbow fallback", () => {
    render(<BodyMap />);
    const f = vis("bodymap-region-head")?.getAttribute("fill") ?? "";
    expect(f).toContain("--bmap-region-head");
    expect(f).toContain("--bmap-body");
    expect(f).toContain("#cbb7ec"); // rainbow default for head
  });

  // ---- F052.12 i18n ----------------------------------------------------------

  it("locale='en' renders English UI + region names; the wire code is unchanged", () => {
    let last: PainReport = [];
    render(<BodyMap locale="en" onChange={(r) => (last = r)} />);
    expect(screen.getByTestId("bodymap-view-front").textContent).toBe("Front");
    expect(screen.getByTestId("bodymap-view-back").textContent).toBe("Back");
    expect(screen.getByTestId("bodymap-panel").textContent).toContain("Pick a body part");
    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));
    expect(screen.getByTestId("bodymap-panel").textContent).toContain("Knee, right");
    expect(screen.getByTestId("bodymap-type-dump").textContent).toBe("dull");
    fireEvent.click(screen.getByTestId("bodymap-intensity-7"));
    expect(serializeReport(last).points[0]).toMatchObject({ region: "KNEE", side: "right", intensity: 7 });
  });

  it("labels prop overrides individual strings; region CODE untouched", () => {
    render(<BodyMap labels={{ remove: "Slet", regions: { knee_right: "Højre knæ" } }} />);
    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));
    expect(screen.getByTestId("bodymap-panel").textContent).toContain("Højre knæ");
    fireEvent.click(screen.getByTestId("bodymap-intensity-3"));
    expect(screen.getByTestId("bodymap-remove").textContent).toBe("Slet");
    expect(screen.getByTestId("bodymap-panel").textContent).toContain("KNEE"); // code unchanged
  });

  // ---- F052.9 read-only / display mode --------------------------------------

  it("readOnly renders marks but exposes no picker and is not interactive", () => {
    const onChange = vi.fn();
    render(<BodyMap readOnly value={[{ region: "knee_right", intensity: 6, timestamp: "t" }]} onChange={onChange} />);
    expect(screen.queryByTestId("bodymap-panel")).toBeNull();
    expect(screen.queryByTestId("bodymap-intensity-5")).toBeNull();
    const chest = screen.getByTestId("bodymap-region-chest");
    expect(chest.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(chest);
    expect(screen.queryByTestId("bodymap-panel")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    // the marked region still renders its intensity number
    expect(screen.getByTestId("bodymap-root").textContent).toContain("6");
  });

  // ---- F052.13 before/after compare -----------------------------------------

  it("compare renders before/after bodies + a per-region change list", () => {
    const before: PainReport = [
      { region: "lumbar", intensity: 8, timestamp: "t" },
      { region: "knee_right", intensity: 5, timestamp: "t" },
    ];
    const after: PainReport = [
      { region: "lumbar", intensity: 3, timestamp: "t" }, // improved
      { region: "shoulder_left", intensity: 6, timestamp: "t" }, // new
      // knee_right dropped → resolved
    ];
    render(<BodyMapCompare before={before} after={after} />);
    expect(screen.getByTestId("bodymap-compare-before")).toBeTruthy();
    expect(screen.getByTestId("bodymap-compare-after")).toBeTruthy();
    const lumbar = screen.getByTestId("bodymap-compare-delta-lumbar");
    expect(lumbar.textContent).toContain("8");
    expect(lumbar.textContent).toContain("3");
    expect(lumbar.textContent).toContain("bedre");
    expect(screen.getByTestId("bodymap-compare-delta-knee_right").textContent).toContain("forsvundet");
    expect(screen.getByTestId("bodymap-compare-delta-shoulder_left").textContent).toContain("nyt");
  });

  it("compare with identical reports shows 'no change'", () => {
    const r: PainReport = [{ region: "knee_right", intensity: 5, timestamp: "t" }];
    render(<BodyMapCompare before={r} after={r} />);
    expect(screen.getByTestId("bodymap-compare-delta").textContent).toContain("Ingen ændring");
  });

  it("compare honours locale='en' for captions + change words + region names", () => {
    const before: PainReport = [{ region: "knee_right", intensity: 8, timestamp: "t" }];
    const after: PainReport = [{ region: "knee_right", intensity: 9, timestamp: "t" }];
    render(<BodyMapCompare before={before} after={after} locale="en" />);
    expect(screen.getByTestId("bodymap-compare-before").textContent).toContain("Before");
    expect(screen.getByTestId("bodymap-compare-after").textContent).toContain("After");
    const row = screen.getByTestId("bodymap-compare-delta-knee_right");
    expect(row.textContent).toContain("Knee, right");
    expect(row.textContent).toContain("worse");
  });
});

// ---------------------------------------------------------------------------
// F052.20 — the WIRING: does the 2D renderer actually call the core rule?
// decidePick is proven exhaustively in core.test.ts; these assert that a real
// tap reaches it. The 3D renderer's raycast cannot run in happy-dom (no WebGL),
// so its wiring is DEFERRED to Lens and named as such — never absorbed into a
// green suite.
// ---------------------------------------------------------------------------

describe("tapping a MARKED region clears it (F052.20)", () => {
  const mark = (testid: string, intensity = 7) => {
    fireEvent.click(screen.getByTestId(testid));
    fireEvent.click(screen.getByTestId(`bodymap-intensity-${intensity}`));
  };

  it("a second tap REMOVES the point — and a first tap on another region still opens the panel", () => {
    let last: PainReport | undefined;
    render(<BodyMap onChange={(r) => (last = r)} />);

    mark("bodymap-region-knee_right");
    expect(last?.map((p) => p.region)).toEqual(["knee_right"]);

    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));
    expect(last, "the second tap did not reach decidePick").toEqual([]);

    // CONTROL: an UNMARKED region must still open rather than do nothing —
    // without this, a renderer that ignored every tap would pass the line above.
    fireEvent.click(screen.getByTestId("bodymap-region-shoulder_left"));
    expect(screen.getByTestId("bodymap-panel").textContent).not.toContain("Vælg en kropsdel");
  });

  it("KEYBOARD PARITY: Enter on a marked region clears it, exactly like a tap", () => {
    // F052.11 made this component's accessibility a legal requirement — a
    // pointer-only change would break it silently.
    let last: PainReport | undefined;
    render(<BodyMap onChange={(r) => (last = r)} />);
    mark("bodymap-region-knee_right");
    expect(last).toHaveLength(1);
    fireEvent.keyDown(screen.getByTestId("bodymap-region-knee_right"), { key: "Enter" });
    expect(last).toEqual([]);
  });

  it("Space does the same", () => {
    let last: PainReport | undefined;
    render(<BodyMap onChange={(r) => (last = r)} />);
    mark("bodymap-region-knee_right");
    fireEvent.keyDown(screen.getByTestId("bodymap-region-knee_right"), { key: " " });
    expect(last).toEqual([]);
  });

  it("a NON-SELECTABLE marked region is not cleared by a tap", () => {
    // A locked report is a display, not an editor. This is the "ignore" outcome
    // reaching the renderer, and it is why the core returns three states.
    let last: PainReport | undefined;
    render(
      <BodyMap
        defaultValue={[{ region: "knee_right", intensity: 5, timestamp: "2026-08-28T10:00:00.000Z" }]}
        config={{ knee_right: { selectable: false } }}
        onChange={(r) => (last = r)}
      />,
    );
    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));
    expect(last, "a locked region was cleared").toBeUndefined();
  });

  it("a readOnly map cannot be cleared by tapping", () => {
    let last: PainReport | undefined;
    render(
      <BodyMap
        readOnly
        defaultValue={[{ region: "knee_right", intensity: 5, timestamp: "2026-08-28T10:00:00.000Z" }]}
        onChange={(r) => (last = r)}
      />,
    );
    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));
    expect(last).toBeUndefined();
  });

  it("the «Fjern» button still works — it is the labelled path, and it was NOT deleted", () => {
    let last: PainReport | undefined;
    render(<BodyMap onChange={(r) => (last = r)} />);
    mark("bodymap-region-knee_right");
    expect(last).toHaveLength(1);
    fireEvent.click(screen.getByTestId("bodymap-remove"));
    expect(last).toEqual([]);
  });
});

describe("a pan must never delete a mark (F052.20 raised the stakes on this guard)", () => {
  it("dragging across a MARKED region does not remove it", () => {
    // The suppressClick guard is unchanged by F052.20 — but what it protects
    // against is not. It used to stop a pan from OPENING a panel; it now stops a
    // pan from DELETING the user's pain mark. An untested guard whose failure
    // mode just got worse is worth its own assertion.
    let last: PainReport | undefined;
    render(<BodyMap onChange={(r) => (last = r)} />);
    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));
    fireEvent.click(screen.getByTestId("bodymap-intensity-6"));
    expect(last, "the fixture never marked anything").toHaveLength(1);

    const stage = screen.getByTestId("bodymap-svg");
    const target = screen.getByTestId("bodymap-region-knee_right");
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 180, clientY: 140 }); // > 6px ⇒ a pan
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 180, clientY: 140 });
    fireEvent.click(target); // the synthetic click a browser fires after a drag

    expect(last, "a pan deleted the mark").toHaveLength(1);
  });

  it("NEGATIVE CONTROL: without the pan, the very same click DOES remove it", () => {
    // Without this, a component that had simply stopped responding to clicks
    // would pass the test above.
    let last: PainReport | undefined;
    render(<BodyMap onChange={(r) => (last = r)} />);
    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));
    fireEvent.click(screen.getByTestId("bodymap-intensity-6"));
    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));
    expect(last).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F052.22 — the feedback signal, 2D half.
//
// The vibration MECHANICS are proven in core.test.ts with an injectable
// navigator (all four states + a throwing implementation). What is proven here
// is the WIRING: that a real tap reaches emitFeedback with the outcome that
// actually happened.
// ---------------------------------------------------------------------------

describe("onFeedback — the 2D renderer reports what happened (F052.22)", () => {
  it("select · clear · ignore — the three outcomes a tap can have", () => {
    const seen: Array<{ outcome: string; region: string }> = [];
    render(
      <BodyMap
        onFeedback={(f) => seen.push(f)}
        haptics={false}
        config={{ chest: { selectable: false } }}
      />,
    );

    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));   // unmarked
    fireEvent.click(screen.getByTestId("bodymap-intensity-7"));
    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));   // now marked
    fireEvent.click(screen.getByTestId("bodymap-region-chest"));        // locked

    expect(seen).toEqual([
      { outcome: "select", region: "knee_right" },
      { outcome: "clear", region: "knee_right" },
      { outcome: "ignore", region: "chest" },
    ]);
  });

  it("a tap swallowed by the PAN GUARD emits nothing at all — not even `ignore`", () => {
    // Asserted separately from the locked case on purpose. "Nothing happened
    // because you were panning" and "nothing happened because it is locked" are
    // different events, and one assertion covering both would hide either one:
    // a buzz on every aborted pan is exactly the noise that makes people turn
    // haptics off.
    const seen: Array<{ outcome: string; region: string }> = [];
    render(<BodyMap onFeedback={(f) => seen.push(f)} haptics={false} />);

    const stage = screen.getByTestId("bodymap-svg");
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 180, clientY: 140 }); // > 6px ⇒ a pan
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 180, clientY: 140 });
    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));

    expect(seen, "an aborted pan buzzed").toEqual([]);

    // CONTROL: the very same click, without the pan, DOES emit — otherwise a
    // renderer that had stopped emitting entirely would pass the line above.
    fireEvent.click(screen.getByTestId("bodymap-region-knee_right"));
    expect(seen).toEqual([{ outcome: "select", region: "knee_right" }]);
  });

  it("KEYBOARD PARITY: Enter emits the same signal as a tap (F052.11 is a legal duty here)", () => {
    const seen: Array<{ outcome: string; region: string }> = [];
    render(<BodyMap onFeedback={(f) => seen.push(f)} haptics={false} />);
    fireEvent.keyDown(screen.getByTestId("bodymap-region-neck"), { key: "Enter" });
    expect(seen).toEqual([{ outcome: "select", region: "neck" }]);
  });

  it("readOnly emits nothing — a display-only report is not interactive", () => {
    const seen: unknown[] = [];
    render(
      <BodyMap
        readOnly
        value={[{ region: "chest", intensity: 8, timestamp: "2026-08-28T10:00:00.000Z" }]}
        onFeedback={(f) => seen.push(f)}
      />,
    );
    // chest, not lumbar: lumbar is a BACK region and the default view is front,
    // so the element would simply not exist and the test would pass vacuously.
    fireEvent.click(screen.getByTestId("bodymap-region-chest"));
    expect(seen).toEqual([]);
  });
});
