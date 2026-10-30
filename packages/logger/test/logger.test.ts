import { afterEach, describe, expect, it } from "vitest";
import { createLogger, type LogLevel } from "../src/index";

/**
 * Every assertion here reads the line the SINK RECEIVED — never an intermediate
 * record. A redaction test that inspects the pre-serialisation object proves
 * nothing about what actually left the process, which is the exact shape of
 * failure this repo hit three times on 2026-08-07.
 */
function capture(opts: Parameters<typeof createLogger>[0] = {}) {
  const lines: Array<{ line: string; level: LogLevel }> = [];
  const log = createLogger({
    sink: (line, level) => lines.push({ line, level }),
    now: () => new Date("2026-08-08T09:00:00.000Z"),
    ...opts,
  });
  return { log, lines, last: () => lines[lines.length - 1]!.line };
}

const ORIGINAL_LOG_LEVEL = process.env.LOG_LEVEL;
afterEach(() => {
  if (ORIGINAL_LOG_LEVEL === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = ORIGINAL_LOG_LEVEL;
});

// Synthetic, never a real credential — but a shape secret-scan actually matches.
const SECRET = "sk-ant-api03-" + "A".repeat(80) + "AA";

describe("redaction — the reason this package exists", () => {
  it("redacts a secret in the MESSAGE, in the emitted line", () => {
    const { log, last } = capture();
    log.info(`connecting with ${SECRET}`);

    expect(last()).not.toContain(SECRET);
    expect(last()).toContain("[REDACTED:");
  });

  it("redacts a secret NESTED in metadata — recursion, not top-level only", () => {
    const { log, last } = capture();
    log.info("outbound", { request: { headers: { authorization: SECRET } } });

    expect(last()).not.toContain(SECRET);
    expect(last()).toContain("[REDACTED:");
  });

  it("redacts a secret attached to an Error's fields", () => {
    const { log, last } = capture();
    log.error(new Error("auth failed"), { key: SECRET });

    expect(last()).not.toContain(SECRET);
  });

  it("redact:false emits the value unchanged — the opt-out is real", () => {
    const { log, last } = capture({ redact: false });
    log.info(`connecting with ${SECRET}`);

    expect(last()).toContain(SECRET);
  });

  it("leaves ordinary text alone", () => {
    const { log, last } = capture();
    log.info("served /api/search in 12ms");

    expect(last()).toContain("served /api/search in 12ms");
    expect(last()).not.toContain("[REDACTED:");
  });
});

describe("never throws — it sits in the request path", () => {
  it("survives a sink that throws", () => {
    const log = createLogger({
      sink: () => {
        throw new Error("sink is broken");
      },
    });
    expect(() => log.info("hello")).not.toThrow();
  });

  it("survives a circular reference in metadata", () => {
    const { log, lines } = capture();
    const circular: Record<string, unknown> = { name: "req" };
    circular.self = circular;

    expect(() => log.info("cycle", { circular })).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.line).toContain("[Circular]");
  });

  it("survives an object whose toJSON throws", () => {
    const { log } = capture();
    const hostile = {
      toJSON() {
        throw new Error("nope");
      },
    };
    expect(() => log.info("hostile", { hostile })).not.toThrow();
  });
});

describe("levels", () => {
  it("gates below the configured level", () => {
    const { log, lines } = capture({ level: "warn" });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");

    expect(lines.map((l) => l.level)).toEqual(["warn", "error"]);
  });

  it("honours LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "error";
    const { log, lines } = capture();
    log.warn("w");
    log.error("e");

    expect(lines.map((l) => l.level)).toEqual(["error"]);
  });

  it("an explicit level BEATS LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "error";
    const { log, lines } = capture({ level: "debug" });
    log.debug("d");

    expect(lines).toHaveLength(1);
    expect(log.level).toBe("debug");
  });

  it("ignores a nonsense LOG_LEVEL rather than emitting nothing", () => {
    process.env.LOG_LEVEL = "loud";
    const { log, lines } = capture();
    log.info("i");

    expect(log.level).toBe("info");
    expect(lines).toHaveLength(1);
  });
});

describe("output shape", () => {
  it("pretty:false emits exactly ONE line of valid JSON", () => {
    const { log, last } = capture({ name: "discovery" });
    log.info("served", { route: "/api/search", ms: 12 });

    expect(last()).not.toContain("\n");
    const parsed = JSON.parse(last());
    expect(parsed).toMatchObject({
      level: "info",
      msg: "served",
      name: "discovery",
      route: "/api/search",
      ms: 12,
      time: "2026-08-08T09:00:00.000Z",
    });
  });

  it("pretty:true emits readable text, not JSON", () => {
    const { log, last } = capture({ pretty: true, name: "discovery" });
    log.warn("slow", { ms: 900 });

    expect(() => JSON.parse(last())).toThrow();
    expect(last()).toContain("WARN");
    expect(last()).toContain("[discovery]");
    expect(last()).toContain("slow");
    expect(last()).toContain("ms=900");
  });

  it("routes warn/error to the sink with the right level", () => {
    const { log, lines } = capture();
    log.info("a");
    log.error("b");
    expect(lines.map((l) => l.level)).toEqual(["info", "error"]);
  });
});

