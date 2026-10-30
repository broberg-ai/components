import { describe, expect, it } from "vitest";
import { securityBehind, SECURITY_NOTE } from "./security-behind";
import { DATA } from "../../scripts/inventory-data.mjs";

const rows = (DATA as Array<{ items?: unknown[] }>).flatMap((L) => (L.items ?? []) as Array<{ pkg?: string; ver?: string; sec?: { v: string; why: string; since?: string }[] }>);

describe("F039.9 — behind on a security release is its own signal", () => {
  it("the real case: buddy on @broberg/secret-scan 0.5.0 is told it is behind, with the reason and where to move", () => {
    const r = securityBehind([{ pkg: "@broberg/secret-scan", version: "0.5.0" }], rows);
    expect(r).toHaveLength(1);
    expect(r[0]!.pkg).toBe("@broberg/secret-scan");
    expect(r[0]!.have).toBe("0.5.0");
    expect(r[0]!.move_to).toBe(rows.find((x) => x.pkg === "@broberg/secret-scan")!.ver);
    expect(r[0]!.fixes.map((f) => f.v)).toStrictEqual(["0.7.0"]); // 0.12.1's defect only ever existed in 0.12.0
    expect(r[0]!.fixes[0]!.why).toMatch(/quoted/i);
  });

  it("a `since` bound keeps a later-introduced defect off older versions, and on the affected one", () => {
    const at12 = securityBehind([{ pkg: "@broberg/secret-scan", version: "0.12.0" }], rows);
    expect(at12[0]!.fixes.map((f) => f.v)).toStrictEqual(["0.12.1"]);
  });

  it("a CURRENT session gets nothing at all", () => {
    const cur = rows.find((x) => x.pkg === "@broberg/secret-scan")!.ver!;
    expect(securityBehind([{ pkg: "@broberg/secret-scan", version: cur }], rows)).toStrictEqual([]);
  });

  it("NEGATIVE CONTROL: an UNMARKED package yields nothing — and nothing claims it is clean", () => {
    const r = securityBehind([{ pkg: "@broberg/mail", version: "0.1.0" }], rows);
    expect(r).toStrictEqual([]);
    expect(SECURITY_NOTE).not.toMatch(/no (known )?security (issues|problems)|is (safe|secure|clean)/i);
  });

  it("the served wording announces a POSSIBILITY, not a task", () => {
    expect(SECURITY_NOTE).toMatch(/possibility, not a task/i);
    expect(SECURITY_NOTE).toMatch(/Christian's decision/);
    expect(SECURITY_NOTE).not.toMatch(/\b(must|you need to|upgrade now|required)\b/i);
  });

  it("marks are set by the owner in the roster source — every mark has a version and a one-line reason", () => {
    const marked = rows.filter((r) => r.sec?.length);
    expect(marked.length).toBeGreaterThan(0);
    for (const r of marked) for (const m of r.sec!) {
      expect(m.v).toMatch(/^\d+\.\d+\.\d+$/);
      expect(m.why.length).toBeGreaterThan(20);
      expect(m.why).not.toContain("\n");
    }
  });
});
