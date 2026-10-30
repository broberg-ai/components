import { redactSecrets } from "@broberg/secret-scan";

/**
 * @broberg/logger — server logging for the fleet.
 *
 * The package exists for two reasons, and nothing that fails to serve one of
 * them belongs in it:
 *
 *  1. A secret cannot reach the log by accident. Every message and every
 *     metadata value goes through `@broberg/secret-scan` BY DEFAULT.
 *  2. One shape across every app, so a line is searchable regardless of which
 *     project emitted it.
 *
 * It is NOT a transport system: stdout is the contract and the platform
 * collects it. No rotation, no buffering, no sampling.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVELS = Object.keys(RANK) as LogLevel[];

function isLevel(v: unknown): v is LogLevel {
  return typeof v === "string" && (LEVELS as string[]).includes(v);
}

/** Extra structured fields on a line. */
export type LogFields = Record<string, unknown>;

export interface LoggerOptions {
  /** Service name, emitted on every line. */
  name?: string;
  /**
   * Minimum level to emit. Explicit option wins over `LOG_LEVEL`, which wins
   * over the `info` default — an env var should never silently override a
   * decision the code made on purpose.
   */
  level?: LogLevel;
  /** `true` = readable text (development), `false` = one-line JSON (production). */
  pretty?: boolean;
  /**
   * Run every line through @broberg/secret-scan before output. Default `true`.
   * Turn it off ONLY with the measured cost in hand (see the README benchmark) —
   * a logger you must remember to make safe is not safe.
   */
  redact?: boolean;
  /**
   * Extra FIELD NAMES whose value is always redacted, on top of
   * {@link DEFAULT_REDACT_KEYS}. Matched case- and separator-insensitively, at
   * any depth and in child bindings. Needs `redact` on (the default).
   */
  redactKeys?: string[];
  /** Where the finished line goes. Default `console`. Injectable for tests. */
  sink?: (line: string, level: LogLevel) => void;
  /** Fields merged into every line (see {@link Logger.child}). */
  bindings?: LogFields;
  /** Clock, injectable so tests get a stable timestamp. */
  now?: () => Date;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  /** Accepts an Error directly — it is serialised as name/message/stack, never `{}`. */
  error(messageOrError: string | Error, fields?: LogFields): void;
  /** A logger with extra bindings on every line. Nests. */
  child(bindings: LogFields): Logger;
  /** The level this logger emits at (after option/env/default resolution). */
  readonly level: LogLevel;
}

function resolveLevel(explicit?: LogLevel): LogLevel {
  if (explicit) return explicit;
  const env =
    typeof process !== "undefined" && process.env ? process.env.LOG_LEVEL : undefined;
  return isLevel(env) ? env : "info";
}

function defaultSink(line: string, level: LogLevel): void {
  // warn/error to stderr so a shell pipeline can separate them; the rest to stdout.
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/**
 * Field names whose VALUE is redacted whatever its shape (F063.2).
 *
 * The pattern pass (@broberg/secret-scan) catches a credential by what it LOOKS
 * like. A user's password, a PIN or a CPR number looks like nothing — measured on
 * the published 0.1.0: `{password:'hemmelig123'}` and `{apiKey:'kort'}` went out
 * verbatim. The only marker such a value has is the key it sits under, so the
 * key is what we match. Both passes run; neither replaces the other.
 *
 * Matching ignores case and separators: `apiKey`, `api_key`, `API-KEY` are one
 * entry. A list that missed on casing would be the same false green in miniature.
 */
export const DEFAULT_REDACT_KEYS: readonly string[] = [
  "password", "passwd", "pwd", "passphrase", "pin", "cpr", "cprnr", "ssn",
  "secret", "clientsecret", "privatekey",
  "authorization", "cookie", "setcookie",
  "apikey", "xapikey", "accesstoken", "refreshtoken", "idtoken",
];

const REDACTED_FIELD = "[REDACTED:field]";

function normKey(k: string): string {
  return k.toLowerCase().replace(/[-_\s.]/g, "");
}

/**
 * A copy of `value` with every listed field's value replaced — at any depth,
 * cycle-safe. Runs on the record BEFORE serialisation; the pattern pass still
 * runs on the serialised line after it.
 */
function redactFields(value: unknown, keys: ReadonlySet<string>, seen = new WeakSet<object>()): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (value instanceof Error) return value; // serialised later; its fields go through the pattern pass
  if (seen.has(value)) return value; // safeStringify marks it [Circular]
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactFields(v, keys, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = keys.has(normKey(k)) ? REDACTED_FIELD : redactFields(v, keys, seen);
  }
  return out;
}

