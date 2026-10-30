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
) {
  for (const d of [0, 1]) {
    const dd = day(now - d * 86_400_000);
    const [obj, man] = await Promise.all([store.get(objectKey(dd, prefix)), store.get(manifestKey(dd, prefix))]);
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
    return { ok: true as const, newest: dd, tables: Object.keys(m.tables ?? {}).length, bytes: obj.bytes.length };
  }
  return { ok: false as const, reason: "no_backup_today_or_yesterday", newest: null };
}
