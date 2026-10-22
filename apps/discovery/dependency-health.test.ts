// F082.5 — the weekly dependency check: what it counts, and that «could not
// check» never reads as clean.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { summarizeAudit, summarizeOutdated, verdict, findingsToCard } from "../../scripts/dependency-health.mjs";
process.env.ENROLL_DB_URL = ":memory:";
import { app } from "./server";
import { getEnrollStore } from "./enroll";
import { depText } from "./packages-page";

const AUDIT = {
  advisories: {
    "1": { severity: "critical", findings: [{ paths: ["packages__auth>better-auth>x", "packages__auth>other>x"] }] },
    "2": { severity: "high", findings: [{ paths: ["packages__auth>y", "packages__media-transform>sharp"] }] },
    "3": { severity: "info", findings: [{ paths: ["packages__auth>z"] }] },
  },
};

describe("summarizeAudit", () => {
  it("counts each advisory ONCE per package, by severity; info is ignored", () => {
    expect(summarizeAudit(AUDIT)).toEqual({
      "packages/auth": { critical: 1, high: 1, moderate: 0, low: 0 },
      "packages/media-transform": { critical: 0, high: 1, moderate: 0, low: 0 },
    });
  });
});

describe("summarizeAudit — a peer the app supplies is not what the package ships", () => {
  // Measured 23/10: @broberg/auth's 5 critical + 14 high all came through its
  // optional peer `next`, which pnpm auto-installs here for tests.
  const PEER_AUDIT = {
    advisories: {
      "1": { severity: "critical", findings: [{ paths: ["packages__auth>next"] }] },
      "2": { severity: "high", findings: [{ paths: ["packages__media-transform>sharp"] }] },
      "3": { severity: "high", findings: [{ paths: ["packages__auth>next>postcss", "packages__auth>jose"] }] },
    },
  };
  const shipped: Record<string, string[]> = { "packages/auth": ["jose"], "packages/media-transform": ["sharp"] };
  const counts = (dir: string, dep: string) => shipped[dir]?.includes(dep) ?? true;
  it("drops a finding reached only through a peer, keeps one a real dependency also reaches", () => {
    expect(summarizeAudit(PEER_AUDIT, counts)).toEqual({
      "packages/auth": { critical: 0, high: 1, moderate: 0, low: 0 },
      "packages/media-transform": { critical: 0, high: 1, moderate: 0, low: 0 },
    });
  });
});

describe("summarizeOutdated", () => {
  it("separates what ships (dependencies/peer) from dev tooling", () => {
    expect(summarizeOutdated({
      a: { dependencyType: "dependencies", isDeprecated: false },
      b: { dependencyType: "devDependencies", isDeprecated: true },
      c: { dependencyType: "peerDependencies", isDeprecated: false },
    })).toEqual({ total: 3, shipped: 2, deprecated: 1 });
  });
});

describe("verdict — «could not check» is never «OK»", () => {
  const z = { critical: 0, high: 0, moderate: 0, low: 0 };
  it("error → kunne ikke tjekke, even with zero counts", () => {
    expect(verdict({ status: "error", prod: z })).toBe("kunne ikke tjekke");
  });
  it("critical/high in prod → sårbar; moderate/low → mindre fund; none → OK; dev-only findings do not count", () => {
    expect(verdict({ status: "ok", prod: { ...z, high: 1 } })).toBe("sårbar");
    expect(verdict({ status: "ok", prod: { ...z, moderate: 2 } })).toBe("mindre fund");
    expect(verdict({ status: "ok", prod: z, dev: { ...z, critical: 9 } })).toBe("OK");
  });
});

describe("findingsToCard — high/critical in what ships becomes a card", () => {
  it("one card per vulnerable package; a check that errored or only has moderate makes none", () => {
    const z = { critical: 0, high: 0, moderate: 0, low: 0 };
    const cards = findingsToCard({
      checked_at: "2026-10-23T01:37:00Z",
      packages: {
        "@broberg/auth": { version: "0.7.1", status: "ok", prod: { ...z, critical: 5, high: 14, moderate: 11 } },
        "@broberg/mail": { version: "1.0.0", status: "ok", prod: { ...z, moderate: 3 } },
        "@broberg/x": { version: "0.1.0", status: "error", prod: { ...z, high: 9 } },
      },
    });
    expect(cards.map((c: { title: string }) => c.title)).toEqual(["@broberg/auth: 5 kritiske og 14 høje sårbarheder i det pakken leverer"]);
  });
});

describe("/packages shows the dependency status", () => {
  it("the auth row carries the committed result, and the hero counts the vulnerable packages", async () => {
    const k = "d".repeat(64);
    await (await getEnrollStore())!.bindSessionKey("t-deps", createHash("sha256").update(k).digest("hex"));
    const html = await (await app.request("/packages", { headers: { "x-discovery-session": "t-deps", "x-enroll-key": k } })).text();
    const data = JSON.parse(readFileSync(new URL("../../data/dependency-health.json", import.meta.url), "utf8"));
    const auth = data.packages["@broberg/auth"];
    const row = html.match(/<tr data-testid="pkg-row-\d+" data-name="@broberg\/auth"[^>]*>.*?<\/tr>/)![0];
    const cell = row.match(/data-testid="pkg-deps-\d+"[^>]*>([^<]*)</)![1];
    expect(cell).toBe(depText({ verdict: auth.verdict, prod: auth.prod, checkedAt: data.checked_at }));
    const vulnerable = Object.values(data.packages).filter((p: any) => p.verdict === "sårbar").length;
    expect(html).toContain(`${vulnerable} med sårbare afhængigheder`);
  });
});
