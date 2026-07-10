/**
 * @broberg/event-log — headless append-only event-log core.
 *
 * Five+ repos hand-rolled the same write-side contract (a typed entry, a
 * fire-and-forget writer that never blocks the caller, IP hashing, GDPR export/
 * anonymise). This owns that contract, framework- and DB-free. Persistence is a
 * pluggable `LogStore` (JSONL / SQLite / Supabase adapters build on top); the
 * `LogStore` interface is **frozen at v1** — a breaking change invalidates every
 * adapter, so it is semver-major-gated.
 */

/** audit = GDPR who-did-what · activity = operational · server = errors/deploys. */
export type LogLayer = "audit" | "activity" | "server";
export type LogLevel = "info" | "warn" | "error";
/** Open by design; a consumer may narrow via the generic on `LogEntry`. */
export type ActivityActorKind = "user" | "system" | "llm" | "pipeline" | (string & {});

export interface LogActor {
  id?: string;
  kind: ActivityActorKind;
  label?: string;
}

export interface LogTarget {
  type?: string;
  id?: string;
  label?: string;
}

export interface LogEntry<TKind extends string = string> {
  id: string;
  /** ISO timestamp. */
  at: string;
  layer: LogLayer;
  level: LogLevel;
  kind: TKind;
  actor?: LogActor;
  target?: LogTarget;
  summary?: string;
  metadata?: Record<string, unknown>;
  tenantId?: string;
  /** Pseudonymised IP (see `hashIp`) — never the raw address. */
  ipHash?: string;
}

/** Fields a caller supplies; `makeLogEntry` stamps `id` + `at` and defaults `level`. */
export type LogInput<TKind extends string = string> = Omit<LogEntry<TKind>, "id" | "at" | "level"> & {
  level?: LogLevel;
};

/** Retention knobs — single source, never inline these numbers. */
export const LOG_CONFIG = {
  MAX_AGE_DAYS: 365,
  MAX_LINES: 50_000,
} as const;

export interface ReadOptions {
  layer?: LogLayer;
  level?: LogLevel;
  actorId?: string;
  /** ISO string — entries strictly older are excluded. */
  since?: string;
  /** Keep only entries whose `kind` starts with this. */
  kindPrefix?: string;
  limit?: number;
}

/**
 * Persistence contract. FROZEN at v1 (semver-major-gated) — the JSONL, SQLite
 * and Supabase adapters all implement exactly this.
 */
export interface LogStore {
  append(entry: LogEntry): void | Promise<void>;
  read(options?: ReadOptions): LogEntry[] | Promise<LogEntry[]>;
}

function genId(): string {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback id — good enough for logs; adapters may override.
  return `e-${Math.abs(hashString(String(Date.now()) + Math.random())).toString(36)}`;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/** Build a complete entry from caller input, stamping `id` + `at` (now, ISO). */
export function makeLogEntry<TKind extends string = string>(input: LogInput<TKind>): LogEntry<TKind> {
  return {
    id: genId(),
    at: new Date().toISOString(),
    ...input,
    level: input.level ?? "info",
  } as LogEntry<TKind>;
}

/** In-memory store — for tests, SSR, or an ephemeral buffer. */
export function createMemoryLogStore(): LogStore & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    append(entry) {
      entries.push(entry);
    },
    read(options) {
      return filterEntries(entries, options);
    },
  };
}

/** Filter + sort entries newest-first. Pure; used by in-memory + file adapters. */
export function filterEntries(entries: LogEntry[], options: ReadOptions = {}): LogEntry[] {
  let out = entries.filter((e) => {
    if (options.layer && e.layer !== options.layer) return false;
    if (options.level && e.level !== options.level) return false;
    if (options.actorId && e.actor?.id !== options.actorId) return false;
    if (options.since && e.at < options.since) return false;
    if (options.kindPrefix && !e.kind.startsWith(options.kindPrefix)) return false;
    return true;
  });
  out = out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // newest first
  return options.limit != null ? out.slice(0, options.limit) : out;
}

// ── GDPR primitives ──────────────────────────────────────────────────────

/**
 * Pseudonymise an IP with SHA-256 (Web Crypto — Node 20+/Bun/browser). Returns
 * an 8-char prefix by default (compact, still one-way); pass `{ full: true }`
 * for the whole digest where a stricter DPA interpretation is required.
 */
