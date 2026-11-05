/**
 * F093.3 — backup in parts (cardmem: 850 MB on a 4 GB machine).
 * Same guarantees as the single file, one page held at a time.
 */
import { beforeAll, describe, expect, test } from "vitest";
import {
  backupFreshness,
  manifestKey,
  objectKey,
  openDbBackupParts,
  partKey,
  runDbBackup,
  runDbBackupParts,
  type BackupPageSource,
  type BackupPartsManifest,
  type BackupStore,
} from "../src/index";

const pem = (label: string, der: ArrayBuffer) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;

let publicKeyPem = "";
let privateKeyPem = "";
let otherPrivateKeyPem = "";

beforeAll(async () => {
  const make = async () =>
    (await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["encrypt", "decrypt"],
    )) as CryptoKeyPair;
  const pair = await make();
  publicKeyPem = pem("PUBLIC KEY", await crypto.subtle.exportKey("spki", pair.publicKey));
  privateKeyPem = pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  otherPrivateKeyPem = pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", (await make()).privateKey));
});

function memory(): BackupStore & { mem: Map<string, Uint8Array>; uploads: string[] } {
  const mem = new Map<string, Uint8Array>();
  const uploads: string[] = [];
  return {
    mem,
    uploads,
    upload: async (k, b) => {
      uploads.push(k);
      mem.set(k, b);
    },
    get: async (k) => (mem.has(k) ? { bytes: mem.get(k)! } : null),
    delete: async (k) => void mem.delete(k),
  };
}

/** A table of `n` rows handed out a page at a time; counts pages handed out. */
function pagedSource(tables: Record<string, number>) {
  const handedOut = { n: 0 };
  const src: BackupPageSource = {
    listTables: async () => Object.keys(tables),
    async *pages(table, pageSize) {
      for (let i = 0; i < tables[table]; i += pageSize) {
        handedOut.n++;
        yield Array.from({ length: Math.min(pageSize, tables[table] - i) }, (_, k) => ({ id: `${table}-${i + k}`, email: `u${i + k}@x.dk`, n: BigInt(i + k) }));
      }
    },
  };
  return { src, handedOut };
}

const NOW = Date.UTC(2026, 10, 5);
const today = "2026-11-05";
const manifestOf = (store: ReturnType<typeof memory>, key = manifestKey(today)) =>
  JSON.parse(new TextDecoder().decode(store.mem.get(key)!)) as BackupPartsManifest;

async function openAll(store: BackupStore, manifest: BackupPartsManifest, key = privateKeyPem) {
  const out: Record<string, unknown[]> = {};
  for await (const p of openDbBackupParts({ store, manifest, privateKeyPem: key })) (out[p.table] ??= []).push(...p.rows);
  return out;
}

