/**
 * F093.1 — ported from broberg-id src/db-backup.test.ts (the runDbBackup and
 * backupFreshness suites), plus three cases the package adds: restore into an
 * EMPTY database, the prefix boundary, and a public key that cannot open.
 *
 * The key pair is made for the test. A real pair: public half on the machine,
 * private half only in the cardmem vault.
 */
import { createRequire } from "node:module";
// Loaded through Node itself: vite strips the "node:" prefix, and "sqlite" has no
// unprefixed form, so a static import fails to resolve under vitest.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { beforeAll, describe, expect, test } from "vitest";
import {
  backupFreshness,
  KEEP_DAYS,
  manifestKey,
  objectKey,
  openDbBackup,
  runDbBackup,
  type BackupSource,
  type BackupStore,
} from "../src/index";

const pem = (label: string, der: ArrayBuffer) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;

let publicKeyPem = "";
let privateKeyPem = "";

function memory(): BackupStore & { mem: Map<string, Uint8Array> } {
  const mem = new Map<string, Uint8Array>();
  return {
    mem,
    upload: async (k, b) => void mem.set(k, b),
    get: async (k) => (mem.has(k) ? { bytes: mem.get(k)! } : null),
    delete: async (k) => void mem.delete(k),
  };
}

const source: BackupSource = {
  listTables: async () => ["user", "session"],
  rows: async (t: string) => (t === "user" ? [{ id: "u1", email: "a@b.dk", n: 5n }, { id: "u2", email: "c@d.dk" }] : []),
};

const manifestOf = (store: ReturnType<typeof memory>, key: string) => JSON.parse(new TextDecoder().decode(store.mem.get(key)!));

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  )) as CryptoKeyPair;
  publicKeyPem = pem("PUBLIC KEY", await crypto.subtle.exportKey("spki", pair.publicKey));
  privateKeyPem = pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", pair.privateKey));
});

