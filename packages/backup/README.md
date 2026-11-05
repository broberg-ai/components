# @broberg/backup

Nightly encrypted logical backup, ported from broberg-id's production backup (`src/db-backup.ts`, running since 29 Sep 2026, read back and sha-checked every night).

- **Logical dump**: JSON per table, so it can be read back without a matching database version.
- **The machine can encrypt, never open**: each backup gets a random AES-256-GCM key, which is wrapped with RSA-OAEP under a **public** key. The private key belongs in the cardmem vault, never on the machine.
- **Proof before "ok"**: the stored file is fetched back and its sha256 must match what was sent.
- **One copy per day, 30 days kept**: a second run the same day changes nothing. Days 31–40 back are deleted, but only under your prefix and only after the new copy is proven.
- **A refused delete never fails the backup** (0.2.0). On a bucket with an object lock, the lock counts from *upload* time, not from the date in the file name, so a copy named 31 days back can still be locked (BID, 30 Oct 2026: HTTP 409). The refused keys are returned in `pruneSkipped` with the store's reason, and the next night tries again. For a locked bucket, pass `prune: false` and let a storage lifecycle rule expire old copies — the store knows when a lock ends; the file name does not.
- **Freshness for a probe**: `backupFreshness()` answers whether there is a whole copy from today or yesterday. It returns dates and numbers, never contents.

```ts
import { runDbBackup, backupFreshness, openDbBackup } from "@broberg/backup";

// nightly, from your own cron (@broberg/cron / cronjobs.webhouse.net)
const r = await runDbBackup({
  source: { listTables, rows },        // your database: table names + all rows of one table
  store,                               // { upload, get, delete } — @broberg/media's storage fits
  publicKeyPem: process.env.BACKUP_PUBLIC_KEY!,
  what: "myapp, Turso arn",
  prefix: "myapp",                     // one prefix per app when apps share a bucket (default "db-backup")
});
if (!r.readBackMatches) throw new Error("backup not proven");

// probe route
const f = await backupFreshness(store, Date.now(), "myapp"); // { ok, newest, reason? }

// restore drill — on a machine that holds the PRIVATE key; writes nothing itself
const contents = await openDbBackup({ cipher, manifest, privateKeyPem });
```

## A large database — backup in parts (0.3.0)

`runDbBackup` builds the whole database as one string in memory. That is fine for a few MB; at hundreds of MB it is an out-of-memory on a small machine. `runDbBackupParts` takes rows **a page at a time** and writes each page as its own encrypted part, so the most it holds is one page.

- `<prefix>/<day>/part-00001.json.gz.enc` … one part per page: `gzip(JSON {table, rows})` → AES-256-GCM with its own IV, all under the one wrapped key.
- `<prefix>/<day>.manifest.json` (`version: 2`) lists every part with its sha256 and row count. It is written **only after every part has been read back and matched** — a night that broke half-way has no manifest, and the probe goes red.
- One copy per day, 30 days, `prune: false` and `pruneSkipped` work as above; an old day's parts are deleted through that day's manifest, and an old single-file day is removed too, so switching leaves nothing behind.
- `backupFreshness()` understands both formats and checks every part, one at a time.
- **An hourly probe on a big backup** (0.4.0): `backupFreshness(store, now, prefix, { verify: "manifest" })` reads only the manifest — is there one from today or yesterday, how old (`ageMinutes`), how many parts. It downloads no backup bytes, so it cannot see a missing or changed part, and its answer says so: `verified: "manifest", partsRead: false`. Run the default (`verify: "full"`, answers `partsRead: true`) once a day right after the backup.

```ts
import { runDbBackupParts, openDbBackupParts } from "@broberg/backup";

// Postgres, keyset pagination (stable and cheap on a big table — not OFFSET)
const source = {
  listTables: async () => (await sql`select tablename from pg_tables where schemaname = 'public'`).map((r) => r.tablename),
  async *pages(table: string, pageSize: number) {
    let after: string | null = null;
    for (;;) {
      const rows = after === null
        ? await sql`select * from ${sql(table)} order by ctid limit ${pageSize}`
        : await sql`select * from ${sql(table)} where ctid > ${after}::tid order by ctid limit ${pageSize}`;
      if (rows.length === 0) return;
      yield rows;
      after = rows.at(-1).ctid;   // select ctid, * … if your driver does not return it
    }
  },
};

const r = await runDbBackupParts({
  source, store, publicKeyPem, what: "myapp, Postgres", prefix: "myapp",
  pageSize: (t) => (t === "audit_log" ? 5000 : 2000), // a number, or one per table (default 2000)
});
if (!r.readBackMatches) throw new Error("backup not proven");

// restore drill, one part at a time
for await (const { table, rows } of openDbBackupParts({ store, manifest, privateKeyPem })) { /* … */ }
```

Order the pages by a key that does not change while the backup runs (a primary key, or `ctid` for a table without one). A logical dump across many pages is not one transaction: rows written during the backup may or may not be in it. Run it in a `REPEATABLE READ` transaction if you need one consistent snapshot.

Restoring rows into a database is your step. Restoring over a **live** database is destructive and needs the owner's own words.

Runs on Node ≥ 20 and Bun. No runtime dependencies (node:crypto, node:zlib, Web Crypto).