/** Errors do not survive JSON.stringify — pull the parts that matter out by hand. */
function serialiseError(err: Error): LogFields {
  return { name: err.name, message: err.message, stack: err.stack };
}

/**
 * JSON.stringify that survives the inputs that break it: a circular reference,
 * or an object whose `toJSON` throws. Both are real — a request object and an
 * ORM row respectively — and neither is worth losing a log line over.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (val instanceof Error) return serialiseError(val);
    if (typeof val === "bigint") return val.toString();
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  });
}

function prettyLine(record: Record<string, unknown>): string {
  const { level, time, msg, name, ...rest } = record as {
    level: string;
    time: string;
    msg: string;
    name?: string;
    [k: string]: unknown;
  };
  const head = `${time} ${level.toUpperCase().padEnd(5)} ${name ? `[${name}] ` : ""}${msg}`;
  const keys = Object.keys(rest);
  if (keys.length === 0) return head;
  const tail = keys.map((k) => `${k}=${formatValue(rest[k])}`).join(" ");
  return `${head} ${tail}`;
}

function formatValue(v: unknown): string {
  if (typeof v === "string") return v.includes(" ") ? JSON.stringify(v) : v;
  if (v === null || v === undefined || typeof v !== "object") return String(v);
  return safeStringify(v) ?? "";
}

/**
 * Build a logger.
 *
 * Every call is wrapped so that NOTHING in this package can throw into the
 * caller. This sits in the request path of every app; a logger that crashes the
 * request is strictly worse than no logger, because the app worked before you
 * added observability.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = resolveLevel(options.level);
  const min = RANK[level];
  const sink = options.sink ?? defaultSink;
  const redact = options.redact !== false;
  const redactKeys: ReadonlySet<string> = new Set(
    [...DEFAULT_REDACT_KEYS, ...(options.redactKeys ?? [])].map(normKey),
  );
  const pretty = options.pretty === true;
  const bindings = options.bindings ?? {};
  const now = options.now ?? (() => new Date());

  function emit(lvl: LogLevel, message: string | Error, fields?: LogFields): void {
    try {
      if (RANK[lvl] < min) return;

      const isErr = message instanceof Error;
      const raw: Record<string, unknown> = {
        level: lvl,
        time: now().toISOString(),
        msg: isErr ? message.message : message,
        ...(options.name ? { name: options.name } : {}),
        ...bindings,
        ...(fields ?? {}),
        ...(isErr ? { err: serialiseError(message) } : {}),
      };
      // Key names first (a password has no shape), patterns on the line after.
      const record = redact ? (redactFields(raw, redactKeys) as Record<string, unknown>) : raw;

      let line = pretty ? prettyLine(record) : safeStringify(record);
      if (typeof line !== "string") return; // stringify returned undefined

      // Redact the SERIALISED line: one pass covers message and metadata
      // together, so a nested value cannot be missed by a traversal bug.
      if (redact) line = redactSecrets(line).redacted;

      sink(line, lvl);
    } catch {
      // Swallow. A logging failure must never become the caller's problem.
    }
  }

  const self: Logger = {
    level,
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (extra) =>
      createLogger({ ...options, level, bindings: { ...bindings, ...extra } }),
  };
  return self;
}
