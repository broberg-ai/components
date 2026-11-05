/**
 * @broberg/backup — nightly encrypted logical backup (F093.1).
 *
 * PORTED, NOT REWRITTEN: broberg-id's src/db-backup.ts (F084.110), in
 * production since 29/9 2026 and read back + sha-checked every night. The
 * functions below are that file's, carried over one by one. Two changes, both
 * so the package fits more than BID:
 *
 *   · the object prefix is a parameter (default "db-backup", BID's own), so
 *     several apps can share one bucket without touching each other's keys;
 *   · gzip comes from node:zlib instead of Bun.gzipSync, so a Node app
 *     (fd-sundhed, appkit) can run it too. The bytes are the same format.
 *
 * THE DESIGN, as BID and fd-sundhed agreed it:
 *
 *   · LOGICAL dump (JSON per table), not pg_dump — a container rarely has the
 *     binary, and JSON reads back without a Postgres version's blessing.
 *   · ENCRYPTED: AES-256-GCM with a random key, wrapped with RSA-OAEP under a
 *     PUBLIC key. The machine can encrypt, never open. The private key lives
 *     only in the cardmem vault.
 *   · PROOF BEFORE "OK": the file is fetched BACK from storage and its sha256
 *     must be the one that was sent. A 200 from upload is not proof.
 *
 * RETENTION WITHOUT LISTING: @broberg/media cannot list a prefix, so names are
 * dates and every run deletes days 31-40 back — idempotent, so a night that
 * fell out is cleaned up by the next.
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

export const BACKUP_PREFIX = "db-backup";
export const KEEP_DAYS = 30;

export interface BackupSource {
  /** The tables to include. Read from the database itself, so a new table is included on its own. */
  listTables(): Promise<string[]>;
  /** Every row of one table. */
  rows(table: string): Promise<Record<string, unknown>[]>;
}

/** What @broberg/media's storage already offers — any object store with these three works. */
export interface BackupStore {
  upload(key: string, body: Uint8Array, opts?: { contentType?: string }): Promise<unknown>;
  get(key: string): Promise<{ bytes: Uint8Array } | null>;
  delete(key: string): Promise<void>;
}

export interface BackupResult {
  object: string;
  manifest: string;
  tables: Record<string, number>;
  plaintextBytes: number;
  ciphertextSha256: string;
  readBackMatches: boolean;
  deleted: number;
  /**
   * Retention deletes the store REFUSED. Never thrown: on a bucket with an
   * object lock the lock runs from UPLOAD time, not from the date in the key, so
   * a file named 31 days back can still be locked (BID, 30 Oct 2026: HTTP 409 on
   * a file uploaded a day after its name). The backup itself is already written
   * and read back by then — a refused cleanup must not turn it into a failure.
   * The key stays in the window, so the next night tries again.
   */
  pruneSkipped: { key: string; reason: string }[];
  /** Today's copy already existed and matched its manifest — nothing written. */
  alreadyToday?: boolean;
}

export interface BackupContents {
  version: number;
  createdAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const der = (pem: string) =>
  Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function objectKey(d: string, prefix: string = BACKUP_PREFIX): string {
  return `${prefix}/${d}.json.gz.enc`;
}
export function manifestKey(d: string, prefix: string = BACKUP_PREFIX): string {
  return `${prefix}/${d}.manifest.json`;
}

/** JSON that can carry what a database hands back (Date, bigint, Buffer). */
function serialise(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? { $bytes: Buffer.from(x).toString("base64") } : x,
  );
}

