# @broberg/chat

The fleet's AI-chat core. A conversation loop with a tool registry, streaming
typed frames — framework-free, storage-free, and with **zero dependencies**.

```bash
npm i @broberg/chat
```

## The line this package exists to make unwritable

The `cms` session measured this in their own 64-tool chat:

```js
tools.filter(t => !t.permission || hasPermission(user, t.permission))
```

`!t.permission ||` — **a tool that declared no permission passed.** 60 of their
64 declared none, so a read-only user was handed **61 tools, 30 of them
mutating**.

It reads exactly like a permission check. It *is* one, for the four tools that
declared something. For the rest the default pointed the wrong way.

So `permission` is **required**, enforced twice — the type rejects a literal
without it, and `defineTool()` throws, because a registry built at runtime has
no compiler.

```ts
import { defineTool, createChat } from "@broberg/chat";

const lookup = defineTool({
  name: "roster_lookup",
  description: "Look up one employee across roster, users and audit-log",
  permission: "roster.read",          // required. no default. no fallback.
  parameters: { type: "object", properties: { email: { type: "string" } } },
  run: (args, ctx) => ctx.api.get(`/admin/roster/${args.email}`),
});
```

## A tool that can act must not decide whether it may

sanne's rule, and the reason acting is safe at all. Their `book_appointment`
calls an endpoint that answers `consent_required` — proven with raw calls
bypassing the UI.

The core enforces the structural half: **a tool's `run()` receives only the
`ctx` you passed in.** It is never handed a database, an engine or a client, so
*your* routes stay the authorization boundary. That is precisely why cms's
defect could exist — their tools called the engine directly and skipped every
HTTP permission gate.

## A permission must not be born in the chat layer

**cms measured this on 2026-08-28, and it is the sibling of the rule above.**

Their owner decided a viewer must not see form submissions. The obvious change is
to deny the three `forms.read` tools — one permission, three tools, done. So they
checked what else read that data, and found four doors the chat never touched:

| door | what it actually asked |
|---|---|
| the submissions list | *is someone logged in* |
| a single submission | **nothing at all** — it relied on a proxy guarding `/api/admin/*`, which answers *authenticated*, not *permitted* |
| CSV export | *is someone logged in* — and that is the **whole dataset in one file**, not a preview |
| the `/admin/forms` page | whether the FEATURE was enabled for the tenant, never whether this person may see it |

Had they changed only the tool permission, the chat would have refused while the
page beside it served the same names, and the export served all of them at once.

> **A permission enforced only in the chat is not a permission. It is a chat
> setting.**

`can(permission, caller)` should therefore be a *reader* of authorization your app
already has, never the place it is first decided. If a permission string exists
only because a `ChatTool` declared it, every other route in your product is still
open — and the chat's refusal will make it look closed.

**Before you register a tool, ask what else reaches the same data.** Every answer
that is not "the same permission" is a door.

## Permission is asked per caller, not matched against a list

```ts
const chat = createChat({
  model,                               // injected — see below
  tools: [lookup, invite],
  can: async (permission, caller) =>
    !caller.accessRevokedAt && (await grants(caller)).includes(permission),
});
```

`can` is **required** whenever tools are registered. There is no permissive
default — "everyone may use everything" is the same mistake as `!t.permission ||`
moved one level up: it looks like configuration and behaves like an open door.

**Async because a real answer is a lookup, not a list.** fd-sundhed measured
why: their role is not the gate on its own — `access_revoked_at` sits beside it,
and an admin whose access had been revoked walked in until a guard checked both.

**A denied tool is invisible, not refused.** It is never offered to the model, so
it cannot be proposed — and the name is refused again at execution if it arrives
anyway. Two gates, because in cms's case the filter was the only one.

## The model is injected, never imported

```ts
const model: ModelFn = async function* ({ system, messages, tools }) {
  // call @broberg/ai-sdk here — the fleet chokepoint for cost + provider policy
};
```

