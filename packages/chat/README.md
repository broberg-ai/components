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
  baseUrl: "https://engine.trailmem.com",
  kbId: "fd-sundhed-admin",          // CONFIG. Never an argument the model supplies.
  token: process.env.TRAIL_API_KEY!,
  permission: "knowledge.read",
  fetch,                             // injected — every state below is testable with no network
});
```

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

`kbId` does not appear in the schema the model sees, and one arriving in the
model's arguments is *ignored*. If it were an argument, a model could be talked
into another tenant's knowledge — and fd-sundhed alone is getting two knowledge
bases, written for readers with different rights.

### 3. Freshness is stated even though Trail does not report it

Measured by sanne across all five top-level and all eight chunk keys of a live
response: **there is no `updatedAt` anywhere.** So every result carries
`freshness: { known: false, note: … }` in words, because a missing date must
never be read as "current" — fd-sundhed's prose answers are decisions that
change, one of which flipped twice in four hours.

There is also **our own ceiling** on top of Trail's `maxChars`/`topK`, and what
it dropped is reported. sanne cap nothing client-side, so the day Trail stops
honouring `maxChars` they have none at all.

> **Not live-verified.** Every state above is proven against a recorded response
> measured from production, with `fetch` injected. No call has been made against
> a real Trail from this package — a Trail tenant exists only after a human
> Google login, so the first live run waits on that.

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

## What is NOT in here

The widget, spend caps, retention, redaction, history management. The core is
the contract; `/next`, `/hono`, `/http` and `/client` are the HTTP half, and
`/trail` is the knowledge half.

**Retention deserves its own warning.** Both stores measured during this design
keep whole conversations with **no expiry at all** — and one of them holds GDPR
article 9 health data. This package stores nothing, which is not the same as
solving it: whatever you persist, give it a deletion rule that *runs*, not a
column that records an intention.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