export async function runDbBackup(input: {
  source: BackupSource;
  store: BackupStore;
  publicKeyPem: string;
  /** Written into the manifest, e.g. «BID, Supabase eu-north-1». */
  what: string;
  /** Object prefix; give each app its own when they share a bucket. Default "db-backup". */
  prefix?: string;
  now?: number;
  /**
   * Delete days 31-40 back after a proven new copy. Default true. Pass false for
   * a bucket with an object lock, and let a storage lifecycle rule expire old
   * copies instead — the store knows when a lock ends; the key's date does not.
   */
  prune?: boolean;
}): Promise<BackupResult> {
  const now = input.now ?? Date.now();
  const today = day(now);
  const prefix = input.prefix ?? BACKUP_PREFIX;
  const object = objectKey(today, prefix);
  const manifest = manifestKey(today, prefix);

  // ONE COPY PER DAY (BID F084.122). A locked bucket rejects a second write the
  // same day with a 409 and a false alarm. If today's copy exists and matches
  // its manifest, today's work is done. If it is half or mismatched, carry on —
  // and the lock refuses the write loudly, exactly as it should.
  const [exists, existsManifest] = await Promise.all([input.store.get(object), input.store.get(manifest)]);
  if (exists && existsManifest) {
    let m: { object?: string; ciphertextSha256?: string; tables?: Record<string, number>; plaintextBytes?: number } = {};
    try {
      m = JSON.parse(new TextDecoder().decode(existsManifest.bytes));
    } catch {
      // Not a manifest — treated as a half copy below.
    }
    const sha = sha256(exists.bytes);
    if (m.object === object && m.ciphertextSha256 === sha) {
      return {
        object,
        manifest,
        tables: m.tables ?? {},
        plaintextBytes: m.plaintextBytes ?? 0,
        ciphertextSha256: sha,
        readBackMatches: true,
        deleted: 0,
        pruneSkipped: [],
        alreadyToday: true,
      };
    }
  }

  const tables: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  for (const t of await input.source.listTables()) {
    const rows = await input.source.rows(t);
    tables[t] = rows;
    counts[t] = rows.length;
  }
  const plain = new Uint8Array(
    gzipSync(new TextEncoder().encode(serialise({ version: 1, createdAt: new Date(now).toISOString(), tables }))),
  );

  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plain));
  const publicKey = await crypto.subtle.importKey("spki", der(input.publicKeyPem), { name: "RSA-OAEP", hash: "SHA-256" }, false, [
    "encrypt",
  ]);
  const wrappedKey = new Uint8Array(
    await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, new Uint8Array(await crypto.subtle.exportKey("raw", aesKey))),
  );

  const ciphertextSha256 = sha256(cipher);
  await input.store.upload(object, cipher, { contentType: "application/octet-stream" });
  await input.store.upload(
    manifest,
    new TextEncoder().encode(
      JSON.stringify(
        {
          what: input.what,
          createdAt: new Date(now).toISOString(),
          format: "gzip(JSON {version,createdAt,tables}) → AES-256-GCM; key wrapped RSA-OAEP/SHA-256",
          object,
          iv: Buffer.from(iv).toString("base64"),
          wrappedKey: Buffer.from(wrappedKey).toString("base64"),
          plaintextSha256: sha256(plain),
          plaintextBytes: plain.length,
          ciphertextSha256,
          ciphertextBytes: cipher.length,
          tables: counts,
        },
        null,
        2,
      ),
    ),
    { contentType: "application/json" },
  );

  // READ BACK — the bytes fetched again, not the upload response.
  const back = await input.store.get(object);
  const readBackMatches = back !== null && sha256(back.bytes) === ciphertextSha256;

  // Retention: days 31-40 back, under THIS prefix only. Only after a proven new copy.
  let deleted = 0;
  const pruneSkipped: { key: string; reason: string }[] = [];
  if (readBackMatches && input.prune !== false) {
    for (let d = KEEP_DAYS + 1; d <= KEEP_DAYS + 10; d++) {
      const old = day(now - d * 86_400_000);
      let ok = true;
      for (const key of [objectKey(old, prefix), manifestKey(old, prefix)]) {
        try {
          await input.store.delete(key);
        } catch (e) {
          ok = false;
          pruneSkipped.push({ key, reason: e instanceof Error ? e.message : String(e) });
        }
      }
      if (ok) deleted++;
    }
  }

  return { object, manifest, tables: counts, plaintextBytes: plain.length, ciphertextSha256, readBackMatches, deleted, pruneSkipped };
}