Two reasons, and the second was bought the day this shipped:

1. The core is testable against a fake model — a full tool round with no key and
   no network.
2. **It carries no version pin.** `@broberg/logger` promised it *"cannot leak a
   secret"* while pinned to a `secret-scan` four minors stale, because a caret on
   `0.x` locks the minor. As buddy put it: *a package cannot know its promise has
   become untrue because of something underneath it.* This one has nothing
   underneath it.

## Streaming from the first version

```ts
for await (const frame of chat.run({ messages, caller, ctx })) {
  // "text" · "tool-call" · "tool-result" · "error" · "done"
}
```

Not an enhancement. trail measured **13.1 seconds** average response — on the
*fastest* tier. A non-streaming core would have to be rewritten rather than
extended.

`done` carries a reason: `complete`, or `max-rounds` when the loop was cut off
mid-work. A caller that cannot tell those apart reports a truncated answer as a
finished one.

**A broken tool degrades the answer, never the conversation.** A tool that throws
or rejects produces an error frame the model can see and recover from, and the
stream still reaches `done`.

## "I cannot look that up" is not "no"

The sharpest failure in the whole survey, and the reason the core owns a small
prompt fragment:

> Christian asked Eir whether Sanne sells anything. **Eir said no** — confidently
> — because the shop tool was missing.

The model was not confused. It was blind and sounded certain, and a missing
capability became a false statement about a business. `corePrompt()` makes the
honest answer reachable; everything else in the prompt is yours.

## The bot is called Aidan

One value, one place. Override it for a whole site with a single environment
variable:

```
CHAT_BOT_NAME=Eir
```

A test asserts the literal appears in exactly one source file — a name repeated
across files is a name that drifts the first time one copy is edited.

## Mounting it — Stack A and Stack B

```ts
// app/api/admin/chat/route.ts          — Next.js App Router
import { createChatRoute } from "@broberg/chat/next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";   // never cached, never prerendered

export const POST = createChatRoute({
  chat,                                              // createChat(), model injected
  getCaller: async (req) => await readProfile(req),  // YOUR existing pattern
  getCtx:    async (req, caller) => ({ api: apiFor(caller) }),
});
```

```ts
// Hono (Bun/edge)
import { chatHandler } from "@broberg/chat/hono";
app.post("/api/chat", chatHandler({ chat, getCaller, getCtx }));
```

```ts
// the browser — framework-free, no dependency
const res = await fetch("/api/admin/chat", { method: "POST", body: JSON.stringify({ messages }), signal });
for await (const frame of readChatStream(res)) { … }
```

Both adapters are the **same code** over web-standard `Request`/`Response`, driven
by one shared table of test cases. *Fix one half of a pair* is a measured fleet
defect, so a behaviour that holds in Next and not in Hono is a red test rather
than a production discovery. `@broberg/chat/http` is that shared half, exported
for anything else — `Bun.serve`, Workers, Deno.

**Still no dependency, still no version pin.** No subpath imports `@broberg/ai-sdk`;
the model stays injected. A caret on `0.x` locks the MINOR, so a subpath that
depended on another `@broberg` package would hand consumers a version they never
chose — which is exactly how `@broberg/logger` shipped a promise it no longer kept.

### `getCaller` is required, and `null` is a 401

Not an empty tool list. An unauthenticated request that still reaches the model
is still an LLM bill, on a surface where the stranger decides the volume — and on
an internal admin chat it is simply the wrong answer. A test asserts the model
records **zero** calls.

The caller is resolved **server-side, per request**, and can never arrive in the
request body. Every message is rebuilt from the three fields we know, so a role
or permission smuggled onto one is dropped rather than carried.

## Knowledge comes from Trail, as a tool

