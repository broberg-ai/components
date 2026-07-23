// F039 auto-enrollment store — the Discovery write-layer. Turso/libSQL (the
// fleet's shared edge DB, multi-machine-safe across Discovery's machines). A
// `file:`/`:memory:` URL works for dev + tests; disabled (null) when no URL is
// configured, so reads still work and writes 503 (ship-dark).
import { createClient, type Client, type Row } from "@libsql/client";

export type Role = "uses" | "src";

export interface Enrollment {
  session: string;
  pkg: string;
  version: string;
  role: Role;
  commit: string | null;
  notes: string | null;
  updated_at: number;
}

export interface EnrollInput {
  session: string;
  pkg: string;
  version: string;
  role?: Role;
  commit?: string | null;
  notes?: string | null;
}

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS enrollments (
  session TEXT NOT NULL,
  pkg TEXT NOT NULL,
  version TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'uses',
  commit_sha TEXT,
  notes TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session, pkg)
)`;

// Trust-on-first-use per-session keys: each session generates its OWN key
// (openssl rand -hex 32) and places it in its OWN .env — no central key to
// distribute. The first enroll for a session binds sha256(key) here; later
// enrolls from that session must present the same key. A leaked session key
// can only write THAT session's enrollment, never the whole roster.
const CREATE_KEYS = `CREATE TABLE IF NOT EXISTS session_keys (
  session TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  bound_at INTEGER NOT NULL
)`;

const rowToEnrollment = (r: Row): Enrollment => ({
  session: String(r.session),
  pkg: String(r.pkg),
  version: String(r.version),
  role: r.role === "src" ? "src" : "uses",
  commit: r.commit_sha == null ? null : String(r.commit_sha),
  notes: r.notes == null ? null : String(r.notes),
  updated_at: Number(r.updated_at),
});

export interface EnrollStore {
  /** Idempotent on (session, pkg) — re-enrolling updates the version/role in place. */
  upsert(input: EnrollInput): Promise<Enrollment>;
  list(): Promise<Enrollment[]>;
  bySession(session: string): Promise<Enrollment[]>;
  /** TOFU: the key hash bound to this session, or null if it hasn't registered one yet. */
  sessionKeyHash(session: string): Promise<string | null>;
  /** Bind a key hash to a session on first enroll (no-op if already bound — race-safe). */
  bindSessionKey(session: string, keyHash: string): Promise<void>;
  /**
   * F039.5 — the "ask components to reset it" escape hatch. Drops ONLY this
   * session's key binding so it can re-bind a fresh key on the next enroll.
   * The enrollments (adoptions) live in a SEPARATE table and are untouched.
   * Owner-only: there is deliberately no HTTP route to this — a network-reachable
   * reset would be a TOFU-bypass surface. Returns rows removed (0 if not bound).
   */
  resetSessionKey(session: string): Promise<number>;
}

export function makeEnrollStore(client: Client): EnrollStore {
  return {
    async upsert(input) {
      const role: Role = input.role === "src" ? "src" : "uses";
      const commit = input.commit ?? null;
      const notes = input.notes ?? null;
      const updated_at = Date.now();
      await client.execute({
        sql: `INSERT INTO enrollments (session, pkg, version, role, commit_sha, notes, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(session, pkg) DO UPDATE SET
                version = excluded.version, role = excluded.role,
                commit_sha = excluded.commit_sha, notes = excluded.notes,
                updated_at = excluded.updated_at`,
        args: [input.session, input.pkg, input.version, role, commit, notes, updated_at],
      });
      return { session: input.session, pkg: input.pkg, version: input.version, role, commit, notes, updated_at };
    },
    async list() {
      const rs = await client.execute("SELECT * FROM enrollments ORDER BY updated_at DESC");
      return rs.rows.map(rowToEnrollment);
    },
    async bySession(session) {
      const rs = await client.execute({ sql: "SELECT * FROM enrollments WHERE session = ? ORDER BY pkg", args: [session] });
      return rs.rows.map(rowToEnrollment);
    },
    async sessionKeyHash(session) {
      const rs = await client.execute({ sql: "SELECT key_hash FROM session_keys WHERE session = ?", args: [session] });
      return rs.rows.length ? String(rs.rows[0]!.key_hash) : null;
    },
    async bindSessionKey(session, keyHash) {
      await client.execute({
        sql: "INSERT INTO session_keys (session, key_hash, bound_at) VALUES (?, ?, ?) ON CONFLICT(session) DO NOTHING",
        args: [session, keyHash, Date.now()],
      });
    },
    async resetSessionKey(session) {
      const rs = await client.execute({ sql: "DELETE FROM session_keys WHERE session = ?", args: [session] });
      return rs.rowsAffected;
    },
  };
}

// Lazy singleton — reads config at first use (so tests can set env after import).
// ENROLL_DB_URL (dev/test) wins over TURSO_DATABASE_URL (prod). No URL → disabled.
let _init: Promise<EnrollStore | null> | null = null;
export function getEnrollStore(): Promise<EnrollStore | null> {
  if (!_init) {
    _init = (async () => {
      const url = process.env.ENROLL_DB_URL || process.env.TURSO_DATABASE_URL;
      if (!url) return null;
      const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
      await client.execute(CREATE_TABLE);
      await client.execute(CREATE_KEYS);
      return makeEnrollStore(client);
    })();
  }
  return _init;
}