/**
 * Open a backup again — the restore drill and the tests use it. Needs the
 * PRIVATE key; the machine that takes the backup does not have it. It returns
 * the contents and writes nothing: putting rows back into a database is the
 * caller's step, and over a live database it needs the owner's own words.
 */
export async function openDbBackup(input: {
  cipher: Uint8Array;
  manifest: { iv: string; wrappedKey: string };
  privateKeyPem: string;
}): Promise<BackupContents> {
  const privateKey = await crypto.subtle.importKey("pkcs8", der(input.privateKeyPem), { name: "RSA-OAEP", hash: "SHA-256" }, false, [
    "decrypt",
  ]);
  const rawAes = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, Buffer.from(input.manifest.wrappedKey, "base64"));
  const aesKey = await crypto.subtle.importKey("raw", rawAes, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(input.manifest.iv, "base64") }, aesKey, new Uint8Array(input.cipher)),
  );
  return JSON.parse(new TextDecoder().decode(gunzipSync(plain)));
}

/**
 * IS THERE A FRESH, WHOLE BACKUP? — what an uptime probe asks.
 *
 * Why a probe and not only an error from the job: the error fires only when the
 * job RUNS and fails. If the cron dies, the key expires, or the route is never
 * called, there is no error to report — and the night is lost silently. This
 * catches all three: is there a copy from today or yesterday, and does it match
 * its manifest?
 *
 * The answer is numbers and dates, never contents.
 */
export async function backupFreshness(
  store: Pick<BackupStore, "get">,
  now = Date.now(),
  prefix: string = BACKUP_PREFIX,
  /**
   * F093.4 — "full" (default) fetches and sha-checks every byte. "manifest" reads
   * only the manifest, for an hourly probe on a large backup; its answer says
   * partsRead:false so a green one is never mistaken for a verified copy.
   */
  opts: { verify?: "full" | "manifest" } = {},
) {
  if (opts.verify === "manifest") return manifestFreshness(store, now, prefix);
  for (const d of [0, 1]) {
    const dd = day(now - d * 86_400_000);
    const [obj, man] = await Promise.all([store.get(objectKey(dd, prefix)), store.get(manifestKey(dd, prefix))]);
    // F093.3 — a backup in parts has a manifest and no single file.
    if (man && !obj) {
      const m2 = readManifest(man.bytes);
      if (m2?.version === 2) {
        const bad = await firstBadPart(store, m2, dd, prefix);
        if (bad) return { ok: false as const, reason: "manifest_mismatch", newest: dd };
        return {
          ok: true as const,
          newest: dd,
          tables: Object.keys(m2.tables ?? {}).length,
          bytes: m2.parts.reduce((n, p) => n + p.ciphertextBytes, 0),
          parts: m2.parts.length,
          verified: "full" as const,
          partsRead: true as const,
        };
      }
    }
    if (!obj || !man) continue;
    let m: { object?: string; ciphertextSha256?: string; tables?: Record<string, number> } = {};
    try {
      m = JSON.parse(new TextDecoder().decode(man.bytes));
    } catch {
      return { ok: false as const, reason: "manifest_unreadable", newest: dd };
    }
    if (m.object !== objectKey(dd, prefix) || m.ciphertextSha256 !== sha256(obj.bytes)) {
      return { ok: false as const, reason: "manifest_mismatch", newest: dd };
    }
    return {
      ok: true as const,
      newest: dd,
      tables: Object.keys(m.tables ?? {}).length,
      bytes: obj.bytes.length,
      verified: "full" as const,
      partsRead: true as const,
    };
  }
  return { ok: false as const, reason: "no_backup_today_or_yesterday", newest: null };
}

/**
 * F093.4 — the cheap probe: is there today's or yesterday's manifest, how old,
 * how many parts? It fetches NO backup bytes, so it cannot see a missing or
 * changed part — that is what the daily "full" check is for. The answer says so
 * in two fields, because a green probe that LOOKS verified is the failure a
 * backup probe exists to prevent.
 */