```ts
import { trailRetriever } from "@broberg/chat/trail";

const knowledge = trailRetriever({
  baseUrl: "https://app.trailmem.com",   // ← see the two-host trap below
  kbId: "fd-sundhed-admin",              // CONFIG. Never an argument the model supplies.
  tenant: "fd-sundhed",                  // required on the app route
  token: process.env.TRAIL_API_KEY!,
  permission: "knowledge.read",
  fetch,                                 // injected — every state below is testable with no network
});
```

> ### ⚠️ Two hosts, and one key does not fit both
>
> Measured by trail on a live call — and they fell into it themselves while
> answering us:
>
> | | |
> |---|---|
> | `app.trailmem.com` | the admin proxy. **App key + `X-Trail-Tenant`.** It resolves the tenant and forwards with the tenant's own bearer. **Use this unless someone handed you a tenant key.** |
> | `engine.trailmem.com` | wants the **tenant** key directly. sanne call this one because they were given that key. |
>
> The same key returns **200** on the first and **401 `"Invalid or revoked API key"`** on the second. The error blames the key. That is why `unauthorized` is its own
> `reason` here rather than a generic `http_error` — otherwise you rotate a
> credential that was never the problem.

**Christian, 2026-08-27:** *"ALLE CHATS SKAL anvende trail — det er IKKE til diskussion."*
So this is the fleet's one knowledge path, which means a defect here is a defect
in every chat at once. Three properties follow from that.

### 1. Three outcomes, never two

```ts
{ status: "hit",         passages, freshness, truncated? }
{ status: "empty",       freshness, note }
{ status: "unavailable", reason, note }     // ← no passages field at all
```

**A typed result, not a string, and this is the whole point.** sanne's tool
*does* distinguish four failures — and their prompt merges them again:
*"# Hvis trail_retrieve returnerer ingenting **eller fejler**"*, one branch,
telling the model to answer from its own general training knowledge and never to
say it cannot answer. So when Trail is down, a zone-therapy clinic's assistant
answers **health** questions from generic training knowledge, in the
practitioner's voice, and nobody can see the knowledge base was never asked.

That is the Eir shop incident one storey down. **A prompt cannot merge two states
it receives as different values** — so `unavailable` is a different value, and its
instruction is the opposite one: *do not answer from your own general knowledge.*

Errors never travel in the content channel either: `unavailable` carries a short
machine reason, never the provider's body. A model handed `[error] HTTP 500 …`
reads an error message as knowledge.

### 2. The knowledge base is configuration, never an argument

`kbId` **and `tenant`** do not appear in the schema the model sees, and either
arriving in the model's arguments is *ignored*. If they were arguments, a model
could be talked into another tenant's knowledge — and fd-sundhed alone is getting
two knowledge bases, written for readers with different rights.

**And this lock is currently the only one.** trail measured that an app key can be
scoped to several tenants, with `X-Trail-Tenant` choosing between them. A partner
scope bound to a single knowledge base is carded at trail (their F205.1) and **not
built** — so until it is, the configuration here is the real barrier, not theirs.

### 3. Freshness — the oldest date, and what is undated counted separately

Trail ships `updatedAt` per passage (their F213.1, live 2026-08-27): **ISO-8601 UTC
with Z, or nothing.** Two decisions in how we use it:

**The OLDEST date, not the newest.** An answer is only as current as its stalest
source — if it rests on three passages and one is from April, part of the answer
*is* from April. Reporting the newest would flatter it.

**`unknown` is counted separately, never folded into the date.** Some passages
may carry a date and others none; saying only *"as of June"* would hide that the
rest is undated. Three states, not two:

```ts
{ oldestUpdatedAt: "2026-04-16T16:31:49.278Z", unknown: 0, note: "…last updated … at the oldest" }
{ oldestUpdatedAt: "2026-06-01T10:00:00.000Z", unknown: 2, note: "…and 2 passage(s) carry no date at all" }
{ oldestUpdatedAt: null,                       unknown: 2, note: "None of this knowledge carries a date" }
```

