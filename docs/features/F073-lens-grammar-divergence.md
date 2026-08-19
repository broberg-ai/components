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

## The verdict table — settled, 15/15

Measured by cardmem against the daemon's implementation and this engine's
`targetSchema`, then closed verb by verb. **The hypothesis above was right, and
by more than it predicted:** the ask is two verbs, not fifteen.

| verdict | verbs | runs |
|---|---|---:|
| **ALIAS** — the engine already expresses it | `clickSelector` `fillSelector` `clear` `uploadFile` | 256 |
| **GAP** — genuinely missing | `waitForUrl` `expectAbsent` `check` `uncheck` | 248 |
| **DAEMON-ONLY** — do not port | `inspect` `autocomplete` `capture` `drag` `loop` `conditional` `waitForBuild` | 13 |

### `check` / `uncheck` moved ALIAS → GAP when they were finally RUN

The table above stood as *settled, 15/15* for a day on reasoning alone. Two rows
were wrong, and only executing them found it. cardmem ran every ALIAS verdict
against a real browser, with two checkboxes in **opposite** starting states and a
fresh page load per case:

```
verb            scenario                                  action  assert  verdict
clickSelector   button, one press                         ok      ok      ALIAS
fillSelector    text field ← "x"                          ok      ok      ALIAS
clear           text field ← "" (was "preset")            ok      ok      ALIAS
check           box was OFF  → expect ON                  ok      ok      ALIAS
check           box ALREADY ON → expect still ON          ok      FAIL    GAP
uncheck         box was ON   → expect OFF                 ok      ok      ALIAS
uncheck         box ALREADY OFF → expect still OFF        ok      FAIL    GAP
uploadFile      file input ← pixel.gif                    ok      ok      ALIAS
```

**The finding is in the `action` column, not the `assert` column: it says `ok` in
both failing rows.** The click SUCCEEDED. Only the assertion caught that the
resulting state was inverted — so without AC#2's demand that an ALIAS be proven by
*the resulting state* rather than by the step returning ok, both rows would have
read green and `check` would have shipped as an alias that silently inverts a
checkbox.

`click` toggles; it cannot assert a resulting state. That is the whole difference
between a real verdict and a plausible one here.

**Scope, and cardmem's reading is adopted:** these are gaps only in the
*idempotent* case — a caller who KNOWS the current state can use `click`. But that
is precisely the fragility. The caller rarely knows, and the price of being wrong
is a **green run with the wrong state**. So the answer is to implement real
`.check()` / `.uncheck()`, not to document a rule about when `click` suffices.

**The instrument is proven to discriminate:** the same two elements assert GREEN in
the other direction (rows 4 and 6, same `chk-on`/`chk-off`), so a red cell is not
a cell that is always red.

`clear` as `fill` with an empty string round-trips correctly, and the field held
`"preset"` first — so it is not an empty-against-empty false green.

*(Figures are runs-carrying-that-verb and total 517 across 419 affected runs — a
single run may carry several. The original acceptance criterion asked them to sum
to 419, which was the wrong unit and my error, not the audit's. The 16
`check`/`uncheck` runs moved from ALIAS to GAP when they were executed, which is
why the first two rows differ from the version published a day earlier.)*

`targetSchema` is `string | LocateSpec`, and a bare string is taken as a CSS
selector — so `{action:'click', target:'#save'}` **is** `clickSelector`. That one
fact answers 203 runs.

The two real gaps, with the closest existing step and why it falls short:

- **`waitForUrl` (126)** — `waitFor{target,ms}` can address an element or a
  duration. There is no way to say *the page navigated to X*, which is how every
  login proves it landed.
- **`expectAbsent` (106)** — `expectVisible` has no negative, and this is not a
  negation: it must **wait for** absence. Expressible via `assert{js}`, but that
  is an escape hatch rather than a verb, and it loses the failure message.

### Two findings from the audit that outlived it

**The 15th verb had no verdict, and nobody noticed.** The first table returned 14
of 15 — `waitForBuild` simply fell out. It surfaced only by diffing the audit
against the verb list it was answering, which is why the acceptance criterion
demands a verdict for *every* item rather than a convincing summary. A list that
quietly shrinks is how the original defect shipped.

**Judging it separately changed the answer.** `waitForBuild` (a step) and
`wait_for_build` (a body key) are one underscore apart and got **opposite**
verdicts. They are different mechanisms wearing the same word: the body key gates
the whole run before step 0 (6 real calls), the step is that same poll placed
mid-flow (0 calls). Measured, the step takes a URL string and a `fetchImpl` — no
`Page`, no browser anywhere — and polls an app's health endpoint for a build
marker on a 180s deploy-scale timeout. So the honest conclusion is that **neither
belongs in the engine**, and only one belongs in cardmem's `.extend()`. Judged
together, one of the two would have been wrong.

### Case-sensitivity: the hazard does not exist

