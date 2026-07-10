import { describe, it, expect, vi } from "vitest";
import {
  makeLogEntry,
  createMemoryLogStore,
  filterEntries,
  hashIp,
  anonymizeContact,
  createEventLog,
  LOG_CONFIG,
  type LogEntry,
  type LogStore,
} from "../src/index.js";

describe("makeLogEntry", () => {
  it("stamps id + ISO timestamp and defaults level to info", () => {
    const e = makeLogEntry({ layer: "audit", kind: "auth.login" });
    expect(e.id).toBeTruthy();
    expect(e.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(e.level).toBe("info");
    expect(e.kind).toBe("auth.login");
  });

  it("honours an explicit level + generic kind narrowing", () => {
    const e = makeLogEntry<"a.b" | "c.d">({ layer: "server", kind: "c.d", level: "error" });
    expect(e.level).toBe("error");
    expect(e.kind).toBe("c.d");
  });
});

describe("filterEntries", () => {
  const base: LogEntry[] = [
    { id: "1", at: "2026-07-01T00:00:00Z", layer: "audit", level: "info", kind: "auth.login", actor: { id: "u1", kind: "user" } },
    { id: "2", at: "2026-07-03T00:00:00Z", layer: "activity", level: "info", kind: "agent.ran", actor: { id: "u2", kind: "llm" } },
    { id: "3", at: "2026-07-02T00:00:00Z", layer: "audit", level: "error", kind: "auth.login_failed", actor: { id: "u1", kind: "user" } },
  ];

  it("returns newest-first", () => {
    expect(filterEntries(base).map((e) => e.id)).toEqual(["2", "3", "1"]);
  });
  it("filters by layer / level / actorId / since / kindPrefix", () => {
    expect(filterEntries(base, { layer: "audit" }).map((e) => e.id)).toEqual(["3", "1"]);
    expect(filterEntries(base, { level: "error" }).map((e) => e.id)).toEqual(["3"]);
    expect(filterEntries(base, { actorId: "u1" }).map((e) => e.id)).toEqual(["3", "1"]);
    expect(filterEntries(base, { since: "2026-07-02T00:00:00Z" }).map((e) => e.id)).toEqual(["2", "3"]);
    expect(filterEntries(base, { kindPrefix: "auth." }).map((e) => e.id)).toEqual(["3", "1"]);
  });
  it("respects limit", () => {
    expect(filterEntries(base, { limit: 1 }).map((e) => e.id)).toEqual(["2"]);
  });
  it("exposes retention config as named constants", () => {
    expect(LOG_CONFIG.MAX_AGE_DAYS).toBe(365);
    expect(LOG_CONFIG.MAX_LINES).toBeGreaterThan(0);
  });
});

describe("hashIp", () => {
  it("returns an 8-char one-way hash by default, full digest on demand", async () => {
    const short = await hashIp("192.168.0.1");
    expect(short).toMatch(/^[0-9a-f]{8}$/);
    const full = await hashIp("192.168.0.1", { full: true });
    expect(full).toHaveLength(64);
    expect(full.startsWith(short)).toBe(true);
    // deterministic + not the raw ip
    expect(await hashIp("192.168.0.1")).toBe(short);
    expect(short).not.toContain("192");
  });
});

describe("anonymizeContact", () => {
  it("replaces only the named fields with [deleted]", () => {
    const row = { name: "Sanne", email: "s@x.dk", city: "Blokhus" };
    const out = anonymizeContact(row, ["name", "email", "missing"]);
    expect(out).toEqual({ name: "[deleted]", email: "[deleted]", city: "Blokhus" });
    // original untouched (pure)
    expect(row.name).toBe("Sanne");
  });
});

describe("createEventLog — fire-and-forget", () => {
  it("writes entries through the store with layer helpers + convenience wrappers", () => {
    const store = createMemoryLogStore();
    const log = createEventLog(store);
    log.logLogin({ id: "u1", kind: "user" });
    log.logDocumentDeleted({ id: "u1", kind: "user" }, { type: "doc", id: "d9" });
    log.serverError("boom", { code: 500 });
    const kinds = store.entries.map((e) => `${e.layer}:${e.kind}:${e.level}`);
    expect(kinds).toEqual([
      "audit:auth.login:info",
      "audit:document.deleted:warn",
      "server:server.error:error",
    ]);
  });

  it("NEVER throws when the store append throws (sync) — routes to onError", () => {
    const onError = vi.fn();
    const throwingStore: LogStore = {
      append() {
        throw new Error("db down");
      },
      read: () => [],
    };
    const log = createEventLog(throwingStore, { onError });
    expect(() => log.logLogin({ id: "u1", kind: "user" })).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("swallows an async append rejection (never unhandled) via onError", async () => {
    const onError = vi.fn();
    const asyncThrowing: LogStore = {
      append: () => Promise.reject(new Error("async db down")),
      read: () => [],
    };
    const log = createEventLog(asyncThrowing, { onError });
    log.logExport({ id: "u1", kind: "user" });
    await Promise.resolve(); // let the rejection settle
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("read() delegates to the store with filters", () => {
    const store = createMemoryLogStore();
    const log = createEventLog(store);
    log.logLogin({ id: "u1", kind: "user" });
    log.logAgentRan({ id: "bot", kind: "llm" }, "did a thing");
    const audit = log.read({ layer: "audit" }) as LogEntry[];
    expect(audit).toHaveLength(1);
    expect(audit[0].kind).toBe("auth.login");
  });
});
