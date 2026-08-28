import { describe, it, expect, vi } from "vitest";
import {
  REGIONS,
  getRegion,
  painPointSchema,
  painReportSchema,
  createPainSelection,
  resolveRegions,
  isSelectable,
  decidePick,
  requestVibration,
  emitFeedback,
  VIBRATION_PATTERNS,
  type PainReport,
  serializeReport,
  deserializeReport,
  bodymapReportV1Schema,
} from "../src/index";

const now = () => "2026-07-04T12:00:00Z";

describe("REGIONS taxonomy (fd-sundhed authoritative)", () => {
  it("has 15+ named regions; keys unique; (code,side) unique; side-less codes repeat", () => {
    expect(REGIONS.length).toBeGreaterThanOrEqual(15);
    const keys = new Set(REGIONS.map((r) => r.key));
    expect(keys.size).toBe(REGIONS.length); // keys unique
    const codeSide = new Set(REGIONS.map((r) => `${r.code}|${r.side ?? "center"}`));
    expect(codeSide.size).toBe(REGIONS.length); // (code,side) unique
    // side-less codes: SHOULDER appears for both sides
    expect(REGIONS.filter((r) => r.code === "SHOULDER").length).toBe(2);
    for (const r of REGIONS) {
      expect(r.label).toBeTruthy();
      expect(r.code).toBeTruthy();
    }
  });
  it("getRegion looks up by key; codes are the fd-sundhed side-less clinical codes", () => {
    expect(getRegion("lumbar")?.code).toBe("LUMBAR");
    expect(getRegion("knee_right")).toMatchObject({ code: "KNEE", side: "right" });
    expect(getRegion("nope")).toBeUndefined();
  });
});

describe("PainReport zod model", () => {
  const base = { region: "lumbar", intensity: 8, type: "stikkende", timestamp: "2026-07-04T00:00:00Z" };
  it("accepts a valid pain point", () => {
    expect(painPointSchema.parse(base).region).toBe("lumbar");
  });
  it("rejects an unknown region", () => {
    expect(() => painPointSchema.parse({ ...base, region: "left_pinky" })).toThrow();
  });
  it("rejects out-of-range / non-integer intensity", () => {
    expect(() => painPointSchema.parse({ ...base, intensity: 11 })).toThrow();
    expect(() => painPointSchema.parse({ ...base, intensity: -1 })).toThrow();
    expect(() => painPointSchema.parse({ ...base, intensity: 3.5 })).toThrow();
  });
  it("type is optional but constrained to the fixed set", () => {
    expect(painPointSchema.parse({ ...base, type: undefined }).type).toBeUndefined();
    expect(() => painPointSchema.parse({ ...base, type: "brændende" })).toThrow();
  });
});

describe("selection engine", () => {
  it("set/update/remove/getReport — one point per region, latest wins", () => {
    const sel = createPainSelection([], { now });
    sel.set("knee_right", 5, "dump");
    sel.set("knee_right", 7, "jagende");
    sel.set("neck", 3);
    expect(sel.has("knee_right")).toBe(true);
    expect(sel.get("knee_right")?.intensity).toBe(7);
    const report = sel.getReport();
    expect(report.length).toBe(2);
    expect(painReportSchema.parse(report)).toEqual(report);
    sel.remove("neck");
    expect(sel.getReport().length).toBe(1);
  });
  it("seeds from an initial report and validates it", () => {
    const sel = createPainSelection([{ region: "chest", intensity: 4, timestamp: now() }], { now });
    expect(sel.get("chest")?.intensity).toBe(4);
    expect(() =>
      createPainSelection([{ region: "chest", intensity: 99, timestamp: now() } as any]),
    ).toThrow();
  });
});

describe("RegionConfig (per-app toggle)", () => {
  it("resolveRegions honours visible (default true)", () => {
    expect(resolveRegions().length).toBe(REGIONS.length);
    const filtered = resolveRegions({
      hand_left: { visible: false },
      hand_right: { visible: false },
    });
    expect(filtered.length).toBe(REGIONS.length - 2);
    expect(filtered.find((r) => r.key === "hand_left")).toBeUndefined();
  });
  it("isSelectable honours selectable + hidden", () => {
    expect(isSelectable("neck")).toBe(true);
    expect(isSelectable("neck", { neck: { selectable: false } })).toBe(false);
    expect(isSelectable("neck", { neck: { visible: false } })).toBe(false);
  });
});