async function manifestFreshness(store: Pick<BackupStore, "get">, now: number, prefix: string) {
  for (const d of [0, 1]) {
    const dd = day(now - d * 86_400_000);
    const man = await store.get(manifestKey(dd, prefix));
    if (!man) continue;
    let m: {
      version?: number;
      object?: string;
      createdAt?: string;
      tables?: Record<string, number>;
      parts?: { key: string; ciphertextBytes: number }[];
      ciphertextBytes?: number;
    };
    try {
      m = JSON.parse(new TextDecoder().decode(man.bytes));
    } catch {
      return { ok: false as const, reason: "manifest_unreadable", newest: dd };
    }
    const isParts = m.version === 2 && Array.isArray(m.parts);
    const pointsHome = isParts
      ? m.parts!.every((p) => typeof p.key === "string" && p.key.startsWith(`${prefix}/${dd}/`))
      : m.object === objectKey(dd, prefix);
    if (!pointsHome) return { ok: false as const, reason: "manifest_mismatch", newest: dd };
    const created = m.createdAt ? Date.parse(m.createdAt) : NaN;
    return {
      ok: true as const,
      newest: dd,
      tables: Object.keys(m.tables ?? {}).length,
      bytes: isParts ? m.parts!.reduce((n, p) => n + p.ciphertextBytes, 0) : (m.ciphertextBytes ?? 0),
      ...(isParts ? { parts: m.parts!.length } : {}),
      ageMinutes: Number.isFinite(created) ? Math.floor((now - created) / 60_000) : null,
      verified: "manifest" as const,
      partsRead: false as const,
    };
  }
  return { ok: false as const, reason: "no_backup_today_or_yesterday", newest: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// F093.3 — BACKUP IN PARTS, for a database too big to hold in memory at once.
//
// cardmem 5/11 2026: 198 tables, 694 782 rows, ~850 MB in Postgres, on a 4 GB
// machine that also runs the server. runDbBackup above builds ONE string of the
// whole database — fine for BID, an OOM there. Here the source hands rows over a
// page at a time, and each page becomes its own encrypted part:
//
//   <prefix>/<day>/part-00001.json.gz.enc   gzip(JSON {table, rows}) → AES-256-GCM, own IV
//   <prefix>/<day>.manifest.json            version 2: every part's key, sha and row count
//
// One AES key per backup, wrapped with RSA-OAEP exactly as above: the machine
// can encrypt, never open. The most held at once is one page.
//
// Same guarantees as the single file: each part is fetched BACK and sha-checked
// before the next is read; the manifest is written only when every part is
// proven, so a night that broke half-way has no manifest and the probe goes red;
// one copy per day; 30 days, and retention deletes an old day's parts through
// that day's manifest. Why parts and not one streamed object: BackupStore.upload
// takes whole bytes, and demanding multipart of the store would break the
// @broberg/media contract every consumer already has.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 2000;

export interface BackupPageSource {
  /** The tables to include. Read from the database itself, so a new table is included on its own. */
  listTables(): Promise<string[]>;
  /** One table's rows, a page at a time (keyset or limit/offset — the app's query). */
  pages(table: string, pageSize: number): AsyncIterable<Record<string, unknown>[]>;
}

export interface BackupPart {
  key: string;
  table: string;
  rows: number;
  iv: string;
  plaintextSha256: string;
  plaintextBytes: number;
  ciphertextSha256: string;
  ciphertextBytes: number;
}

export interface BackupPartsManifest {
  version: 2;
  what: string;
  createdAt: string;
  format: string;
  wrappedKey: string;
  parts: BackupPart[];
  tables: Record<string, number>;
  /** sha256 over the parts' ciphertext sha256s, in order — one fingerprint for the whole copy. */
  ciphertextSha256: string;
  plaintextBytes: number;
}

export interface BackupPartsResult extends Omit<BackupResult, "object"> {
  /** The day's part directory, e.g. "db-backup/2026-11-05/". */
  object: string;
  parts: number;
}

export function partKey(d: string, n: number, prefix: string = BACKUP_PREFIX): string {
  return `${prefix}/${d}/part-${String(n).padStart(5, "0")}.json.gz.enc`;
}

function readManifest(bytes: Uint8Array): BackupPartsManifest | null {
  try {
    const m = JSON.parse(new TextDecoder().decode(bytes));
    return m && m.version === 2 && Array.isArray(m.parts) ? m : null;
  } catch {
    return null;
  }
}

/** The first part that is missing, outside this day's directory, or not its manifest's bytes — fetched one at a time. */
async function firstBadPart(store: Pick<BackupStore, "get">, m: BackupPartsManifest, d: string, prefix: string) {
  for (const part of m.parts) {
    if (!part.key.startsWith(`${prefix}/${d}/`)) return part.key;
    const got = await store.get(part.key);
    if (!got || sha256(got.bytes) !== part.ciphertextSha256) return part.key;
  }
  return null;
}

export async function runDbBackupParts(input: {
  source: BackupPageSource;
  store: BackupStore;
  publicKeyPem: string;
  /** Written into the manifest, e.g. «cardmem, UpCloud Postgres». */
  what: string;
  prefix?: string;
  /** Rows per page (= per part). A number, or one per table — the big table gets its own. Default 2000. */
  pageSize?: number | ((table: string) => number);
  now?: number;
  /** As in runDbBackup: false for a bucket with an object lock. */
  prune?: boolean;
}): Promise<BackupPartsResult> {
  const now = input.now ?? Date.now();
  const today = day(now);
  const prefix = input.prefix ?? BACKUP_PREFIX;
  const dir = `${prefix}/${today}/`;
  const manifest = manifestKey(today, prefix);

  // ONE COPY PER DAY — today's manifest exists and every part it names is whole.
  const existing = await input.store.get(manifest);
  const prev = existing ? readManifest(existing.bytes) : null;
  if (prev && !(await firstBadPart(input.store, prev, today, prefix))) {
    return {
      object: dir,
      manifest,
      tables: prev.tables,
      plaintextBytes: prev.plaintextBytes,
      ciphertextSha256: prev.ciphertextSha256,
      readBackMatches: true,
      deleted: 0,
      pruneSkipped: [],
      parts: prev.parts.length,
      alreadyToday: true,
    };
  }

  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const publicKey = await crypto.subtle.importKey("spki", der(input.publicKeyPem), { name: "RSA-OAEP", hash: "SHA-256" }, false, [
    "encrypt",
  ]);
  const wrappedKey = new Uint8Array(
    await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, new Uint8Array(await crypto.subtle.exportKey("raw", aesKey))),
  );

  const parts: BackupPart[] = [];
  const counts: Record<string, number> = {};
  let plaintextBytes = 0;
  let readBackMatches = true;
  outer: for (const table of await input.source.listTables()) {
    counts[table] = 0;
    const size = typeof input.pageSize === "function" ? input.pageSize(table) : (input.pageSize ?? DEFAULT_PAGE_SIZE);
    for await (const rows of input.source.pages(table, size)) {
      if (rows.length === 0) continue;
      const plain = new Uint8Array(gzipSync(new TextEncoder().encode(serialise({ table, rows }))));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plain));
      const key = partKey(today, parts.length + 1, prefix);
      const ciphertextSha256 = sha256(cipher);
      await input.store.upload(key, cipher, { contentType: "application/octet-stream" });
      // READ BACK — this part's bytes fetched again before the next page is read.
      const back = await input.store.get(key);
      if (back === null || sha256(back.bytes) !== ciphertextSha256) {
        readBackMatches = false;
        break outer;
      }
      parts.push({
        key,
        table,
        rows: rows.length,
        iv: Buffer.from(iv).toString("base64"),
        plaintextSha256: sha256(plain),
        plaintextBytes: plain.length,
        ciphertextSha256,
        ciphertextBytes: cipher.length,
      });
      counts[table] += rows.length;
      plaintextBytes += plain.length;
    }
  }

  const ciphertextSha256 = sha256(new TextEncoder().encode(parts.map((p) => p.ciphertextSha256).join("\n")));
  const result: BackupPartsResult = {
    object: dir,
    manifest,
    tables: counts,
    plaintextBytes,
    ciphertextSha256,
    readBackMatches,
    deleted: 0,
    pruneSkipped: [],
    parts: parts.length,
  };
  // An unproven part: no manifest. The copy does not exist, and the probe says so.
  if (!readBackMatches) return result;

  const m: BackupPartsManifest = {
    version: 2,
    what: input.what,
    createdAt: new Date(now).toISOString(),
    format: "parts: gzip(JSON {table,rows}) → AES-256-GCM, own IV per part; one key wrapped RSA-OAEP/SHA-256",
    wrappedKey: Buffer.from(wrappedKey).toString("base64"),
    parts,
    tables: counts,
    ciphertextSha256,
    plaintextBytes,
  };
  await input.store.upload(manifest, new TextEncoder().encode(JSON.stringify(m, null, 2)), { contentType: "application/json" });

  // Retention: days 31-40 back, under THIS prefix only, only after a proven copy.
  // A day in parts is deleted through its manifest; a single-file day as before.
  if (input.prune !== false) {
    for (let d = KEEP_DAYS + 1; d <= KEEP_DAYS + 10; d++) {
      const old = day(now - d * 86_400_000);
      const skippedBefore = result.pruneSkipped.length;
      const del = async (key: string) => {
        try {
          await input.store.delete(key);
        } catch (e) {
          result.pruneSkipped.push({ key, reason: e instanceof Error ? e.message : String(e) });
        }
      };
      let oldManifest: BackupPartsManifest | null = null;
      try {
        const got = await input.store.get(manifestKey(old, prefix));
        oldManifest = got ? readManifest(got.bytes) : null;
      } catch (e) {
        result.pruneSkipped.push({ key: manifestKey(old, prefix), reason: e instanceof Error ? e.message : String(e) });
        continue;
      }
      if (oldManifest) {
        for (const part of oldManifest.parts) if (part.key.startsWith(`${prefix}/${old}/`)) await del(part.key);
      } else {
        await del(objectKey(old, prefix));
      }
      // The manifest last: while a part is still there, the manifest is what finds it next night.
      if (result.pruneSkipped.length === skippedBefore) await del(manifestKey(old, prefix));
      if (result.pruneSkipped.length === skippedBefore) result.deleted++;
    }
  }
  return result;
}

