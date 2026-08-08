# F063 — `@broberg/logger`

> Fleet server logging. Christian asked whether we already had one; we did not.

## Motivation

We have no plain server logger, and the two things that look like one are not:

- **`@broberg/event-log`** records *business* events — every line wants an actor and an action (`document.deleted`, `auth.login`). It ships **only an in-memory store**, has **zero `console` references**, and therefore *physically cannot write a server log*. Wrong model and no output.
- **`@upmetrics/sdk`** catches crashes and errors. It tells you when something broke, not what the server was doing in the minutes before.

A Discovery search for `logging` / `logger` / `structured logging` / `pino winston` returns no package.

**This gap is not theoretical.** `apps/discovery` has been in production since June and emits **zero log lines**. If it fell over at 03:00 there would be nothing to read.

## What this package is FOR (and what it is not)

It is **not** a wrapper around `console.log` — that would be 200 lines of nothing, and the right answer would be to keep using `console`. Two things justify a package:

1. **A secret cannot reach the log by accident.** We already own `@broberg/secret-scan` (38 patterns, incl. the Hue key beacon contributed yesterday). Running every message and every metadata value through it *by default* removes an entire class of mistake — precisely the one beacon made yesterday, when a rotation script printed seven characters of a **fresh** key "so it can be recognised". Christian caught that, not any mechanism. This is the mechanism.
2. **One shape across every app**, so a log line is searchable regardless of which project produced it.

If a change does not serve one of those two, it does not belong in this package.

## Scope

```ts
const log = createLogger({ name: "discovery", level: "info", pretty: false });
log.info("served", { route: "/api/search", ms: 12 });
log.error(err, { route: "/api/search" });

const reqLog = log.child({ requestId });   // bindings on every line, nests
```

- Four levels: `debug < info < warn < error`. Level from an explicit option, else `LOG_LEVEL`, else `info` — explicit wins.
- **Output**: one-line JSON (production) or readable text (development). The choice is an explicit option; we do not silently infer it from an unset variable, because "unset" is not a decision.
- **Redaction ON by default** over the message *and* recursively over metadata values. Opt out only with an explicit `redact: false`.
- `child(bindings)` — bound context, nests.
- `Error` serialised as `{ name, message, stack }`, never `{}`.
- `@broberg/logger/hono` — a request-logging middleware (method, path, status, duration, requestId).

### Non-goals (the package is wrong if it grows these)

- No transports, no file rotation, no buffering, no async queue, no sampling.
- No log aggregation or shipping — stdout is the contract; the platform collects it.
- Not a replacement for `@broberg/event-log` (business events) or `@upmetrics/sdk` (crashes). Three different questions: *what did the server do*, *who did what*, *what broke*.

## Architecture sketch

```
createLogger(opts) -> { debug, info, warn, error, child }
  level gate  ->  build record  ->  redact  ->  serialise  ->  sink (default: console)
                                    ^
                        @broberg/secret-scan redactSecrets
```

Every call is wrapped so a failure in *any* stage (a circular payload, a throwing `toJSON`, a broken sink) is swallowed — same fire-and-forget contract as `@broberg/event-log`. **A logger that crashes the request path is worse than no logger.**

`sink` is injectable purely so tests can capture the emitted line; it is not a transport system.

## Measurement, not assumption

Redaction runs ~38 regexes per call, and this session's repeated lesson is that unmeasured claims are the ones that bite. So the per-call overhead is **measured and published in the README**, and `redact: false` exists for someone who has read that number and needs the throughput. We do not guess whether it is acceptable — we state it.

## Dependencies

`@broberg/secret-scan` (the reason the package exists). Nothing else. Node + Bun + edge.

## Reuse

**Discovery reuse check (F217), run before this plan was written:** `discovery.broberg.ai/api/search` for `logging`, `logger`, `structured logging`, `server log`, `pino winston` — the only hits are `@upmetrics/sdk` (Telemetry) and `@broberg/event-log` (GDPR activity log), neither of which is server logging (see Motivation). **Decision: BUILD**, and reuse `@broberg/secret-scan` rather than re-rolling redaction.

## Rollout

1. Core + tests (redaction proven on the emitted line, never-throws, levels, child, Error).
2. Benchmark redaction; put the real number in the README.
3. `/hono` request middleware.
4. Bootstrap-publish `v0.1.0` (new name ⇒ no Trusted Publisher yet), then Christian adds the TP so `logger-v*` auto-publishes.
5. Adopt in `apps/discovery` — consumer #1, and the app that currently logs nothing.
6. Add to `scripts/inventory-data.mjs`, redeploy Discovery, tell the fleet.