**Only ISO-8601 UTC with Z is accepted; anything else is UNKNOWN.** Trail's own
column holds `2026-06-22 12:07:09` beside `2026-04-16T16:31:49.278Z` — **both
UTC, only one saying so** — and they normalise server-side. Should that ever
regress, a bare `2026-06-22 12:07:09` reaching us would be read by `Date` as
*local* time and become a confidently wrong date two hours out. Refusing it
degrades to "unknown" instead: **a wrong date is worse than none.**

> ⚠️ **If you build on this, pin a non-UTC timezone in your test — and assert the
> pin took effect.** `bun test` defaults to `TZ=UTC` and CI containers are UTC,
> and under UTC local time and UTC coincide, so **this entire class of defect
> does not exist there.** trail's own first test was green against the naive
> implementation for exactly that reason. Test summer *and* winter, or `+1` and
> `+2` both pass on a single offset.

There is also **our own ceiling** on top of Trail's `maxChars`/`topK`, and what
it dropped is reported. sanne cap nothing client-side, so the day Trail stops
honouring `maxChars` they have none at all.

> **Not live-verified.** Every state above is proven against a recorded response
> measured from production, with `fetch` injected. No call has been made against
> a real Trail from this package — a Trail tenant exists only after a human
> Google login, so the first live run waits on that.
>
> **Set your own timeout, and mean the `unavailable` branch.** trail have no rate
> limit on retrieve, and they volunteered why the third state matters: their
> engine was down for ~75 minutes the evening this shipped, 502 to its own health
> endpoint — a full volume, no successful deploy since 23 August, and a process
> that had not restarted since 4 July, so nothing ever noticed. Their words:
> *our uptime does not carry the assumption that we always answer.*

## Two boundaries worth knowing before you ship

**1. The transcript is client-supplied.** A caller can forge their *own* history,
including a `tool` message. Anything that matters must come from a tool call in
**this** turn, never from history — the same rule as *a tool that can act must not
decide whether it may*.

**2. A tool RESULT is passed through verbatim, secrets and all.** Not an oversight:
it is the consumer's data on their own surface, and quietly rewriting it would be
a worse surprise than passing it on. If a tool can return a credential, either do
not return it or wait for redaction (F079.6). A test pins this boundary so nobody
can believe otherwise.

What the adapter itself puts on the wire is guaranteed: no `ctx`, no permission
string, no stack trace. Asserted by scanning the emitted bytes.

## An overflowing conversation must not become a dead one

```ts
const chat = createChat({ model, history: "standard" });   // a named profile
```

…or the full object, when you want the numbers yourself:

```ts
const chat = createChat({
  model,
  history: {
    strategy: "window",        // or "compact" — REQUIRED, there is no default
    maxInputTokens: 120_000,   // REQUIRED, and declared by YOU (see below)
    keepRecent: 6,
    // strategy: "compact" also needs:
    // summarise: async (older) => (await ai.chat({ prompt: `Summarise: …` })).text,
  },
});
```

### It is one product question, not two numeric fields

`{ strategy, maxInputTokens }` asks in a unit nobody decides in. The question a
person actually answers is:

> *What happens when the conversation gets too long — and how long may it get?*

That has a different answer for someone authoring content for hours than for a
visitor asking three questions. **cms put it to Christian in these words and he
answered in two seconds; it could not have been asked in tokens.** So the
translation lives here, once, instead of in every consumer:

| you say | what happens when it runs long | what it costs |
|---|---|---|
| `"visitor-qa"` | **forget the oldest** — a stranger asks a handful of questions and leaves | free and instant |
| `"standard"` | **forget the oldest** | free and instant, **but see the warning below** |
| `"long-authoring"` | **summarise the oldest**, so the thread survives | one extra model call each time it fires — you supply `summarise` |
| *(omit `history`)* | **no limit** — a choice, not the absence of one | the dead conversation above. See below. |