describe("runDbBackupParts", () => {
  test("every page is its own part, the manifest counts them, and it OPENS again part by part", async () => {
    const store = memory();
    const { src } = pagedSource({ audit_log: 45, user: 3, empty: 0 });
    const r = await runDbBackupParts({ source: src, store, publicKeyPem, what: "test", now: NOW, pageSize: 10 });
    expect(r.readBackMatches).toBe(true);
    expect(r.parts).toBe(6); // 5 for audit_log (45/10), 1 for user, none for an empty table
    expect(r.tables).toEqual({ audit_log: 45, user: 3, empty: 0 });
    const m = manifestOf(store);
    expect(m.version).toBe(2);
    expect(m.parts.map((p) => p.key)).toEqual([1, 2, 3, 4, 5, 6].map((n) => partKey(today, n)));
    const opened = await openAll(store, m);
    expect(opened.audit_log).toHaveLength(45);
    expect(opened.user).toEqual([{ id: "user-0", email: "u0@x.dk", n: "0" }, { id: "user-1", email: "u1@x.dk", n: "1" }, { id: "user-2", email: "u2@x.dk", n: "2" }]);
  });

  test("a page size per table — the big table gets its own", async () => {
    const store = memory();
    const { src } = pagedSource({ audit_log: 40, user: 40 });
    const r = await runDbBackupParts({ source: src, store, publicKeyPem, what: "t", now: NOW, pageSize: (t) => (t === "audit_log" ? 10 : 40) });
    expect(manifestOf(store).parts.map((p) => `${p.table}:${p.rows}`)).toEqual(["audit_log:10", "audit_log:10", "audit_log:10", "audit_log:10", "user:40"]);
    expect(r.parts).toBe(5);
  });

  test("ONE PAGE AT A TIME: a part is written and read back before the next page is asked for", async () => {
    const store = memory();
    const { src, handedOut } = pagedSource({ big: 200 });
    const seen: number[] = [];
    const watching: BackupStore = { ...store, upload: async (k, b, o) => { if (k.includes("/part-")) seen.push(handedOut.n); return store.upload(k, b, o); } };
    await runDbBackupParts({ source: src, store: watching, publicKeyPem, what: "t", now: NOW, pageSize: 10 });
    // At the upload of part i exactly i pages have been handed out — nothing read ahead, nothing piled up.
    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  test("the stored parts and manifest are unreadable without the key — no email in clear text", async () => {
    const store = memory();
    await runDbBackupParts({ source: pagedSource({ user: 5 }).src, store, publicKeyPem, what: "t", now: NOW });
    for (const [, b] of store.mem) expect(Buffer.from(b).toString("latin1")).not.toContain("u1@x.dk");
  });

  test("THE MACHINE CANNOT OPEN IT: another private key fails", async () => {
    const store = memory();
    await runDbBackupParts({ source: pagedSource({ user: 5 }).src, store, publicKeyPem, what: "t", now: NOW });
    await expect(openAll(store, manifestOf(store), otherPrivateKeyPem)).rejects.toThrow();
  });

  test("a part read back wrong → readBackMatches false, NO manifest, and freshness is not green", async () => {
    const store = memory();
    const lying: BackupStore = { ...store, get: async (k) => (k.endsWith("part-00002.json.gz.enc") ? { bytes: new Uint8Array([1, 2, 3]) } : store.get(k)) };
    const { src, handedOut } = pagedSource({ big: 50 });
    const r = await runDbBackupParts({ source: src, store: lying, publicKeyPem, what: "t", now: NOW, pageSize: 10 });
    expect(r.readBackMatches).toBe(false);
    expect(handedOut.n).toBe(2); // stopped at the bad part, did not read on
    expect(store.mem.has(manifestKey(today))).toBe(false);
    expect((await backupFreshness(store, NOW)).ok).toBe(false);
  });

  test("an unproven copy deletes NOTHING old", async () => {
    const store = memory();
    const old = "2026-10-01"; // 35 days back
    store.mem.set(objectKey(old), new Uint8Array([9]));
    store.mem.set(manifestKey(old), new TextEncoder().encode("{}"));
    const lying: BackupStore = { ...store, get: async (k) => (k.includes("/part-") ? null : store.get(k)) };
    await runDbBackupParts({ source: pagedSource({ t: 3 }).src, store: lying, publicKeyPem, what: "t", now: NOW });
    expect(store.mem.has(objectKey(old))).toBe(true);
  });

  test("ONE COPY PER DAY: a whole copy from today → alreadyToday, nothing written", async () => {
    const store = memory();
    await runDbBackupParts({ source: pagedSource({ t: 25 }).src, store, publicKeyPem, what: "t", now: NOW, pageSize: 10 });
    const before = store.uploads.length;
    const r = await runDbBackupParts({ source: pagedSource({ t: 25 }).src, store, publicKeyPem, what: "t", now: NOW + 3_600_000, pageSize: 10 });
    expect(r.alreadyToday).toBe(true);
    expect(r.tables).toEqual({ t: 25 });
    expect(store.uploads.length).toBe(before);
  });

  test("NEGATIVE: today's copy has a changed part → it writes again", async () => {
    const store = memory();
    await runDbBackupParts({ source: pagedSource({ t: 25 }).src, store, publicKeyPem, what: "t", now: NOW, pageSize: 10 });
    store.mem.set(partKey(today, 2), new Uint8Array([0]));
    const r = await runDbBackupParts({ source: pagedSource({ t: 25 }).src, store, publicKeyPem, what: "t", now: NOW, pageSize: 10 });
    expect(r.alreadyToday).toBeUndefined();
    expect(r.readBackMatches).toBe(true);
    expect((await backupFreshness(store, NOW)).ok).toBe(true);
  });

  test("retention: an old day in parts is deleted through its manifest (days 31-40), day 30 kept", async () => {
    const store = memory();
    const at = (d: number) => NOW - d * 86_400_000;
    for (const d of [30, 31, 40]) await runDbBackupParts({ source: pagedSource({ t: 15 }).src, store, publicKeyPem, what: "t", now: at(d), pageSize: 10, prune: false });
    const day = (d: number) => new Date(at(d)).toISOString().slice(0, 10);
    const r = await runDbBackupParts({ source: pagedSource({ t: 5 }).src, store, publicKeyPem, what: "t", now: NOW });
    for (const d of [31, 40]) {
      expect(store.mem.has(manifestKey(day(d)))).toBe(false);
      expect(store.mem.has(partKey(day(d), 1))).toBe(false);
      expect(store.mem.has(partKey(day(d), 2))).toBe(false);
    }
    expect(store.mem.has(partKey(day(30), 2))).toBe(true);
    expect(store.mem.has(manifestKey(day(30)))).toBe(true);
    expect(r.deleted).toBe(10);
  });

  test("retention also removes an old SINGLE-FILE day — the switch from runDbBackup leaves nothing behind", async () => {
    const store = memory();
    const at = NOW - 35 * 86_400_000;
    const v1 = await runDbBackup({ source: { listTables: async () => ["t"], rows: async () => [{ id: 1 }] }, store, publicKeyPem, what: "t", now: at });
    await runDbBackupParts({ source: pagedSource({ t: 5 }).src, store, publicKeyPem, what: "t", now: NOW });
    expect(store.mem.has(v1.object)).toBe(false);
    expect(store.mem.has(v1.manifest)).toBe(false);
  });

  test("a LOCKED old part (store refuses the delete) does not fail the backup, and its manifest stays to find it next night", async () => {
    const store = memory();
    const at = NOW - 31 * 86_400_000;
    const oldDay = new Date(at).toISOString().slice(0, 10);
    await runDbBackupParts({ source: pagedSource({ t: 15 }).src, store, publicKeyPem, what: "t", now: at, pageSize: 10 });
    const locked: BackupStore = { ...store, delete: async (k) => { if (k === partKey(oldDay, 1)) throw new Error("HTTP 409 object locked"); return store.delete(k); } };
    const r = await runDbBackupParts({ source: pagedSource({ t: 5 }).src, store: locked, publicKeyPem, what: "t", now: NOW });
    expect(r.readBackMatches).toBe(true);
    expect(r.pruneSkipped).toEqual([{ key: partKey(oldDay, 1), reason: "HTTP 409 object locked" }]);
    expect(store.mem.has(manifestKey(oldDay))).toBe(true);
    expect(store.mem.has(partKey(oldDay, 2))).toBe(false);
  });

  test("prune:false leaves old parts alone", async () => {
    const store = memory();
    const at = NOW - 35 * 86_400_000;
    const oldDay = new Date(at).toISOString().slice(0, 10);
    await runDbBackupParts({ source: pagedSource({ t: 5 }).src, store, publicKeyPem, what: "t", now: at });
    const r = await runDbBackupParts({ source: pagedSource({ t: 5 }).src, store, publicKeyPem, what: "t", now: NOW, prune: false });
    expect(r.deleted).toBe(0);
    expect(store.mem.has(partKey(oldDay, 1))).toBe(true);
  });

  test("PREFIX BOUNDARY: retention never touches another app's parts, even if an old manifest names them", async () => {
    const store = memory();
    const at = NOW - 35 * 86_400_000;
    const oldDay = new Date(at).toISOString().slice(0, 10);
    await runDbBackupParts({ source: pagedSource({ t: 5 }).src, store, publicKeyPem, what: "b", now: at, prefix: "bid" });
    await runDbBackupParts({ source: pagedSource({ t: 5 }).src, store, publicKeyPem, what: "a", now: at, prefix: "app" });
    // a hostile/garbled manifest under app/ pointing into bid/
    const m = manifestOf(store, manifestKey(oldDay, "app"));
    m.parts = [{ ...m.parts[0], key: partKey(oldDay, 1, "bid") }];
    store.mem.set(manifestKey(oldDay, "app"), new TextEncoder().encode(JSON.stringify(m)));
    await runDbBackupParts({ source: pagedSource({ t: 5 }).src, store, publicKeyPem, what: "a", now: NOW, prefix: "app" });
    expect(store.mem.has(partKey(oldDay, 1, "bid"))).toBe(true);
    expect(store.mem.has(manifestKey(oldDay, "bid"))).toBe(true);
  });
});

describe("backupFreshness on a backup in parts", () => {
  test("a whole copy from today is green, with tables, bytes and parts", async () => {
    const store = memory();
    await runDbBackupParts({ source: pagedSource({ a: 25, b: 3 }).src, store, publicKeyPem, what: "t", now: NOW, pageSize: 10 });
    const f = await backupFreshness(store, NOW);
    expect(f).toMatchObject({ ok: true, newest: today, tables: 2, parts: 4 });
  });

  test("ONE part missing or changed → manifest_mismatch (every part is checked, not only the first)", async () => {
    for (const broken of [3, 1]) {
      const store = memory();
      await runDbBackupParts({ source: pagedSource({ a: 30 }).src, store, publicKeyPem, what: "t", now: NOW, pageSize: 10 });
      store.mem.delete(partKey(today, broken));
      expect(await backupFreshness(store, NOW)).toEqual({ ok: false, reason: "manifest_mismatch", newest: today });
    }
  });

  test("yesterday's copy in parts still counts; two days old does not", async () => {
    const store = memory();
    await runDbBackupParts({ source: pagedSource({ a: 5 }).src, store, publicKeyPem, what: "t", now: NOW - 86_400_000 });
    expect((await backupFreshness(store, NOW)).ok).toBe(true);
    expect((await backupFreshness(store, NOW + 86_400_000)).ok).toBe(false);
  });
});

describe("openDbBackupParts", () => {
  test("a changed part throws instead of handing over rows", async () => {
    const store = memory();
    await runDbBackupParts({ source: pagedSource({ a: 20 }).src, store, publicKeyPem, what: "t", now: NOW, pageSize: 10 });
    store.mem.set(partKey(today, 2), new Uint8Array([7]));
    await expect(openAll(store, manifestOf(store))).rejects.toThrow(/does not match/);
  });
});
