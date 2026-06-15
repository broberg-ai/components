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
      return makeEnrollStore(client);
    })();
  }
  return _init;
}
