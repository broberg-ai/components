import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createLogger, type LogLevel } from "../src/index";
import { errorLogger, requestLogger } from "../src/hono";

function capture() {
  const lines: Array<{ line: string; level: LogLevel }> = [];
  const log = createLogger({ sink: (line, level) => lines.push({ line, level }) });
  return { log, lines, last: () => JSON.parse(lines[lines.length - 1]!.line) };
}

describe("requestLogger", () => {
  it("emits one line per request with method, path, status and duration", async () => {
    const { log, lines, last } = capture();
    const app = new Hono();
    app.use("*", requestLogger(log));
    app.get("/ok", (c) => c.json({ ok: true }));

    const res = await app.request("/ok");
    expect(res.status).toBe(200);
    expect(lines).toHaveLength(1);
    expect(last()).toMatchObject({ method: "GET", path: "/ok", status: 200, msg: "request" });
    expect(typeof last().ms).toBe("number");
  });

  it("picks the level from the status: 5xx error, 4xx warn, else info", async () => {
    const { log, lines } = capture();
    const app = new Hono();
    app.use("*", requestLogger(log));
    app.get("/ok", (c) => c.json({}));
    app.get("/missing", (c) => c.json({}, 404));
    app.get("/broken", (c) => c.json({}, 500));

    await app.request("/ok");
    await app.request("/missing");
    await app.request("/broken");

    expect(lines.map((l) => l.level)).toEqual(["info", "warn", "error"]);
  });

  it("binds a request id and echoes it on the response", async () => {
    const { log, last } = capture();
    const app = new Hono();
    app.use("*", requestLogger(log));
    app.get("/x", (c) => c.json({}));

    const res = await app.request("/x");
    const header = res.headers.get("x-request-id");
    expect(header).toBeTruthy();
    expect(last().requestId).toBe(header);
  });

  it("REUSES an incoming x-request-id so a caller's trace survives", async () => {
    const { log, last } = capture();
    const app = new Hono();
    app.use("*", requestLogger(log));
    app.get("/x", (c) => c.json({}));

    const res = await app.request("/x", { headers: { "x-request-id": "caller-trace-1" } });
    expect(last().requestId).toBe("caller-trace-1");
    expect(res.headers.get("x-request-id")).toBe("caller-trace-1");
  });

  it("hands the handler a child logger already carrying the request id", async () => {
    const { log, lines } = capture();
    const app = new Hono<{ Variables: { log: ReturnType<typeof createLogger> } }>();
    app.use("*", requestLogger(log));
    app.get("/x", (c) => {
      c.get("log").info("handler did work");
      return c.json({});
    });

    await app.request("/x");
    const handlerLine = JSON.parse(lines[0]!.line);
    const requestLine = JSON.parse(lines[1]!.line);
    expect(handlerLine.msg).toBe("handler did work");
    expect(handlerLine.requestId).toBe(requestLine.requestId);
  });

  it("MEASURED LIMITATION: requestLogger alone logs the 500 but NOT the cause", async () => {
    // Hono catches a throwing handler itself, so `await next()` resolves and the
    // exception never reaches the middleware. Asserting this explicitly so the
    // limitation cannot be forgotten — it is why errorLogger exists.
    const { log, lines } = capture();
    const app = new Hono();
    app.use("*", requestLogger(log));
    app.get("/boom", () => {
      throw new Error("handler exploded");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);

    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]!.line);
    expect(line.level).toBe("error");
    expect(line.status).toBe(500);
    expect(line.err).toBeUndefined(); // <- no cause. This is the gap.
  });

  it("errorLogger closes that gap: the exception IS logged, with its stack", async () => {
    const { log, lines } = capture();
    const app = new Hono();
    app.use("*", requestLogger(log));
    app.onError(errorLogger(log));
    app.get("/boom", () => {
      throw new Error("handler exploded");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);

    const errLine = JSON.parse(lines[0]!.line);
    expect(errLine.err.message).toBe("handler exploded");
    expect(typeof errLine.err.stack).toBe("string");
    expect(errLine.path).toBe("/boom");
  });

  it("errorLogger correlates the cause with the request id", async () => {
    const { log, lines } = capture();
    const app = new Hono();
    app.use("*", requestLogger(log));
    app.onError(errorLogger(log));
    app.get("/boom", () => {
      throw new Error("handler exploded");
    });

    await app.request("/boom", { headers: { "x-request-id": "trace-42" } });

    // Both the cause line and the request line carry the same id.
    for (const l of lines) expect(JSON.parse(l.line).requestId).toBe("trace-42");
  });

  it("skip() keeps health checks out of the log", async () => {
    const { log, lines } = capture();
    const app = new Hono();
    app.use("*", requestLogger(log, { skip: (c) => c.req.path === "/health" }));
    app.get("/health", (c) => c.text("ok"));
    app.get("/real", (c) => c.text("ok"));

    await app.request("/health");
    await app.request("/real");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!.line).path).toBe("/real");
  });

  it("still redacts — a secret in a query string never reaches the log", async () => {
    const secret = "sk-ant-api03-" + "A".repeat(80) + "AA";
    const { log, lines } = capture();
    const app = new Hono();
    app.use("*", requestLogger(log, { fields: (c) => ({ query: c.req.url }) }));
    app.get("/x", (c) => c.json({}));

    await app.request(`/x?token=${secret}`);
    expect(lines[0]!.line).not.toContain(secret);
    expect(lines[0]!.line).toContain("[REDACTED:");
  });
});