/**
 * Open a backup in parts again, one part at a time — the restore drill on a
 * large database. Needs the PRIVATE key. Each part is sha-checked against the
 * manifest before it is decrypted; a missing or changed part throws. Writes
 * nothing: putting rows back is the caller's step.
 */
export async function* openDbBackupParts(input: {
  store: Pick<BackupStore, "get">;
  manifest: Pick<BackupPartsManifest, "wrappedKey" | "parts">;
  privateKeyPem: string;
}): AsyncGenerator<{ table: string; rows: Record<string, unknown>[] }> {
  const privateKey = await crypto.subtle.importKey("pkcs8", der(input.privateKeyPem), { name: "RSA-OAEP", hash: "SHA-256" }, false, [
    "decrypt",
  ]);
  const rawAes = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, Buffer.from(input.manifest.wrappedKey, "base64"));
  const aesKey = await crypto.subtle.importKey("raw", rawAes, { name: "AES-GCM" }, false, ["decrypt"]);
  for (const part of input.manifest.parts) {
    const got = await input.store.get(part.key);
    if (!got) throw new Error(`backup part missing: ${part.key}`);
    if (sha256(got.bytes) !== part.ciphertextSha256) throw new Error(`backup part does not match its manifest: ${part.key}`);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(part.iv, "base64") }, aesKey, new Uint8Array(got.bytes)),
    );
    yield JSON.parse(new TextDecoder().decode(gunzipSync(plain)));
  }
}
