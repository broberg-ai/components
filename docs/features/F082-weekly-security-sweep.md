# F082 — the weekly security sweep

**Status:** Backlog · **Written:** 2026-09-03 · **Owner ask:** Christian, this
afternoon — *"ja tak til en plan for et fast ugentligt review af de pakker der
har ændret sig siden sidste security review."*

## Motivation

Both security holes found today were **months old**:

- a brand colour could inject a phishing anchor into a transactional mail — seven
  interpolation sites, no escaping anywhere
- `fill()`, the function that puts a customer's own name into a mail, did not
  escape

Neither would have been caught by the tooling we have. **Both `/security-review`
variants read a DIFF**, and the built-in one explicitly declines to comment on
what is already in the tree. Pointed at a clean `main`, they find nothing —
correctly, and forever.

### The framing that makes this tractable

**"Changed since its last security review" is itself a diff.** The tool that
cannot audit 27,307 standing lines can review a week of change perfectly well.
So the missing piece is not a different reviewer. It is a **ledger** that records
where each package was last looked at.

That single move converts an impossible one-off audit into a bounded weekly job
— and it converts the 39-package backlog into a *queue* rather than a wall.

## Measured, 2026-09-03

```
39 packages · 27,307 source lines (src/*.ts, tests excluded)

20 of 39 had source changes in the last 30 days
19 had NONE

churn is concentrated:  sms 37 file-touches · chat 26 · bodymap 26
                        lens-engine 25 · webpush 15 · mail 15 · secret-scan 14
                        then a long tail of 2-9
```

**A steady-state weekly sweep therefore looks at roughly 5-10 packages, not 39.**
That is what makes "weekly" an honest cadence instead of an aspiration, and it is
why the number is here rather than a guess about it.

### Risk surface — how the backlog is ordered

Counting files that touch network, crypto, `exec`, `process.env` or credential
material:

```
mcp 7/19 · sms 7/11 · lens-engine 5/11 · seti-client 3/5 · mail 3/4
lens-client 3/4 · apikey 2/6 · lens 2/4 · media 2/3 · deploy-core 2/3
logger 2/2 · chat 2/10 · auth 1/8 · forms-turnstile 1/6 · device-stats 1/5
stripe 1/3 · cron 1/2 · seti-server 1/1
```

Size alone would put `sms` and `chat` first and `logger` near the bottom;
`logger` is 2 of 2 files touching that material. **Order by surface, not by
lines.**

## Design

### 1. The ledger — `security-review-ledger.json`

One entry per package, committed to the repo:

```json
"@broberg/auth": {
  "reviewed_at_commit": "26ae5df",
  "reviewed_at": "2026-09-03T15:44:00Z",
  "version": "0.4.1",
  "files_read": 8,
  "lines_read": 660,
  "findings": 0,
  "card": null
}
```

`files_read` / `lines_read` are load-bearing, not decoration: **a review that read
nothing must be visible as a review that read nothing.** A timestamp alone cannot
tell a look from a skip — that is exactly the shape this whole epic exists to
close.

### 2. `scripts/security-sweep.mjs --plan`

Answers *what changed since its own last review*, per package:

- diff `packages/<p>/src/**` between `reviewed_at_commit` and `HEAD`
- **and** `packages/<p>/package.json` **dependencies** — a supply-chain change is
  a security change even when our own source is untouched
- **not** README, version bumps or tests — those move constantly and would make
  every package "changed" every week, which is how a signal dies
- a package with no ledger entry counts as **never reviewed**, and its "diff" is
  its whole source

### 3. The sweep itself — `/security-sweep`

Per package in the plan:

1. **Secret pre-scan** with `@broberg/secret-scan` (ours, already the fleet's
   curated pattern set) over the range.
2. **`npm audit`** on the package — one command, and for 39 *published* packages
   the dependency chain is the likeliest real-world attack path. Recorded, not
   chased.
3. **OWASP-class read** of the changed source, same classes as
   `.claude/skills/security-review.md`.
4. **Findings → cardmem cards.** A finding that lives only in a report nobody
   opens is the same as no finding.
5. **Write the ledger entry** — including when the answer is "nothing found", with
   the range and the volume read, so a later reader can tell a real look from a
   skipped one.

### 4. The weekly clock

`cronjobs.webhouse.net` (durable, survives a sleeping Mac) → buddy `schedule_job`
→ an intercom directive to this session, same chain the daily inbox sweep uses.
Never a `setInterval` or a local crontab.

### 5. Draining the backlog

Nothing has ever had a security review, so the first runs are backlog, not delta.
**Budget: 6 packages per run, risk-order first** → the first full pass takes ~7
weeks, after which the weekly job is only what actually changed.

The budget is the honest part. Marking 39 packages "reviewed" in one sitting
would produce a ledger that *says* the fleet is audited, and that is worse than
an empty one — it closes the question.

## The failure mode this must not become

**Not "we miss a vulnerability" — "the sweep becomes a rubber stamp."** Guards:

- the ledger records **range + volume read**, so a zero-read review is legible
- a package may **never** be marked reviewed without a recorded verdict in the
  same run — no partial credit, no "assumed clean"
- a `reviewed_at_commit` that is not an ancestor of `HEAD` is an **error**, not a
  shrug — a rewritten or fabricated ledger entry must fail loudly
- `@broberg/greppable` asserts every tracked file was actually readable: a file a
  grep cannot read is a silently unscanned file, and their own measurement stands
  — *a green check that never looked is worse than no check, because it closes
  the question*

## Non-goals

- **Not a replacement for the per-card auto-review gate.** That one catches new
  work as it lands; this catches what accumulated, and what a card-sized diff
  review could not see in isolation.
- **Not a CVE feed or a scanner product.** `npm audit` is recorded; chasing
  advisories is separate work.
- **Not the consumer repos.** This epic covers the 39 packages `components` owns.
  Each repo owns its own application code — pushing this outward is a later,
  separate proposal, and per the fleet rule that is Christian's call, not a
  broadcast.
- **No metered API.** $0 and local, same rule as the auto-review gate.

## Reuse

Discovery checked (`/api/search`): `security review`, `audit`,
`vulnerability scan`, `dependency audit`, `npm audit`. No package does periodic
review-with-a-ledger — but two of ours are direct components of it, and using
them is the point rather than a courtesy:

- **`@broberg/secret-scan`** — the secret pre-scan step. It is already the
  fleet's curated, ordered pattern set; re-grepping for `AKIA...` by hand in a
  new script is precisely the drift the inventory exists to stop. Note its own
  decision register entry: value-only classification is opt-in, so the sweep must
  **not** pass `valueOnly` and then report length-based guesses as findings.
- **`@broberg/greppable`** — the coverage assertion. Its thesis *is* this epic's
  failure mode, one level down: a run that read nothing reported clean.

Nothing new is published by this epic; it is repo tooling plus a skill.