export async function hashIp(ip: string, opts: { full?: boolean } = {}): Promise<string> {
  const subtle = (globalThis as unknown as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) throw new Error("hashIp: Web Crypto SubtleCrypto is unavailable in this runtime");
  const data = new TextEncoder().encode(ip);
  const digest = await subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return opts.full ? hex : hex.slice(0, 8);
}

/** Replace each named field with `[deleted]` (Art. 17 anonymisation). Pure. */
export function anonymizeContact<T extends Record<string, unknown>>(row: T, fields: string[]): T {
  const out = { ...row };
  for (const f of fields) {
    if (f in out) (out as Record<string, unknown>)[f] = "[deleted]";
  }
  return out;
}

// ── Fire-and-forget event log ─────────────────────────────────────────────

export interface EventLogOptions {
  /** Called when an append throws (fire-and-forget stays silent otherwise). */
  onError?: (error: unknown, entry: LogEntry) => void;
}

export interface EventLog {
  /** Write an entry. NEVER throws + never blocks — a store error is swallowed. */
  log(input: LogInput): void;
  audit(input: Omit<LogInput, "layer">): void;
  activity(input: Omit<LogInput, "layer">): void;
  server(input: Omit<LogInput, "layer">): void;
  read(options?: ReadOptions): LogEntry[] | Promise<LogEntry[]>;
  // Convenience wrappers (audit/activity/server layer pre-filled).
  logLogin(actor: LogActor, meta?: Record<string, unknown>): void;
  logLogout(actor: LogActor): void;
  logLoginFailed(summary: string, meta?: Record<string, unknown>): void;
  logDocumentCreated(actor: LogActor, target: LogTarget): void;
  logDocumentUpdated(actor: LogActor, target: LogTarget): void;
  logDocumentPublished(actor: LogActor, target: LogTarget): void;
  logDocumentDeleted(actor: LogActor, target: LogTarget): void;
  logRoleChanged(actor: LogActor, target: LogTarget, meta?: Record<string, unknown>): void;
  logExport(actor: LogActor, meta?: Record<string, unknown>): void;
  logAgentRan(actor: LogActor, summary: string, meta?: Record<string, unknown>): void;
  serverError(summary: string, meta?: Record<string, unknown>): void;
}

/**
 * Wrap a `LogStore` in fire-and-forget writers. Every write is wrapped so a
 * store failure (async or sync) can never throw into or block the caller — the
 * primary operation must never be blocked by logging.
 */
export function createEventLog(store: LogStore, options: EventLogOptions = {}): EventLog {
  function write(input: LogInput): void {
    const entry = makeLogEntry(input);
    try {
      const r = store.append(entry);
      if (r && typeof (r as Promise<void>).then === "function") {
        (r as Promise<void>).catch((err) => options.onError?.(err, entry));
      }
    } catch (err) {
      options.onError?.(err, entry);
    }
  }

  const layer =
    (l: LogLayer) =>
    (input: Omit<LogInput, "layer">): void =>
      write({ ...input, layer: l });

  const audit = layer("audit");
  const activity = layer("activity");
  const server = layer("server");

  return {
    log: write,
    audit,
    activity,
    server,
    read: (o) => store.read(o),
    logLogin: (actor, meta) => audit({ kind: "auth.login", actor, metadata: meta }),
    logLogout: (actor) => audit({ kind: "auth.logout", actor }),
    logLoginFailed: (summary, meta) => audit({ kind: "auth.login_failed", level: "warn", summary, metadata: meta }),
    logDocumentCreated: (actor, target) => audit({ kind: "document.created", actor, target }),
    logDocumentUpdated: (actor, target) => audit({ kind: "document.updated", actor, target }),
    logDocumentPublished: (actor, target) => audit({ kind: "document.published", actor, target }),
    logDocumentDeleted: (actor, target) => audit({ kind: "document.deleted", level: "warn", actor, target }),
    logRoleChanged: (actor, target, meta) => audit({ kind: "role.changed", level: "warn", actor, target, metadata: meta }),
    logExport: (actor, meta) => audit({ kind: "gdpr.export", actor, metadata: meta }),
    logAgentRan: (actor, summary, meta) => activity({ kind: "agent.ran", actor, summary, metadata: meta }),
    serverError: (summary, meta) => server({ kind: "server.error", level: "error", summary, metadata: meta }),
  };
}