An earlier report held that the daemon accepts both `clickselector` and
`clickSelector`, which would have forced any alias map to normalise. Re-measured,
it does not: the lowercase forms live only in the **prose manuscript parser**,
which lowercases before matching and returns camelCase, so everything downstream
is camelCase-only. **An alias map can assume one spelling per verb.**

Worth recording *how* the wrong claim was produced, because it is the third
variant of one failure in a single day: `grep -oE "case '[a-zA-Z]+'"` over one
file, sorted unique, two spellings read as *accepts both*. The grep could not see
that the hits sat in different functions at different layers — a parser and an
executor. The first two variants were the wrong **file** and the wrong
**question**; this one was the right file at the wrong **resolution**.

## F073.2 — `check` / `uncheck` shipped (0.9.0)

Real `locator.check()` / `locator.uncheck()`, idempotent and state-asserting.
Never a `click` underneath, and **no fallback to one** — falling back is the
defect, not the repair: the action reports ok and the box ends up in the opposite
state, which is precisely what the ALIAS measurement caught.

A non-checkable target throws, and the message names the element it actually
found (`<label data-testid="agree">`) rather than only Playwright's rule. That is
the difference between a one-line fix and a hunt through the DOM.

**The migration hazard, measured rather than warned about.** The daemon executes
`check` as a plain testid CLICK, which works on a `<label>`, a wrapper `<div>`, a
`<span>`. `locator.check()` does not. cardmem resolved all 28 of their recorded
calls against the source:

```
23  agree                     <input type="checkbox" data-testid="agree">   inside a <label>
 1  idea-select               <input type="checkbox">
 1  settings-auto-wakeup-on   <input type="radio">                          inside a <label>
 1  settings-auto-wakeup-off  <input type="radio">                          inside a <label>
 2  check-terms · «bekræft brand-only»   storeform / contentpush — not theirs to resolve
───
26 of 28 point at a real input. The trap exists; they are mostly not in it.
```

The four they could see all sit **inside** a `<label>` with the testid on the
input, which is the arrangement that migrates cleanly. Had the testid been on the
`<label>`, the click would have worked and `.check()` would throw — so the two
unresolved calls will announce themselves, loudly, which is the agreed direction.

**Worth recording about how that number arrived.** Their first answer was 23 of
28 with the rest "not resolvable from here". Their own correction an hour later:
that was true about how far they had looked, not about what was possible — three
of the four missing ones were in their own code and took five minutes.

**The compiler is now the seal on this epic's central non-goal.** Adding a member
to `flowStepSchema` with no `case` in `runStep` fails `tsc`
(`TS2366: Function lacks ending return statement`), proven by adding a `scroll`
verb and watching it go red. So "implementation first, enum second" is enforced by
the build rather than by remembering the rule.

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

1. **F073.1 — audit.** ~~Decide alias / gap / decline for each of the 15 verbs.~~
   **Done, 15/15** — see the verdict table above. The corpus half is measured:
   every `clickSelector`/`fillSelector` argument the fleet has ever sent (224
   calls, 115 unique selectors) run through this engine's own `resolveSelector`,
   114 unchanged. **Still open:** the runnable equivalents — an ALIAS verdict
   executed in a real browser rather than derived from a type signature — which
   is blocked on `apps/lens-cloud` being bumped off 0.6.1.
2. Implement the **four** genuine gaps in the engine: **`waitForUrl`**,
   **`expectAbsent`**, **`check`** and **`uncheck`**. The last two were ALIAS on
   reasoning and GAP on measurement — see above. `check`/`uncheck` must be real
   `locator.check()` / `.uncheck()` (idempotent, asserting), not a `click`.

   **`expectAbsent` must NOT inherit F071.4's patient resolve**, or proving a thing
   is gone will always cost the full timeout. It needs the snapshot semantics
   deliberately. cardmem carry the identical trap in their own `expectAbsent`
   (their F213.9), so the rule holds for both runners.
3. Alias map in `@broberg/lens-client`, **camelCase only** — the case hazard was
   re-measured and does not exist (see above), so the map does not need to
   normalise. Note that lens-client holds a THIRD hand-written copy of the step
   union and is already behind: it is missing `expectEditable`, shipped in
   engine v0.4.0. Fixing the copy without sealing it just resets the clock.
4. Only then extend `flowStepSchema`, one verb per implemented `case` — never a
   verb ahead of its implementation, which is the non-goal above and the reason
   this epic exists at all.
5. Publish, and tell cardmem the migration is real with the verb table attached.

One migration hazard that belongs to neither the verbs nor the schema: a target
string that is a bare tag name (`body`, `main`, `form`, `h1`) is silently
rewritten to a `data-testid` selector and matches nothing. Filed as **F071.2**;
it is the 115th of the 115 selectors above, and it will bite exactly one flow in
the corpus on migration day unless it lands first.