describe("Error serialisation", () => {
  it("emits name, message AND stack — never {}", () => {
    const { log, last } = capture();
    log.error(new Error("boom"));

    const parsed = JSON.parse(last());
    expect(parsed.msg).toBe("boom");
    expect(parsed.err.name).toBe("Error");
    expect(parsed.err.message).toBe("boom");
    expect(typeof parsed.err.stack).toBe("string");
    expect(parsed.err.stack.length).toBeGreaterThan(0);
  });

  it("serialises an Error passed inside fields too", () => {
    const { log, last } = capture();
    log.warn("retrying", { cause: new TypeError("bad input") });

    const parsed = JSON.parse(last());
    expect(parsed.cause.name).toBe("TypeError");
    expect(parsed.cause.message).toBe("bad input");
  });
});

describe("child bindings", () => {
  it("puts bindings on every line without the caller repeating them", () => {
    const { log, last } = capture();
    const reqLog = log.child({ requestId: "abc123" });

    reqLog.info("start");
    expect(JSON.parse(last()).requestId).toBe("abc123");
    reqLog.info("end");
    expect(JSON.parse(last()).requestId).toBe("abc123");
  });

  it("NESTS — child(a).child(b) carries both", () => {
    const { log, last } = capture();
    log.child({ requestId: "abc" }).child({ tenant: "acme" }).info("hi");

    const parsed = JSON.parse(last());
    expect(parsed.requestId).toBe("abc");
    expect(parsed.tenant).toBe("acme");
  });

  it("a per-call field overrides a binding", () => {
    const { log, last } = capture();
    log.child({ route: "/a" }).info("hi", { route: "/b" });

    expect(JSON.parse(last()).route).toBe("/b");
  });

  it("does not mutate the parent", () => {
    const { log, last } = capture();
    log.child({ requestId: "abc" }).info("child");
    log.info("parent");

    expect(JSON.parse(last()).requestId).toBeUndefined();
  });

  it("a child keeps redaction on", () => {
    const { log, last } = capture();
    log.child({ requestId: "abc" }).info(`key ${SECRET}`);

    expect(last()).not.toContain(SECRET);
  });
});

describe("redaction by FIELD NAME (F063.2) — a password has no shape", () => {
  const capture = (opts: Parameters<typeof createLogger>[0] = {}) => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l), now: () => new Date(0), ...opts });
    return { log, lines };
  };

  it("{password:'hemmelig123'} is redacted, not logged verbatim", () => {
    const { log, lines } = capture();
    log.info("login", { password: "hemmelig123" });
    expect(lines[0]).not.toContain("hemmelig123");
    expect(JSON.parse(lines[0]!).password).toBe("[REDACTED:field]");
  });

  it("a NESTED field and a child-logger binding are redacted too", () => {
    const { log, lines } = capture();
    log.info("nested", { user: { name: "ane", password: "x-nested" } });
    log.child({ apiKey: "kort" }).info("bound");
    expect(lines[0]).not.toContain("x-nested");
    expect(JSON.parse(lines[0]!).user).toStrictEqual({ name: "ane", password: "[REDACTED:field]" });
    expect(lines[1]).not.toContain("kort");
    expect(JSON.parse(lines[1]!).apiKey).toBe("[REDACTED:field]");
  });

  it("matching is case- and separator-insensitive", () => {
    const { log, lines } = capture();
    log.info("variants", { apiKey: "a1", api_key: "a2", "API-KEY": "a3", Authorization: "a4" });
    const rec = JSON.parse(lines[0]!);
    for (const k of ["apiKey", "api_key", "API-KEY", "Authorization"]) expect(rec[k]).toBe("[REDACTED:field]");
    for (const v of ["a1", "a2", "a3", "a4"]) expect(lines[0]).not.toContain(`"${v}"`);
  });

  it("the PATTERN pass still works — key names were added, not substituted", () => {
    const { log, lines } = capture();
    log.info("patterns", {
      note: "sk-proj-" + "A".repeat(48),
      gh: "ghp_" + "a".repeat(36),
      // Assembled from parts so the repo's own secret gate does not read the test as a leak.
      header: "Bearer " + ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "c2lnbmF0dXJlc2lnbmF0dXJl"].join("."),
    });
    expect(lines[0]).toContain("[REDACTED:openai-api-key]");
    expect(lines[0]).toContain("[REDACTED:github-token]");
    expect(lines[0]).toContain("[REDACTED:jwt]");
  });

  it("NEGATIVE CONTROL: a field not on the list and with no secret shape is logged verbatim", () => {
    const { log, lines } = capture();
    log.info("ordinary", { userId: "u-42", passwordChangedAt: "2026-10-30", count: 3 });
    const rec = JSON.parse(lines[0]!);
    expect(rec.userId).toBe("u-42");
    expect(rec.passwordChangedAt).toBe("2026-10-30");
    expect(rec.count).toBe(3);
  });

  it("redactKeys EXTENDS the defaults (one option, no fork)", () => {
    const { log, lines } = capture({ redactKeys: ["memberNumber"] });
    log.info("extended", { member_number: "M-99", password: "p" });
    const rec = JSON.parse(lines[0]!);
    expect(rec.member_number).toBe("[REDACTED:field]");
    expect(rec.password).toBe("[REDACTED:field]");
  });

  it("pretty mode redacts by field name as well", () => {
    const { log, lines } = capture({ pretty: true });
    log.info("pretty", { password: "pretty-secret" });
    expect(lines[0]).not.toContain("pretty-secret");
    expect(lines[0]).toContain("password=[REDACTED:field]");
  });

  it("redact:false turns key-name redaction off too — one switch, documented", () => {
    const { log, lines } = capture({ redact: false });
    log.info("off", { password: "visible" });
    expect(JSON.parse(lines[0]!).password).toBe("visible");
  });
});