**⚠️ "Forget the oldest" usually drops the user's opening instruction.** Tone,
language, role, "answer in Danish, and always mention the free consultation" —
that is turn one, so it is the first thing to go. The conversation then carries
on without it **and everything looks entirely normal.** If the opening
instruction matters, either put it in your `systemPrompt` (which is never
dropped) or use `"long-authoring"` so it is summarised rather than lost.

**⚠️ Omitting `history` is "no limit", and it is a choice with a name.** It is
what every consumer has today if they skip the field, and the consequence is the
whole reason this module exists: the conversation does not get expensive, it
**dies**, and a retry resends the same oversized payload for ever.

The numbers behind the profiles (`HISTORY_PROFILES`) are ours, **derived and not
measured** — chosen to sit comfortably inside a 128k context even with a large
tool set. They are a safe floor to start from, not the most your model can take.
Steer one without leaving it:

```ts
import { resolveHistoryProfile } from "@broberg/chat/history";
const config = resolveHistoryProfile("long-authoring", { summarise, maxInputTokens: 96_000 });
```

An unknown profile name **throws**, naming the valid ones. It never falls back to
a default — that would be us making a silent decision about your bill, and about
which of your user's turns survive, on the strength of a typo.

**The defect this exists for, measured by cms in their own chat:** nothing
truncates, so the client sends the whole conversation every message; the route's
`maxTokens` is the **output** limit; the provider 400s and the raw error reaches
the user. And the part that makes it serious:

> **Because nothing truncates, a retry resends the same oversized payload.** The
> conversation is not expensive, it is **dead** — from the moment it tips, after
> a long session, which is exactly when there is most to lose.

So the test that matters is not *"the message got shorter"*. It is **the next
turn on the same conversation succeeds.**

### Choosing `maxInputTokens` — three things that decide it, and none is the model's spec sheet

We do **not** have a measured number for you, and the field is required precisely
because there is no safe default. But three things decide yours, and a consumer
should not have to discover them one at a time:

**1. The ceiling is not the model's context window.** It is the window MINUS your
system prompt, MINUS your tool schemas, MINUS room for the answer. The tool
schemas are the part people forget, and they are sent on **every** call.

> **Measured by cms, 2026-08-28, over their 64 tools:** names 967 chars,
> descriptions 8,543, input schemas 18,756 — **28,266 characters: ≈7,100 tokens
> at our default rate, ≈8,300 at the Danish rate they measured** (below), before
> the conversation starts. Two thirds of it is JSON schema, not prose. And it
> grows every time somebody adds a tool.

**Since 0.4.0 we count it for you.** `createChat` hands `prepareHistory` the
tools *this caller may actually use*, so the number compared against your limit
is what goes on the wire — a tool added tomorrow is counted tomorrow, and a
caller denied a tool is not charged for it. There is nothing to keep in step.

> Until 0.4.0 the guard counted only messages and the system prompt, so for any
> consumer with a real tool set it was low by the whole cost of the schemas — and
> **low is the green direction**: it reported room while the provider was already
> over. Reported by cms the day they went to production on 0.3.0. The same
> measurement found their own prompt-size alarm watching the system prompt and
> **not** the tool schemas, under-reporting the fixed cost the same way.

Calling `prepareHistory` yourself? Pass your tools as the fourth argument. And if
something *else* fixed rides along on every call — a gateway preamble — declare
it as `fixedOverheadTokens`; a value that is not a number is refused rather than
counted as zero.

**If the tool schemas alone exceed your limit**, you get `overhead_exceeds_limit`
rather than `cannot_reduce`. They are different problems with different fixes:
one says *shorten the conversation*, the other says *offer this caller fewer
tools, or raise the limit*. Merged into one state, it would send you to trim a
message that was never the problem.

**2. `estimateTokens` is ~4 chars/token, and that is an ENGLISH rule of thumb.**
Danish (æ ø å, longer word forms) costs more tokens per character, so the default
estimate **under-counts** — the dangerous direction, because you believe you have
room you do not have.