describe("runDbBackup (ported from broberg-id)", () => {
  test("every table, counts in the manifest, and it OPENS again with the private key", async () => {
    const store = memory();
    const r = await runDbBackup({ source, store, publicKeyPem, what: "test", now: Date.UTC(2026, 8, 30) });
    expect(r.object).toBe("db-backup/2026-09-30.json.gz.enc");
    expect(r.tables).toEqual({ user: 2, session: 0 });
    expect(r.readBackMatches).toBe(true);

    const manifest = manifestOf(store, r.manifest);
    expect(manifest.tables).toEqual({ user: 2, session: 0 });
    const opened = await openDbBackup({ cipher: store.mem.get(r.object)!, manifest, privateKeyPem });
    expect(opened.tables.user).toEqual([{ id: "u1", email: "a@b.dk", n: "5" }, { id: "u2", email: "c@d.dk" }]);
  });

  test("the stored file is unreadable without the key — no email address in clear text", async () => {
    const store = memory();
    const r = await runDbBackup({ source, store, publicKeyPem, what: "test" });
    expect(Buffer.from(store.mem.get(r.object)!).toString("latin1")).not.toContain("a@b.dk");
    expect(new TextDecoder().decode(store.mem.get(r.manifest)!)).not.toContain("a@b.dk");
  });

  test("THE MACHINE CANNOT OPEN IT: with only the public key, opening fails", async () => {
    const store = memory();
    const r = await runDbBackup({ source, store, publicKeyPem, what: "test" });
    const manifest = manifestOf(store, r.manifest);
    await expect(openDbBackup({ cipher: store.mem.get(r.object)!, manifest, privateKeyPem: publicKeyPem })).rejects.toThrow();
  });

  test("NEGATIVE: one changed byte is refused on open", async () => {
    const store = memory();
    const r = await runDbBackup({ source, store, publicKeyPem, what: "test" });
    const cipher = new Uint8Array(store.mem.get(r.object)!);
    cipher[10] = cipher[10]! ^ 0xff;
    await expect(openDbBackup({ cipher, manifest: manifestOf(store, r.manifest), privateKeyPem })).rejects.toThrow();
  });

  test("retention: days 31-40 back are deleted, day 30 is kept", async () => {
    const store = memory();
    const now = Date.UTC(2026, 8, 30);
    const d = (n: number) => new Date(now - n * 86_400_000).toISOString().slice(0, 10);
    for (const n of [KEEP_DAYS, KEEP_DAYS + 1, KEEP_DAYS + 10]) store.mem.set(objectKey(d(n)), new Uint8Array([1]));
    await runDbBackup({ source, store, publicKeyPem, what: "test", now });
    expect(store.mem.has(objectKey(d(KEEP_DAYS)))).toBe(true);
    expect(store.mem.has(objectKey(d(KEEP_DAYS + 1)))).toBe(false);
    expect(store.mem.has(objectKey(d(KEEP_DAYS + 10)))).toBe(false);
  });

  test("a LOCKED old copy (store refuses the delete) does not fail the backup — it is reported and retried next night", async () => {
    // BID 30 Oct 2026: an R2 object lock counts from UPLOAD time, so a file named
    // 31 days back was still locked, delete answered 409, and the whole backup
    // endpoint failed although the new copy was written and read back.
    const store = memory();
    const now = Date.UTC(2026, 9, 30);
    const d = (n: number) => new Date(now - n * 86_400_000).toISOString().slice(0, 10);
    const locked = objectKey(d(KEEP_DAYS + 1));
    store.mem.set(locked, new Uint8Array([1]));
    store.mem.set(objectKey(d(KEEP_DAYS + 2)), new Uint8Array([1]));
    const realDelete = store.delete;
    store.delete = async (k) => {
      if (k === locked) throw new Error("HTTP 409 ObjectLockedByBucketPolicy");
      return realDelete(k);
    };
    const r = await runDbBackup({ source, store, publicKeyPem, what: "test", now });
    expect(r.readBackMatches).toBe(true);
    expect(r.pruneSkipped).toStrictEqual([{ key: locked, reason: "HTTP 409 ObjectLockedByBucketPolicy" }]);
    expect(store.mem.has(locked)).toBe(true); // still there — retried next night
    expect(store.mem.has(objectKey(d(KEEP_DAYS + 2)))).toBe(false); // the rest was still cleaned
    expect(r.deleted).toBe(9); // ten days in the window, one refused
  });

  test("prune:false leaves old copies alone (a locked bucket + a storage lifecycle rule)", async () => {
    const store = memory();
    const now = Date.UTC(2026, 9, 30);
    const old = objectKey(new Date(now - (KEEP_DAYS + 1) * 86_400_000).toISOString().slice(0, 10));
    store.mem.set(old, new Uint8Array([1]));
    const r = await runDbBackup({ source, store, publicKeyPem, what: "test", now, prune: false });
    expect(r.readBackMatches).toBe(true);
    expect(store.mem.has(old)).toBe(true);
    expect(r.deleted).toBe(0);
    expect(r.pruneSkipped).toStrictEqual([]);
  });

  test("PREFIX BOUNDARY: an app's retention never touches another app's prefix in the same bucket", async () => {
    const store = memory();
    const now = Date.UTC(2026, 8, 30);
    const old = new Date(now - (KEEP_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
    store.mem.set(objectKey(old, "app-a"), new Uint8Array([1]));
    store.mem.set(objectKey(old, "app-b"), new Uint8Array([1]));
    const r = await runDbBackup({ source, store, publicKeyPem, what: "test", now, prefix: "app-a" });
    expect(r.object).toBe("app-a/2026-09-30.json.gz.enc");
    expect(store.mem.has(objectKey(old, "app-a"))).toBe(false);
    expect(store.mem.has(objectKey(old, "app-b"))).toBe(true);
  });

  test("second run the same day: today's copy untouched, nothing written, answer is green", async () => {
    const store = memory();
    const now = Date.UTC(2026, 8, 30);
    const first = await runDbBackup({ source, store, publicKeyPem, what: "test", now });
    const bytes = store.mem.get(first.object)!;
    let written = 0;
    const locked: BackupStore = { ...store, upload: async () => void written++ };
    const second = await runDbBackup({ source, store: locked, publicKeyPem, what: "test", now: now + 3_600_000 });
    expect(written).toBe(0);
    expect(second.alreadyToday).toBe(true);
    expect(second.readBackMatches).toBe(true);
    expect(second.ciphertextSha256).toBe(first.ciphertextSha256);
    expect(second.tables).toEqual({ user: 2, session: 0 });
    expect(store.mem.get(first.object)).toBe(bytes);
  });

  test("NEGATIVE: today's copy does not match its manifest → it writes, so the lock can refuse loudly", async () => {
    const store = memory();
    const now = Date.UTC(2026, 8, 30);
    await runDbBackup({ source, store, publicKeyPem, what: "test", now });
    store.mem.set(objectKey("2026-09-30"), new Uint8Array([7]));
    let written = 0;
    const counting: BackupStore = { ...store, upload: async (k, b) => { written++; await store.upload(k, b); } };
    const r = await runDbBackup({ source, store: counting, publicKeyPem, what: "test", now });
    expect(written).toBe(2);
    expect(r.alreadyToday).toBeUndefined();
  });

  test("read back wrong → readBackMatches false", async () => {
    const store = memory();
    const lying: BackupStore = { ...store, get: async () => ({ bytes: new Uint8Array([9, 9, 9]) }) };
    const r = await runDbBackup({ source, store: lying, publicKeyPem, what: "test", now: Date.UTC(2026, 8, 30) });
    expect(r.readBackMatches).toBe(false);
  });

  test("an unproven new copy deletes NOTHING old — a bad night must not eat the last good backups", async () => {
    const store = memory();
    const now = Date.UTC(2026, 8, 30);
    const old = objectKey(new Date(now - (KEEP_DAYS + 1) * 86_400_000).toISOString().slice(0, 10));
    store.mem.set(old, new Uint8Array([1]));
    const lying: BackupStore = { ...store, get: async () => ({ bytes: new Uint8Array([9, 9, 9]) }) };
    const r = await runDbBackup({ source, store: lying, publicKeyPem, what: "test", now });
    expect(r.deleted).toBe(0);
    expect(store.mem.has(old)).toBe(true);
  });
});

describe("RESTORE INTO AN EMPTY DATABASE — a backup never restored is not a backup", () => {
  test("rows backed up from one SQLite database come back equal in a fresh one", async () => {
    const live = new DatabaseSync(":memory:");
    live.exec("CREATE TABLE note (id TEXT PRIMARY KEY, body TEXT, n INTEGER)");
    live.prepare("INSERT INTO note VALUES (?, ?, ?)").run("a", "første «æøå»", 1);
    live.prepare("INSERT INTO note VALUES (?, ?, ?)").run("b", null, 2);
    const sqliteSource: BackupSource = {
      listTables: async () =>
        (live.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name),
      rows: async (t) => live.prepare(`SELECT * FROM "${t}" ORDER BY id`).all() as Record<string, unknown>[],
    };

    const store = memory();
    const r = await runDbBackup({ source: sqliteSource, store, publicKeyPem, what: "test" });
    const opened = await openDbBackup({ cipher: store.mem.get(r.object)!, manifest: manifestOf(store, r.manifest), privateKeyPem });

    const empty = new DatabaseSync(":memory:");
    empty.exec("CREATE TABLE note (id TEXT PRIMARY KEY, body TEXT, n INTEGER)");
    const insert = empty.prepare("INSERT INTO note (id, body, n) VALUES (?, ?, ?)");
    for (const row of opened.tables.note!) insert.run(row.id as string, row.body as string | null, row.n as number);

    expect(empty.prepare("SELECT * FROM note ORDER BY id").all()).toEqual(live.prepare("SELECT * FROM note ORDER BY id").all());
  });
});

describe("backupFreshness (ported) — what an uptime probe asks", () => {
  const now = Date.UTC(2026, 9, 10, 9);
  test("a whole copy from today or yesterday is green — dates and numbers, never contents", async () => {
    const store = memory();
    await runDbBackup({ source, store, publicKeyPem, what: "test", now: Date.UTC(2026, 9, 9, 1, 30) });
    const answer = await backupFreshness(store, now);
    expect(answer).toEqual({ ok: true, newest: "2026-10-09", tables: 2, bytes: expect.any(Number) });
    expect(JSON.stringify(answer)).not.toContain("a@b.dk");
  });

  test("no copy today or yesterday is RED — even when an older one exists (the job stopped running)", async () => {
    const store = memory();
    await runDbBackup({ source, store, publicKeyPem, what: "test", now: Date.UTC(2026, 9, 7, 1, 30) });
    expect(await backupFreshness(store, now)).toEqual({ ok: false, reason: "no_backup_today_or_yesterday", newest: null });
  });

  test("a copy that does not match its manifest is RED", async () => {
    const store = memory();
    const r = await runDbBackup({ source, store, publicKeyPem, what: "test", now: Date.UTC(2026, 9, 10, 1, 30) });
    store.mem.set(r.object, new Uint8Array([1, 2, 3]));
    expect(await backupFreshness(store, now)).toEqual({ ok: false, reason: "manifest_mismatch", newest: "2026-10-10" });
  });

  test("freshness reads the prefix it is given — another app's fresh copy does not make this one green", async () => {
    const store = memory();
    await runDbBackup({ source, store, publicKeyPem, what: "test", now: Date.UTC(2026, 9, 10, 1, 30), prefix: "app-b" });
    expect((await backupFreshness(store, now, "app-a")).ok).toBe(false);
    expect((await backupFreshness(store, now, "app-b")).ok).toBe(true);
  });
});
