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

Restoring rows into a database is your step. Restoring over a **live** database is destructive and needs the owner's own words.

Runs on Node ≥ 20 and Bun. No runtime dependencies (node:crypto, node:zlib, Web Crypto).