> **Measured by cms on their own Danish prose, 2026-08-28: 3.41 characters per
> token.** That is ~17 % more tokens than our default assumes, in exactly the
> direction we warn about. It is recorded here as *evidence that you should
> inject your own estimator* — **not** as a new default. One consumer's corpus is
> not the fleet's, and a second number pretending to be universal would be worth
> less than the measurement that shows why to take your own. `estimateTokens` is injectable for exactly this reason:
pass your provider's real tokenizer, or set the ceiling low enough that the
estimate's error cannot reach it. Write down which of the two you chose.

**3. The two errors are not symmetric.** Too low costs some premature compaction
— you lose a little context. Too high brings back the dead conversation this
whole module exists to prevent. Let that decide how conservative you are.

**The method, because it is a measurement and not a lookup:** send increasing
payloads with your REAL system prompt and REAL tool schemas until the provider
400s. Set the limit 20 % below that. Record both numbers **with the date** — a
provider ceiling is not a constant, and an undated figure looks like a
measurement a year later.

### Compaction changes what the MODEL sees, never what the USER can read

This module **never mutates the array you give it**, and neither does the loop.
Whatever you persist stays complete and verbatim, however much was left out of
the payload. cms's rule, from a real user they are not: somebody uses their admin
chat as a working tool and may expect to re-read a session word for word.

### Three outcomes, and a failure is one of them

```ts
{ status: "unchanged", messages, estimatedTokens, warning? }
{ status: "reduced",   messages, estimatedTokens, dropped, strategy }
{ status: "failed",    reason: "compaction_failed" | "cannot_reduce" | "overhead_exceeds_limit", messages, note }
```

`compaction_failed` (your summariser threw), `cannot_reduce` (there was nothing
left to remove) and `overhead_exceeds_limit` (the tool schemas and fixed prompt
do not fit on their own) are **never the same value**, and a failure returns the
transcript **unchanged** — never half-shortened. sanne's rule, generalised: when
a layer beneath the chat can fail, the failure carries its own state all the way
up and never merges with "nothing found".

The loop surfaces all of it as typed `history` frames (`warned` · `reduced` ·
`failed`), and an unshrinkable turn ends with `done: "too-large"` **without
calling the model** — sending a payload you know is too large is how the
conversation dies.

### ⚠️ You declare the limit. It is not read from the model registry.

Measured by cms and confirmed by ai-sdk: a model object carries exactly
`[id, alias, provider, available, status, note, source]` — **there is no context
window in it**, on any of the ten models. The only number that looks like one is
`maxTokens`, which is a **per-call output limit**. Read it as "the window" and
you get a number for something else entirely, which is worse than no number
because it looks like an answer.

`estimateTokens` is a **rough** heuristic (~4 characters per token) and says so.
Inject your own `estimate` if you have a real tokenizer.

### What is deliberately not here

**RAG over history** — store everything, retrieve only what is relevant. It is
last by Christian's order (*"vi skal have noget i drift med FD Sundhed FØR vi
har RAG klar"*), and it is **not in the `HistoryStrategy` union** rather than
present-and-throwing: an option that exists and throws fails in production; one
that does not exist fails in your editor.

**Prompt-caching** is not here either, and needs nothing from you: `@broberg/ai-sdk`
0.31.0 turned it on by default with a content-derived key. Measured live:
`$0.004411 → $0.000458`.

## A ceiling, and a wall in front of a public endpoint

A public chat is **an open LLM-spend faucet on a surface where strangers decide the volume**. An internal admin chat is not, which is why none of this is on by default — and why `mode: "public"` is the *stricter* setting, not the relaxed one.

### The number the ceiling reads

The first thing measured when this was built: **the core had no cost channel at all.** `ModelEvent` yielded `text` and `tool-call` and nothing else, so the figure a cap reads was discarded one layer below the guard that would read it. `usage` was added to that union — additively, so a `ModelFn` that never yields it keeps working:

```ts
const model: ModelFn = async function* (req) {
  const res = await ai.chat({ tier: "smart", ... });
  yield { type: "text", text: res.text };
  yield { type: "usage", provider: res.usage.provider, model: res.usage.model, costUsd: res.usage.costUsd };
};

const chat = createChat({ model, tools, can, spend: { limitUsd: 0.50 } });
```

### Silence refuses. This is the whole point.

`costUsd` is optional, and **every `ModelFn` in the fleet reported nothing when this was written.** A cap that reads *no number* as *within budget* is a ceiling that can never be reached and never says why — the consumer sets a limit, sees no error, and concludes they are protected.

So the guard has **three** answers, not two:

| | |
|---|---|
| `ok` | counted, under the ceiling |
| `spend_cap` | the ceiling was reached |
| `unmeasurable_cost` | **nothing usable arrived — refused** |
| `untrusted_provider` | the provider's price is not one we enforce on — refused |

`openai` and `deepseek` are **absent from `TRUSTED_COST_PROVIDERS` on purpose.** ai-sdk's F040 audit found both cache automatically while the SDK's reported price was too high; gemini and vertex were corrected in 0.32.0 against measured live figures, but openai and deepseek could not be measured — there was no key for either, and ai-sdk wrote nothing rather than writing it from memory. A cap built on a number we invented would be worse than no cap, **because it would be believed.**

**The ceiling never stops the first answer.** You cannot know what a call costs before making it, so it bounds the runaway tool→model→tool loop — which is the actual threat — and a single question is always answered. Reaching it arrives as its own `limit` frame, never as a provider error and never as a stream that simply stops.

### The public wall

```ts
import { SlidingWindowRateLimiter } from "@broberg/apikey";
import { verifyTurnstile, hashIp } from "@broberg/forms-turnstile/server";

export const POST = toNextHandler(createChatHandler({
  chat,                                  // must carry `spend` — enforced
  mode: "public",
  getCaller: () => ({ anonymous: true }), // NOT null; null is still 401
  guard: {
    rateLimit: {
      limiter: new SlidingWindowRateLimiter({ windowMs: 60_000, max: 10 }),
      keyFor: (req) => hashIp(req.headers.get("x-forwarded-for") ?? ""),
    },
    turnstile: { verify: (t) => verifyTurnstile(t, process.env.TURNSTILE_SECRET!) },
  },
}));
```

Nothing here is re-rolled — the window is `@broberg/apikey`'s and the bot wall is `@broberg/forms-turnstile`'s, both taken **structurally** so you inherit no version pin from us. Both are installed here as devDependencies purely so a test proves those shapes still match, rather than asserting it in prose.

Three things worth knowing:

- **A public deployment cannot be constructed with a hole in it.** No rate limit, no Turnstile, or a capped-looking chat with no ceiling — each throws at construction. "Must exist before the first public deploy, not after the first bill" only means something if it is enforceable.
- **The rate limit runs first**, because it is local and free. A flood is refused without paying Cloudflare a round-trip per bot.
- **A Turnstile outage fails CLOSED**, with its own 503. Failing open would be exactly backwards: an outage is the cheapest possible moment for a flood, and the thing behind this wall costs money per request. A rejection tells a real person she is not human; an outage is not her fault, and the two must not share a status.

## What is NOT in here

The widget, spend caps, retention, redaction, RAG-over-history. The core is the
contract; `/next`, `/hono`, `/http` and `/client` are the HTTP half, `/trail` is
the knowledge half, and `/history` keeps a conversation alive.

**Retention deserves its own warning.** Both stores measured during this design
keep whole conversations with **no expiry at all** — and one of them holds GDPR
article 9 health data. This package stores nothing, which is not the same as
solving it: whatever you persist, give it a deletion rule that *runs*, not a
column that records an intention.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
