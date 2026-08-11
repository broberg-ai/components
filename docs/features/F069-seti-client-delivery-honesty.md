# F069 — seti-client: a timeout is a measurement, not a fact about delivery

> Epic. Written 2026-08-11, in the same turn as the card.

## Motivation

cardmem's framing is the whole plan, and it is worth quoting rather than
paraphrasing:

> *"Timeout'et er en MÅLING, ikke en kendsgerning om levering. Klienten siger
> 'ikke sendt'; det den ved er 'ingen kvittering inden for 8 s'."*

Christian hit this five times in a row on a single message: the client reported
**not sent** for messages that had in fact landed. Collapsing *rejected* and
*unconfirmed* into one `ok: false` invites the user to retry — into an operation
that is not idempotent, so the retry is how you get duplicates.

## What is already done — checked, not assumed

cardmem reported a "hard 8-second cap, not configurable". Read at
`packages/seti-client/src/client.ts` before planning: **that half is already
fixed.**

- `inputTimeoutMs` is a constructor option, default **30000**, and `sendText`
  takes a per-call `timeoutMs`. The three budgets cardmem wanted (30 s send,
  12 s Escape) are already expressible.
- `idleTimeoutMs` (stream watchdog) is a constructor option, default 90000.
- The reconnect counter resets **on established** (`attempt = 0` right after the
  response is OK) — which is the behaviour cardmem themselves judged correct,
  against their own hello-based reset that keeps backoff inflated.

The existing code even carries the reasoning in a comment: *"too short a budget
surfaces a false 'not sent' and provokes user retries — which risk duplicates,
since an abort only ends the CLIENT's wait while the edge may still inject the
message."* The diagnosis was already written down; the **type** was never
changed to match it.

## What is actually missing

**1. The failure type still collapses two different facts.** `input()` catches
everything into `{ ok: false, error: message }`. A timeout, a network drop and a
flat rejection from the edge are indistinguishable to the caller, so a host app
cannot render "delivered", "refused" and "unknown — do not retry blindly"
differently. This is the defect.

**2. Backoff is hardcoded** — `Math.min(1000 * attempt, 5000)`. `idleTimeoutMs`
is a parameter but the backoff step and cap are not. Weaker case than (1), and
scoped as its own story so it cannot quietly expand the first one.

## Scope

- Add a discriminated outcome to `SetiInputResult`: `delivered` | `rejected` |
  `unconfirmed`. `unconfirmed` means the client stopped waiting — the message
  may well have arrived, and a retry may duplicate it.
- `ok` keeps its current meaning (`true` only for `delivered`) so no consumer
  breaks.
- Expose `backoffStepMs` / `backoffCapMs`.

## Non-goals

- Idempotency keys / server-side dedup. That is the real cure for retry-safety
  and it belongs in `@broberg/seti-server`, not here. This epic only stops the
  client from *lying* about what it knows.
- Changing any default budget. 30 s / 90 s stand.

## Note for cardmem, from their own report

Their `decideReconnect()` **is imported by nobody** — the policy still runs
inline in `chat.tsx`, so their test guards a copy rather than the code that
runs. Worth resolving on their side before this package mirrors a policy that is
not the one in production.
