// F082.5 — the weekly dependency check: what it counts, and that «could not
// check» never reads as clean.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { summarizeAudit, summarizeOutdated, verdict, findingsToCard, lockedShipped, osvSeverity, summarizeOsv, queryOsv } from "../../scripts/dependency-health.mjs";
import { planIssues } from "../../scripts/dependency-alarm.mjs";
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

// ── F082.9 — OSV.dev, daily ─────────────────────────────────────────────────
const LOCK = {
  importers: {
    "packages/a": {
      dependencies: { zod: { version: "4.6.5" }, "@broberg/b": { version: "link:../b" }, alias: { version: "string-width@4.2.3" } },
      devDependencies: { vitest: { version: "2.1.9" } },
    },
    "packages/b": { dependencies: { ms: { version: "2.1.3" } } },
  },
  snapshots: {
    "zod@4.6.5": {},
    "ms@2.1.3": {},
    "string-width@4.2.3": { dependencies: { "strip-ansi": "6.0.1(x@1.0.0)" } },
    "strip-ansi@6.0.1(x@1.0.0)": {},
    "vitest@2.1.9": { dependencies: { evil: "1.0.0" } },
  },
};

describe("lockedShipped — what a package ships, read from the lockfile", () => {
  it("walks dependencies, workspace links and aliases; drops peer suffixes; ignores dev and peers", () => {
    expect([...lockedShipped(LOCK, "packages/a", ["zod", "@broberg/b", "alias"])].sort())
      .toEqual(["ms@2.1.3", "string-width@4.2.3", "strip-ansi@6.0.1", "zod@4.6.5"]);
  });
  it("a name not in package.json `dependencies` (a peer pnpm installed) is not counted", () => {
    expect([...lockedShipped(LOCK, "packages/a", [])]).toEqual([]);
  });
});

describe("osvSeverity", () => {
  it("GHSA severity is read; MAL-* is always critical; missing is unrated, never low", () => {
    expect(osvSeverity({ id: "GHSA-x", database_specific: { severity: "HIGH" } })).toBe("high");
    expect(osvSeverity({ id: "MAL-2026-1" })).toBe("critical");
    expect(osvSeverity({ id: "OSV-1" })).toBe("unrated");
  });
});

const ZOD_HOLE = { id: "GHSA-mrhx-c7xc-m3w5", aliases: ["CVE-2023-54404"], summary: "Zod can exhaust memory", database_specific: { severity: "HIGH" } };

describe("summarizeOsv", () => {
  it("counts a hole once per package, marks KEV, and says when KEV was unread", () => {
    const by = new Map([["zod@4.6.5", [ZOD_HOLE]], ["ms@2.1.3", [ZOD_HOLE]]]);
    const s = summarizeOsv(new Set(["zod@4.6.5", "ms@2.1.3"]), by, new Set(["CVE-2023-54404"]));
    expect(s).toMatchObject({ status: "ok", high: 1, critical: 0 });
    expect(s.findings).toEqual([expect.objectContaining({ id: ZOD_HOLE.id, kev: true, malicious: false })]);
    expect(summarizeOsv(new Set(["zod@4.6.5"]), by, null).findings[0].kev).toBe(null);
  });
  it("verdict reads OSV: a high there is «sårbar», an OSV error is «kunne ikke tjekke»", () => {
    const z = { critical: 0, high: 0, moderate: 0, low: 0 };
    expect(verdict({ status: "ok", prod: z, osv: { status: "ok", ...z, unrated: 0, high: 1 } })).toBe("sårbar");
    expect(verdict({ status: "ok", prod: z, osv: { status: "error", error: "x" } })).toBe("kunne ikke tjekke");
    expect(verdict({ status: "ok", prod: z, osv: { status: "ok", ...z, unrated: 0 } })).toBe("OK");
  });
});

describe("queryOsv — «could not ask» throws, never returns empty", () => {
  const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j });
  it("asks once for all deps, then fetches each hole once", async () => {
    const calls: string[] = [];
    const f = async (url: string) => {
      calls.push(url);
      return url.endsWith("querybatch") ? ok({ results: [{ vulns: [{ id: ZOD_HOLE.id }] }, {}] }) : ok(ZOD_HOLE);
    };
    const m = await queryOsv(new Set(["zod@4.6.5", "zod@4.6.7"]), f as any);
    expect(m.get("zod@4.6.5")).toEqual([ZOD_HOLE]);
    expect(m.has("zod@4.6.7")).toBe(false);
    expect(calls.length).toBe(2);
  });
  it("an HTTP error or a short answer throws", async () => {
    await expect(queryOsv(new Set(["a@1"]), (async () => ({ ok: false, status: 503 })) as any)).rejects.toThrow("503");
    await expect(queryOsv(new Set(["a@1", "b@1"]), (async () => ok({ results: [{}] })) as any)).rejects.toThrow("does not match");
  });
});

describe("planIssues — one issue per hole, closed when it is gone", () => {
  const z = { critical: 0, high: 0, moderate: 0, low: 0, unrated: 0 };
  const finding = { id: ZOD_HOLE.id, dep: "zod@4.6.5", severity: "high", summary: "s", malicious: false, kev: false };
  const result = (findings: unknown[], osv = "ok") => ({
    checked_at: "2026-10-24T01:37:00Z", sources: { osv },
    packages: {
      "@broberg/a": { version: "0.1.0", osv: { status: "ok", ...z, high: 1, findings } },
      "@broberg/b": { version: "0.2.0", osv: { status: "ok", ...z, high: 1, findings } },
    },
  });
  it("opens one issue naming every package, keyed «[id]»", () => {
    const p = planIssues(result([finding]), []);
    expect(p.open.map((o: any) => o.title)).toEqual([`[${ZOD_HOLE.id}] zod@4.6.5 — high`]);
    expect(p.open[0].body).toContain("`@broberg/a@0.1.0`, `@broberg/b@0.2.0`");
  });
  it("does not reopen an open one; closes one whose hole is gone; moderate opens nothing", () => {
    expect(planIssues(result([finding]), [{ number: 7, title: `[${ZOD_HOLE.id}] zod@4.6.5 — high` }])).toMatchObject({ open: [], close: [] });
    expect(planIssues(result([]), [{ number: 7, title: `[${ZOD_HOLE.id}] x` }]).close.map((c: any) => c.number)).toEqual([7]);
    expect(planIssues(result([{ ...finding, severity: "moderate" }]), []).open).toEqual([]);
  });
  it("could not ask OSV → opens nothing and closes NOTHING", () => {
    expect(planIssues(result([], "error"), [{ number: 7, title: "[GHSA-x] y" }])).toEqual({ open: [], close: [], couldNotCheck: true });
  });
});
