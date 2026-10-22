// F011.7 — an audit trail written inside the caller's transaction: a failed
// audit write fails the change. The fire-and-forget log is unchanged.
import { describe, expect, it } from "vitest";
import { createAuditTrail, createEventLog, type LogEntry, type LogStore } from "../src/index.js";

/** A tiny fake database with all-or-nothing transactions. */
function fakeDb() {
  const rows = { docs: [] as string[], audit: [] as LogEntry[] };
  type Tx = { docs: string[]; audit: LogEntry[] };
  async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx: Tx = { docs: [...rows.docs], audit: [...rows.audit] };
    const out = await fn(tx); // throws → nothing below runs → rollback
    rows.docs = tx.docs;
    rows.audit = tx.audit;
    return out;
  }
  return { rows, transaction };
}

describe("createAuditTrail.appendIn", () => {
  it("writes the built entry with the host's transaction object, as an audit-layer entry", async () => {
    const seen: { tx: unknown; entry: LogEntry }[] = [];
    const trail = createAuditTrail<{ id: string }>({ appendTx: (tx, entry) => void seen.push({ tx, entry }) });
    const tx = { id: "tx-1" };
    const entry = await trail.appendIn(tx, { kind: "document.updated", actor: { id: "u1" } as never, summary: "edit" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.tx).toBe(tx);
    expect(seen[0]!.entry).toBe(entry);
    expect(entry.layer).toBe("audit");
    expect(entry.kind).toBe("document.updated");
    expect(entry.level).toBe("info");
    expect(typeof entry.id).toBe("string");
  });

  it("waits for an async write before resolving", async () => {
    let done = false;
    const trail = createAuditTrail<null>({ appendTx: async () => { await new Promise((r) => setTimeout(r, 5)); done = true; } });
    await trail.appendIn(null, { kind: "x" });
    expect(done).toBe(true);
  });

  it("a failed audit write throws, and the transaction rolls back the change AND the audit row", async () => {
    const db = fakeDb();
    let fail = false;
    const trail = createAuditTrail<{ docs: string[]; audit: LogEntry[] }>({
      appendTx: (tx, entry) => { if (fail) throw new Error("audit table locked"); tx.audit.push(entry); },
    });
    const change = (name: string) => db.transaction(async (tx) => { tx.docs.push(name); await trail.appendIn(tx, { kind: "document.created", summary: name }); });

    await change("ok-doc");
    expect(db.rows.docs).toEqual(["ok-doc"]);
    expect(db.rows.audit.map((e) => e.summary)).toEqual(["ok-doc"]);

    fail = true;
    await expect(change("lost-doc")).rejects.toThrow("audit table locked");
    expect(db.rows.docs).toEqual(["ok-doc"]);
    expect(db.rows.audit.map((e) => e.summary)).toEqual(["ok-doc"]);
  });
});

describe("the fire-and-forget log is unchanged", () => {
  it("still never throws when its store fails (sync and async)", async () => {
    const errors: unknown[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => void unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    const syncBad: LogStore = { append() { throw new Error("sync boom"); }, read: () => [] };
    const asyncBad: LogStore = { append: async () => { throw new Error("async boom"); }, read: () => [] };
    expect(() => createEventLog(syncBad, { onError: (e) => errors.push(e) }).audit({ kind: "x" })).not.toThrow();
    expect(() => createEventLog(asyncBad, { onError: (e) => errors.push(e) }).audit({ kind: "x" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", onUnhandled);
    expect(errors.map((e) => (e as Error).message)).toEqual(["sync boom", "async boom"]);
    expect(unhandled).toEqual([]);
  });
});
