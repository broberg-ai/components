# @broberg/logger

Server logging for the broberg.ai fleet. Four levels, one shape, and **a secret
cannot reach the log by accident**.

```bash
npm i @broberg/logger
```

```ts
import { createLogger } from "@broberg/logger";

const log = createLogger({ name: "discovery", pretty: process.env.NODE_ENV !== "production" });

log.info("served", { route: "/api/search", ms: 12 });
log.error(err, { route: "/api/search" });

const reqLog = log.child({ requestId });   // on every line, nests
```

## Why this exists

It is **not** a wrapper around `console.log` — that would be 200 lines of
nothing and you should just use `console`. Two things justify a package:

1. **Redaction by default.** Every message and every metadata value is run
   through [`@broberg/secret-scan`](../secret-scan) before it leaves the
   process. An API key pasted into a debug line, a token in a query string, an
   `authorization` header nested three levels deep in a request dump — none of
   them reach stdout.
2. **One shape across every app**, so a line is searchable regardless of which
   project emitted it.

If a change serves neither, it does not belong here.

### This is not the other two log-shaped packages

| Package | Answers |
|---|---|
| **`@broberg/logger`** | *What was the server doing?* |
| `@broberg/event-log` | *Who did what?* (GDPR audit trail, business events) |
| `@upmetrics/sdk` | *What broke?* (crashes, error grouping) |

## API

`createLogger(options)` → `{ debug, info, warn, error, child, level }`

| Option | Default | |
|---|---|---|
| `name` | – | service name, on every line |
| `level` | `LOG_LEVEL`, else `info` | an explicit option **beats** `LOG_LEVEL` |
| `pretty` | `false` | `false` = one-line JSON, `true` = readable text |
| `redact` | `true` | see the cost below before turning it off |
| `sink` | `console` | where the finished line goes (injectable for tests) |
| `bindings` | `{}` | fields merged into every line |
| `now` | `Date` | injectable clock |

Levels are `debug < info < warn < error`. There is no `trace` or `fatal`: four
is enough, and every extra level is a decision every consumer then has to make.
`warn`/`error` go to stderr, the rest to stdout.

`log.error(err)` serialises an `Error` as `{ name, message, stack }` — never
`{}`. Errors nested in fields are serialised too.

## The cost of redaction — measured, not asserted

Redaction runs ~38 regexes over each serialised line. Run `npm run bench`
yourself; on an M1, 50 000 calls with the sink discarded:

```
redact: false             1.36 µs/call       733,000 calls/s
redact: true (default)    7.79 µs/call       128,000 calls/s

overhead: 6.4 µs/call (≈5.7× the un-redacted path)
```

Read that honestly: redaction is **the dominant cost of a log call**, and it is
still 128 000 lines/second — far more than any app in this fleet produces. Turn
it off with `redact: false` only if you have a measured hot path and have
decided that line cannot carry a credential. The number is here so that is a
decision, not a guess.

## Hono

```ts
import { requestLogger, errorLogger } from "@broberg/logger/hono";

app.use("*", requestLogger(log, { skip: (c) => c.req.path === "/health" }));
app.onError(errorLogger(log));            // <- do not skip this, see below
```

One line per request: `method`, `path`, `status`, `ms`, `requestId`. The level
follows the status (5xx → error, 4xx → warn, else info). A request id is taken
from an incoming `x-request-id` if the caller sent one, otherwise generated, and
is echoed back on the response. The handler gets a request-scoped child logger
on `c.get("log")`, so anything it logs correlates with its request.

> **`requestLogger` alone cannot tell you WHY a 500 happened.** Hono catches a
> throwing handler itself and turns it into a 500 response, so `await next()`
> resolves normally and the exception never reaches the middleware — you get
> `status: 500` and no reason. **Wire `errorLogger` as `app.onError`** to log the
> exception with its stack, correlated by request id. This limitation is
> asserted in the test suite so it cannot be quietly forgotten.

`hono` is an optional peer — only importing `/hono` pulls it in.

## Guarantees

- **It never throws.** A broken sink, a circular reference, an object whose
  `toJSON` throws — all swallowed. This sits in the request path of every app,
  and a logger that crashes the request is strictly worse than no logger,
  because the app worked before you added observability.
- **`pretty: false` emits exactly one line of valid JSON** per call.

## Non-goals

No transports, rotation, buffering, sampling or aggregation. stdout is the
contract; the platform collects it. If you find yourself adding any of those,
this is the wrong package.

---

Plan: [`docs/features/F063-logger.md`](../../docs/features/F063-logger.md)
