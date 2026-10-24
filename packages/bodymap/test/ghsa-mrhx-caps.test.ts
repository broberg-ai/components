// GHSA-mrhx-c7xc-m3w5 — zod 4.6.7 bounds only an array that HAS a .max().
// A hostile report one point over the cap must cost ONE issue, not one per point.
import { describe, expect, it } from "vitest";
import { painReportSchema, bodymapReportV1Schema, REGIONS } from "../src/index";

const bad = (n: number) => Array.from({ length: n }, () => ({ nope: 1 }));

describe("bodymap — a report can hold at most one point per region", () => {
  it("painReportSchema: regions+1 bad points → exactly one issue", () => {
    const r = painReportSchema.safeParse(bad(REGIONS.length + 1));
    expect(r.success).toBe(false);
    expect(r.error!.issues.length).toBe(1);
    expect(r.error!.issues[0].code).toBe("too_big");
  });
  it("200k bad points stay one issue", () => {
    expect(painReportSchema.safeParse(bad(200_000)).error!.issues.length).toBe(1);
  });
  it("a full report (every region once) still passes", () => {
    const full = REGIONS.map((r) => ({ region: r.key, intensity: 3, timestamp: "2026-10-24T14:00:00Z" }));
    expect(painReportSchema.safeParse(full).success).toBe(true);
  });
  it("bodymap/v1 points: regions+1 bad points → one issue", () => {
    const r = bodymapReportV1Schema.safeParse({ schema: "bodymap/v1", view: "front", points: bad(REGIONS.length + 1) });
    expect(r.error!.issues.length).toBe(1);
  });
});
