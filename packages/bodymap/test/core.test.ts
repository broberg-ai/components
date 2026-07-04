import { describe, it, expect } from "vitest";
import {
  REGIONS,
  getRegion,
  painPointSchema,
  painReportSchema,
  createPainSelection,
  resolveRegions,
  isSelectable,
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
