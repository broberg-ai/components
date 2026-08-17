# F073 — Two Lens grammars, and the fleet is pointed at the smaller one

**Status:** planned · **Found by:** cardmem, while measuring F071.1's blast radius · **Owner:** components

## Motivation

I asked cardmem to price a breaking change. They came back with a STOP and a
number: `.strict()` as specified would reject **17% of every flow this fleet has
ever run**. That turned out not to be true of the change I was making — and
finding out why surfaced something larger than the change itself.

**Verified here before accepting any of it.** All 15 verbs they named are already
rejected by `@broberg/lens-engine` today, by the discriminated union, before
`.strict()` and before anything else I touched:

```
clickSelector   accepted: false  | Invalid discriminator value. Expected 'goto'|'click'|'fill'|…
fillSelector    accepted: false  | same
waitForUrl      accepted: false  | same
expectAbsent    accepted: false  | same
check           accepted: false  | same
uploadFile      accepted: false  | same
inspect         accepted: false  | same
click           accepted: true
```

And `grep "case '" src/flow.ts` returns exactly 13 cases — the 13 in the schema.
So those 419 runs never passed through `flowStepSchema`. They ran on the
**daemon's** runner, which has its own grammar. Two grammars, not one.

**Which is the finding.** The engine is the path we advertise to every repo, via
`@broberg/lens-client`. A repo asked to migrate off the daemon today loses 15
verbs, and 17% of the fleet's existing flows would need rewriting first.

## What was measured, and by whom

cardmem's, over 2447 stored flow runs in the daemon's `agent.db`:

| verb | runs | | verb | runs |
|---|---:|---|---|---:|
| `clickSelector` | 203 | | `uploadFile` | 21 |
| `waitForUrl` | 126 | | `check` | 16 |
| `expectAbsent` | 106 | | `inspect` | 11 |
| `fillSelector` | 31 | | `clear`/`autocomplete`/`capture` | 1 each |

Affected projects: cardmem 131 · fd-sundhed 94 · xrt81 47 · sanneandersen 42 ·
cms 28 · broberg-ai-site 17 · how 14 · broberg-ai 13 · contentpush 13 ·
autodoc 8 · pitch 5 · torrent-search-api 4 · trail/storeform/cronjobs 1 each.

Implemented in the daemon with 0 runs so far: `conditional`, `drag`, `loop`,
`uncheck`, `waitForBuild`.

**Attribution matters here.** The counts, the breakdown and the verb list are
theirs. What I verified is only that the verbs are absent from the engine and
already rejected by it. Their two caveats are kept because they cut in different
directions: `flow-store.ts` persists the *result*, never the request, so
body-level keys are **unmeasured — unknown, not clean**; and they checked each
recorded action against a real `case` before quoting it, so the names are
requests rather than engine renames.

## The hypothesis that makes this cheap — test it before building anything

**Most of the top counts look like naming, not capability.**

The engine's `targetSchema` is `string | LocateSpec`, and a plain string is
taken as a CSS selector. So `{action:'click', target:'#save'}` *is*
`clickSelector`. That is 203 runs answered by an alias, not by new code. The
same argument covers `fillSelector` (31), very likely `uploadFile` (21 — the
engine calls it `upload`) and `inspect` (11 — the engine has `read`/`extract`).

If it holds, **~266 of 419 runs are an alias map in `@broberg/lens-client`**,
not engine work.

The residue that looks like a genuine gap:

- **`waitForUrl` (126)** — the engine's `waitFor` takes a target or a duration.
  There is no URL predicate. This is how a login proves it landed.
- **`expectAbsent` (106)** — `expectVisible` has no negative. Asserting a thing
  is *gone* is not expressible.
- **`check` / `uncheck` (16)** — idempotent toggles. `click` flips; it cannot
  assert a resulting state.
- **`drag` / `conditional` / `loop` (0 runs)** — real machinery, no demand yet.

## Non-goals

- **Completing the enum.** cardmem asked for exactly this — *"I would rather you
  just complete the list, since the reject is correct behaviour and only the enum
  is wrong"* — and it is the single move to refuse. Adding `clickSelector` to
  `flowStepSchema` when `execStep` has no `case 'clickSelector'` makes the schema
  say yes to a verb the engine does not run. That is F071's defect moved one
  layer down, shipped by the story that exists to close it. Implementation first,
  enum second, always.
- **Collapsing the two runners.** The daemon owning its own grammar is not itself
  a bug. The bug is that we recommend the smaller one without saying so.
- **Anything on the daemon side.** That is cardmem's repo and cardmem's call.

## Rollout

1. **F073.1 — audit**: for each of the 15 verbs, decide alias / gap / decline,
   with the engine equivalent written down where one exists. Confirm the
   alias hypothesis with cardmem against their real request bodies before any
   code.
2. Implement the genuine gaps in the engine, highest count first
   (`waitForUrl`, `expectAbsent`, `check`/`uncheck`).
3. Alias map in `@broberg/lens-client`, case-insensitive — cardmem reports the
   daemon accepts both `clickselector` and `clickSelector`, so a case-sensitive
   map would miss half the corpus.
4. Only then extend `flowStepSchema`, one verb per implemented case.
5. Publish, and tell cardmem the migration is real with the verb table attached.
