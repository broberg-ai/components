import { describe, expect, it } from "vitest";
import { measuredFor, reconcile, repoForSession, STALE_DAYS, type Scan } from "./fleet-reconcile";
import { readFileSync } from "node:fs";
import { SESSION_REPOS } from "../../scripts/inventory-data.mjs";

const realScan = JSON.parse(readFileSync(new URL("../../data/fleet-deps.json", import.meta.url), "utf8")) as Scan;

describe("F039.6 — reconcile a session against the daily repo scan", () => {
  it("buddy's REAL monorepo: several @broberg/ai-sdk occurrences render as several rows, with their paths", () => {
    const repo = repoForSession("buddy", realScan, SESSION_REPOS);
    expect(repo).toBe("webhousecode/buddy");
    const rows = measuredFor(repo!, realScan).filter((r) => r.pkg === "@broberg/ai-sdk");
    expect(rows.length).toBeGreaterThan(1);
    expect(new Set(rows.map((r) => r.at)).size).toBe(rows.length); // one row per manifest, not merged
  });

  it("a curated mapping wins for a session not named after its repo; an unknown session maps to null, not a guess", () => {
    expect(repoForSession("bid", realScan, SESSION_REPOS)).toBe("broberg-ai/broberg-id");
    expect(repoForSession("no-such-session-xyz", realScan, SESSION_REPOS)).toBeNull();
  });

  const measured = [
    { pkg: "@broberg/a", range: "0.1.3", at: "package.json" },
    { pkg: "@broberg/b", range: "^0.2.0", at: "apps/x/package.json" },
    { pkg: "@broberg/c", range: "1.0.0", at: "package.json" },
    { pkg: "@broberg/d", range: "0.4.0", at: "package.json" },
    { pkg: "@broberg/e", range: "0.5.0", at: "package.json" },
  ];

  it("PARTIAL: 1 reported of 5 measured is NOT complete — the other four are named", () => {
    const r = reconcile([{ pkg: "@broberg/a", version: "0.1.3" }], measured, Date.now());
    expect(r.unreported).toStrictEqual(["@broberg/b", "@broberg/c", "@broberg/d", "@broberg/e"]);
  });

  it("MISMATCH: a reported version that differs from an exact pin is flagged; a caret range is not judged", () => {
    const r = reconcile(
      [{ pkg: "@broberg/a", version: "0.1.0" }, { pkg: "@broberg/b", version: "0.2.9" }],
      measured,
      Date.now(),
    );
    expect(r.mismatch).toStrictEqual([{ pkg: "@broberg/a", reported: "0.1.0", pinned: "0.1.3", at: "package.json" }]);
  });

  it("STALE past the agreed age — marked, never removed", () => {
    const now = Date.UTC(2026, 9, 30);
    const old = new Date(now - (STALE_DAYS + 1) * 86_400_000).toISOString();
    const fresh = new Date(now - 86_400_000).toISOString();
    const enrolled = [
      { pkg: "@broberg/a", version: "0.1.3", updated_at: old },
      { pkg: "@broberg/c", version: "1.0.0", updated_at: fresh },
    ];
    const r = reconcile(enrolled, measured, now);
    expect(r.stale).toStrictEqual(["@broberg/a"]);
    expect(enrolled).toHaveLength(2); // nothing deleted
  });
});