describe("bodymap/v1 serialization", () => {
  it("serializes to { schema, view, points:[{region CODE (side-less), side, intensity, quality}] }", () => {
    const sel = createPainSelection([], { now });
    sel.set("lumbar", 8, "stikkende");
    sel.set("knee_right", 5, "dump");
    const env = serializeReport(sel.getReport(), { view: "front" });
    expect(env.schema).toBe("bodymap/v1");
    expect(env.view).toBe("front");
    expect(bodymapReportV1Schema.parse(env)).toEqual(env);
    const lumb = env.points.find((p) => p.region === "LUMBAR")!;
    expect(lumb).toMatchObject({ region: "LUMBAR", side: "center", intensity: 8, quality: "stikkende" });
    const knee = env.points.find((p) => p.region === "KNEE")!;
    expect(knee.side).toBe("right");
  });
  it("round-trips deserialize(serialize(report)) using code+side (so left/right disambiguate)", () => {
    const sel = createPainSelection([], { now });
    sel.set("neck", 6, "konstant");
    sel.set("shoulder_left", 4);
    sel.set("shoulder_right", 9, "jagende");
    const back = deserializeReport(serializeReport(sel.getReport()), now);
    expect(back.map((p) => p.region).sort()).toEqual(["neck", "shoulder_left", "shoulder_right"]);
    expect(back.find((p) => p.region === "shoulder_right")).toMatchObject({ intensity: 9, type: "jagende" });
  });
  it("drops points whose region CODE+side is unknown to this taxonomy", () => {
    const back = deserializeReport(
      { schema: "bodymap/v1", view: "front", points: [{ region: "NOPE", side: "center", intensity: 3 }] },
      now,
    );
    expect(back.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F052.20 — picking a marked region CLEARS it.
//
// fd-sundhed's user: «Hvorfor kan jeg ikke bare trykke på punktet igen og det
// forsvinder?» Christian chose "remove immediately" with the cost stated: this
// tap used to be the only way to re-open a marked region and change its
// intensity, so that now means clear it and mark it again.
//
// The rule lives here, in the core, because the 2D and 3D renderers share no
// click code — and a rule written twice is a rule that drifts.
// ---------------------------------------------------------------------------

describe("decidePick — one rule, both renderers", () => {
  const marked: PainReport = [{ region: "LUMBAR", intensity: 8, timestamp: "2026-08-28T10:00:00.000Z" }];

  it("a MARKED region is cleared; an UNMARKED one is selected", () => {
    expect(decidePick("LUMBAR", marked)).toBe("clear");
    // The control, one line below: without it, a function returning "clear" for
    // everything would pass the line above.
    expect(decidePick("NECK", marked)).toBe("select");
  });

  it("an empty report never clears — there is nothing to remove", () => {
    expect(decidePick("LUMBAR", [])).toBe("select");
  });

  it("THREE outcomes, not two: a locked region is IGNORED, never cleared", () => {
    // "nothing happened because it is locked" and "nothing happened because we
    // removed the mark" must never look alike to a caller.
    expect(decidePick("LUMBAR", marked, { LUMBAR: { selectable: false } })).toBe("ignore");
    expect(decidePick("LUMBAR", marked, { LUMBAR: { visible: false } })).toBe("ignore");
    expect(decidePick("NECK", marked, { NECK: { selectable: false } })).toBe("ignore");
  });

  it("a lock on ANOTHER region does not protect this one", () => {
    expect(decidePick("LUMBAR", marked, { NECK: { selectable: false } })).toBe("clear");
  });

  it("the three outcomes are genuinely distinguishable", () => {
    const seen = new Set([
      decidePick("LUMBAR", marked),
      decidePick("NECK", marked),
      decidePick("LUMBAR", marked, { LUMBAR: { selectable: false } }),
    ]);
    expect(seen.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// F052.22 — the feedback signal.
//
// Christian asked for sound + haptics. The measurement that shaped this: WebKit
// (every browser on an iPhone) has NO navigator.vibrate at all, so the package
// ships the SIGNAL and each app wires the effect it can actually deliver —
// Capacitor Haptics natively, @broberg/soundkit for sound.
// ---------------------------------------------------------------------------

const navWith = (vibrate: unknown) => ({ vibrate }) as unknown;

describe("requestVibration — four states, because four things can happen", () => {
  it("distinguishes unsupported · declined · requested — ALL THREE in one test", () => {
    // The control is the whole test. A stub that always answered "requested"
    // passes any one of these lines on its own.
    expect(requestVibration([12], navWith(undefined) as never)).toBe("unsupported");
    expect(requestVibration([12], navWith(() => false) as never)).toBe("declined");
    expect(requestVibration([12], navWith(() => true) as never)).toBe("requested");
  });

  it("an EMPTY pattern is `skipped` and never reaches the browser at all", () => {
    // VIBRATION_PATTERNS.ignore is empty on purpose: a tap that changed nothing
    // must not feel like it changed something.
    const vibrate = vi.fn(() => true);
    expect(requestVibration([], navWith(vibrate) as never)).toBe("skipped");
    expect(vibrate, "a no-op tap buzzed").not.toHaveBeenCalled();
    expect(VIBRATION_PATTERNS.ignore).toEqual([]);
    // …and the control: a real pattern DOES reach it, with the pattern intact.
    expect(requestVibration(VIBRATION_PATTERNS.clear, navWith(vibrate) as never)).toBe("requested");
    expect(vibrate).toHaveBeenCalledWith([8, 40, 8]);
  });

  it("a vibrate that THROWS is `declined` — an embedded webview must not crash the pick", () => {
    const boom = () => { throw new Error("NotAllowedError"); };
    expect(requestVibration([12], navWith(boom) as never)).toBe("declined");
    // …and the whole point of catching it: emitFeedback is called BEFORE the
    // renderer sets or clears the mark, so if a refused buzz escaped as an
    // exception the user's pain mark would silently not be recorded. Assert
    // that it does not throw, not merely that it returns a word.
    const onFeedback = vi.fn();
    expect(() => emitFeedback("select", "neck", { onFeedback, nav: navWith(boom) })).not.toThrow();
    expect(onFeedback, "the signal was lost with the exception").toHaveBeenCalledWith({
      outcome: "select",
      region: "neck",
    });
  });

  it("`requested` is not a delivery claim — it is the only word the API can support", () => {
    // Documented as an assertion so nobody later renames it to something that
    // promises the motor moved. Silent mode, no motor, and no user gesture yet
    // all return true from navigator.vibrate and produce nothing.
    const outcomes = new Set([
      requestVibration([12], navWith(undefined) as never),
      requestVibration([12], navWith(() => false) as never),
      requestVibration([12], navWith(() => true) as never),
      requestVibration([], navWith(() => true) as never),
    ]);
    expect(outcomes.size).toBe(4);
    expect(outcomes.has("delivered" as never)).toBe(false);
  });
});

describe("emitFeedback — the signal always, the buzz optionally", () => {
  it("passes the outcome and region through, for all three outcomes", () => {
    const onFeedback = vi.fn();
    emitFeedback("select", "neck", { onFeedback, nav: navWith(() => true) });
    emitFeedback("clear", "lumbar", { onFeedback, nav: navWith(() => true) });
    emitFeedback("ignore", "chest", { onFeedback, nav: navWith(() => true) });
    expect(onFeedback.mock.calls.map((c) => c[0])).toEqual([
      { outcome: "select", region: "neck" },
      { outcome: "clear", region: "lumbar" },
      { outcome: "ignore", region: "chest" },
    ]);
  });

  it("haptics defaults ON: select and clear buzz, ignore does not", () => {
    const vibrate = vi.fn(() => true);
    const nav = navWith(vibrate);
    expect(emitFeedback("select", "neck", { nav })).toBe("requested");
    expect(emitFeedback("clear", "neck", { nav })).toBe("requested");
    expect(emitFeedback("ignore", "neck", { nav })).toBe("skipped");
    expect(vibrate.mock.calls).toEqual([[[12]], [[8, 40, 8]]]);
  });

  it("haptics:false drops the buzz and KEEPS the signal — an app may want sound only", () => {
    const vibrate = vi.fn(() => true);
    const onFeedback = vi.fn();
    expect(emitFeedback("select", "neck", { onFeedback, haptics: false, nav: navWith(vibrate) })).toBe("skipped");
    expect(vibrate).not.toHaveBeenCalled();
    expect(onFeedback).toHaveBeenCalledWith({ outcome: "select", region: "neck" });
  });
});
