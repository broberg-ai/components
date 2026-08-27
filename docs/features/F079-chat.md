# F079 — `@broberg/chat`

> **Christian, 2026-08-27:** *"Har vi lavet et fælles modul/API til dette? Og hvad skal vi have hvis vi nemt skal kunne integrere AI chat i stort set alle vores løsninger, og gøre det lige så elegant som Eir på Sanne's site og som Dinero gør."*

## The answer to the first question is no

`F025 — Chat / chatbot UI` has sat in the inventory's **backlog** since it was written. Three separate implementations exist; none is shared.

## What is actually there — asked, not assumed

All three owner sessions answered with code pointers. Two of my assumptions were wrong before I wrote a line.

| | What it really is |
|---|---|
| **sanne / Eir** | **The model to copy.** Owns the loop: `POST /api/eir` → SSE → `ai-sdk chatStream` → tool loop. 8 tools. **Trail is ONE TOOL**, not a prefetch — the model decides when to look something up, in the user's own words. Mistral EU only. |
| **trail** | The **knowledge layer**, and it does **not** stream. `POST /api/v1/chat` returns one answer. **No embeddings anywhere** (`grep` → 0 files): FTS5 + an LLM that *browses a pre-compiled Neuron wiki*. Hard tenant + single-KB isolation. Token never in the browser. |
| **cms** | **Admin chat, not a visitor widget** — not the source I assumed. The npm package is 138 lines; the real client is **10,241 lines** in their repo. 64 tools, system prompt **generated from the site's own schema**, no RAG at all. |

### Two assumptions the answers killed

1. I expected **embeddings** in Trail. There are none, and the alternative is better for us: because the model reads *named documents* rather than similar-looking fragments, it can cite a path. Citations fall out of the architecture instead of being bolted on.
2. I expected Eir to **call Trail's chat API**. It does not — it owns its own loop and treats Trail as a tool. That is why Eir streams and Trail's own chat does not, and it settles the shape of this module.

## The spine: three teams, one class of hole

Each found a variant of **the guard was not where the action was**:

- **cms**, found the day they answered: tools called the engine **directly**, so every `requirePermission` gate sat *outside* the chat's path. The filter read `!t.permission || hasPermission(…)` — a tool with **no** declared permission passed. **60 of 64 declared none**, so a read-only user got 61 tools, **30 of them mutating**.
- **sanne**, who got it right and named the rule: `book_appointment` calls an endpoint that answers `consent_required`. **"A tool that can act must not decide whether it may."**
- **trail**: tenant isolation is hard now, and their own comment records that the old code resolved on id alone, without a tenant check.

A shared module that lets each site write its own authorization inherits this fault once per site. So it becomes the package's contract, not a recommendation.

## Numbers that decide the design

**13.1 seconds** average response — trail, 34 assistant turns, their own database. They retracted their own earlier "8 seconds" as illustrative when asked to measure. **And that is on haiku, the fastest tier**: a shared module defaulting to a smarter model gets *slower*.

> Thirteen seconds of blank screen on a public page decides whether someone stays. Streaming is a requirement, not a feature.

**Cost per conversation: unknown — and the reason matters more than a number.**

The conversations trail could measure had all run on `claude-cli` — Christian's Max subscription as a subprocess, $0 because it is *his* quota. I reported that as the current state of the public chat. **It is not, and trail corrected it with both controls:**

```
which bun    → /usr/local/bin/bun   (positive control — the probe works)
which claude → exit 1               (negative — not in the prod image)
```

Production backends per chat turn tell the same story: Eir's public traffic has been `openrouter/gemini-2.5-flash` and `mistral-small` since 20 May; the last `claude-cli` turn was **29 April**. So a stranger's question on sanneandersen.dk was billed to Christian's personal quota in April/May, and has not been since.

**But the fix was an accident, and that is the finding.** `chain.ts` still has `{ backend: 'claude-cli' }` as step 1, `CHAT_BACKEND` is not set as a Fly secret, and the only thing preventing it is that the binary is absent from the image. Build an image that includes the CLI one day — say, to get free ingest — and public visitor traffic silently starts spending a personal subscription that nobody decided to spend.

> There is no guard. There is an absence. This week's recurring shape, in its purest form: a property that is true by luck reads exactly like a property that is enforced.

So it becomes a rule that can fail rather than a fact anyone hopes for — and trail sharpened the wording, correctly: **the guard hangs on `production`, not on "claude-cli appears in the chain."** On Christian's Mac that chain is deliberate; it is what makes local ingest free. Killing it to close a cloud hole would be a fix that costs more than the defect. The rule is therefore that a **public/production** surface must resolve to a paid API through `@broberg/ai-sdk` — at which point the cost is genuinely unknown **on a surface where strangers decide the volume**. Hence: spend cap and per-visitor rate limit are architecture, not settings.

trail also confirmed the token gap is real: `tokens_in`/`tokens_out` are NULL on every `claude-cli` turn, so the free runs cannot be costed backwards. Stamping tokens even when the price is 0 is the cheapest true number anyone can get, and they agreed to it.

**No retention limit anywhere.** sanne stores whole conversations — role, content, tool calls, user-agent, referer, session token, `user_id` — with no purge, no cron, no expiry. On a zone-therapy clinic that is **GDPR article 9** data kept indefinitely. Their gap and their report to Christian; the package's lesson is that every other site would discover it the same way.

## Two corrections to the brief, from the people who run it

1. **Source-citation badges default OFF.** Eir's prompt *forbids* citing sources, so it sounds like Sanne remembering rather than a database looking up. Dinero deliberately cites. Both are right for their own product — so it is a switch, with the reason recorded so nobody "fixes" it later.
2. **"Training" is the wrong word.** Nothing is trained. Knowledge is *retrieved at question time* from a source that stays editable — which is why Sanne's price change reaches Eir in ~6 seconds (webhook → revalidate). That is the property to preserve, and it is better than training.

## The shape

```
@broberg/chat            headless core — conversation loop, tool registry, SSE frames, authorization contract
@broberg/chat/next       Stack A route handler
@broberg/chat/hono       Stack B mountable router
@broberg/chat/client     framework-free browser client (streams, reconnects)
@broberg/chat/react|preact   the widget
```

**Knowledge is a pluggable retriever, not a hard-wired backend** — which answers Christian's own question about what to base it on:

| Retriever | For |
|---|---|
| `trailRetriever({ kbId })` | Trail neurons (what Eir uses) |
| `documentRetriever({ files })` | *"et langt skriv som cc laver til det enkelte site"* |
| `collectionRetriever({ collections })` | Live CMS content — the generic form of Eir's `treatments_list` |
| `schemaPrompt({ model })` | The site's own data model, generated — precision and honest refusal both come from structure |

### A fourth knowledge model nobody had on the list: the schema itself

cms answered a design question I did not know I had, and they **corrected their own earlier number** to do it (their "313 lines" was the source file's length, not the generated prompt — they re-measured rather than let a wrong sizing figure stand).

Their system prompt is **generated from the site's own data model**, and it works. Proven with three real model calls against the real prompt for sanneandersen (19 collections, 143 fields):

| Probe | Result |
|---|---|
| "which fields does `undervisere` have, which are required?" | all 7 field names in order, `name` correctly the only required one |
| "what is `sektion-komponenter` for, does it have a public URL?" | correct, and it *derived* "no public URL" from `kind:data` |
| **negative control** — a collection that does not exist | **did not hallucinate.** Said it could not find it and listed the 19 real ones |

**So the module must be able to GENERATE its prompt from a data model, not merely accept a text.** Their argument is the one that settles it: the precision *and* the correct refusal both come from **structure** — field names, types, required flags, kind. A hand-written description goes stale at the first schema change, and then the chat is *confidently wrong about fields that no longer exist*. That is worse than not knowing.

Two things they told us to build better than they did:

- **Do not pay for the same knowledge twice.** The schema is in the prompt *and* there is a `get_schema` tool, and their own rule 9 orders the model to call it before creating anything — so 3.2k tokens every turn *plus* a tool round-trip on exactly the path where it matters most. Pick one place.
- **Cap it, and build it once.** The schema is 56% of a 6,619-token prompt on sanneandersen, scales linearly with the site, and has **no ceiling**. Worse, the prompt is rebuilt on *every message*, and to write "10 documents" per collection it runs a `findMany` against every one — **19 database queries per chat turn, for a number in a prompt.**

sanne's sharpest observation is the reason the third one exists: **their tools are not generic but their signatures are.** `treatments_list` *is* "look up a CMS collection". Take the collection name as config and one tool serves every site; hard-code it and every site rewrites it.

## The five rules, each bought with someone's incident

1. **Stream, always.** 13.1s measured.
2. **A tool that can act must not decide whether it may** — and **a tool with no declared permission is denied.** One rule, two halves, from sanne and cms.
3. **Retention is a required value with no default.** A site cannot adopt the module and find the hole later.
4. **Spend cap + per-visitor rate limit are architecture.** `claude-cli` can never serve the public.
5. **"I cannot look that up" must be reachable, and must never collapse into "no."** Eir confidently told Christian that Sanne sells nothing — because the shop tool was missing. The model was not confused; it was blind and sounded certain.

## Reuse (F217) — eight existing packages, no new provider integration

`@broberg/ai-sdk` (every model call, EU tier for personal data) · `@broberg/seti-client/sse` (the half-open-stream watchdog three repos already share — do not re-roll it) · `@broberg/forms-turnstile` (a public chat endpoint is an open spend faucet) · `@broberg/notify` (human handoff to Slack/Discord) · `@broberg/consent-cookie` · `@broberg/secret-scan` (redact before persisting a conversation — people paste keys into chats) · `@broberg/logger` · `@broberg/apikey`.

## The one thing that does not exist yet

**A site cannot give Trail its own tools.** Prompt, tools and guardrails are all server-side there. Without that socket a shared module is a FAQ box — it can never say *"here are your free slots"*. That is a **proposal to trail**, not something built around them, and it is the epic's only external dependency.

## GO, and the first consumer — Christian, 2026-08-27

> *"FD Sundhed skal være første kunde … FD Sundhed skal anvende modulet internt i appen og kun udvalgte grupper skal have initial adgang, Ejer og Admins. Den skal selvfølgelig køre på en selvstændig trail … Når admin chatten er oppe at køre kan vi se på at indlejre en chat i selve flow i FD Sundhed som det initialt er mocked."*

**This is a better first consumer than a public site, and it reorders the build in our favour.**

| | |
|---|---|
| **Surface** | Internal, inside the fd-sundhed app — **not** a public visitor widget |
| **Access** | Owner + Admins only, initially |
| **Knowledge** | Its **own** Trail KB — Trail stays the brain, one tenant per consumer |
| **Then** | Embed a chat in the fd-sundhed flow itself (mocked today) |
| **Then** | Judge whether the module is strong enough to swap Eir and the CMS chat onto it |

### Why this order is lucky

The two things that would otherwise be hardest arrive first, and the two that would be riskiest arrive later:

- **Authorization is exercised on day one.** An admin chat gated to Owner + Admins *is* the deny-by-default contract under load — the exact thing cms found broken in their own 64-tool chat. Building it against a real role model beats designing it against an imagined one.
- **The spend faucet is closed by construction.** An authenticated group of a handful of people is not a surface where strangers decide the volume. The cost guard still gets built (F079.5), but it is not the thing standing between us and the first deploy.
- **Health data is a hard constraint from the first line, not a retrofit.** fd-sundhed serves ~18.000 municipal employees, so EU-tier models and a retention limit are not options that can be added in v2 — which is precisely the mistake the sanne measurement exposed.

### The swap is a test, not a promise

Eir and the CMS chat are **not** migrating on schedule. They migrate *if* the module proves strong enough, and each already does something the module must match before it earns the swap: Eir streams with 8 tools and a 391-line bespoke prompt; cms drives 64 tools and generates its prompt from a live schema. **A module that cannot absorb those without loss has not passed** — and saying so before building is the point of writing it down.

## Two blockers for fd-sundhed specifically — measured by trail, 2026-08-27

Asked whether Trail could carry health data for a municipality. The answer is **not yet**, and they said so plainly rather than packaging it.

### 1. The EU guarantee has a hole the module cannot see

`ai-sdk-backend.ts:36` — the primary provider is `mistral` (EU, same as Eir). **The next step in the chain is hard-coded to `openrouter` + `google/gemini-2.5-flash`.** OpenRouter is a US proxy; Gemini is Google.

So if Mistral fails — quota, 5xx, timeout — **the conversation moves out of the EU automatically.** No error, nobody asked. For ~18.000 municipal employees' health data that is not a caveat, it is the thing that must not happen.

Per-KB pinning exists (`knowledge_bases.chat_fallback_chain`, precedence 1) and can hold an EU-only chain. **But it has never been run end to end.** trail's own words: treat it as *probably enough*, not as a guarantee anyone can sign in front of a municipality. That distinction is the whole reason to write it down — this is the exact shape as everything else this week, a property that reads as enforced and is true by configuration nobody has exercised.

### 2. There is no retention at all, and Trail stores more than sanne does

`chat_turns.content` holds **the whole conversation in cleartext** — question and answer — in the tenant's `trail.db`, plus backend/model/tokens/latency/cost per turn. Deletion is one manual route (`DELETE /chat/sessions/:id`) called by a human. trail searched specifically for purge/prune/retention/expire and found **nothing**.

The truth fd-sundhed must be told, not softened: the conversation sits on a Fly volume in Stockholm, in their own tenant database, **with no expiry, until someone actively deletes the session.**

Our contract — retention is a required value with no default — is right, and it **cannot be enforced down into Trail's layer today**. A module cannot promise what its store does not do. (buddy's sentence, from a different bug the same day: *a package cannot know its promise has become untrue because of something underneath it.* Here we DO know, in advance, which is the only reason this is a plan and not an incident.)

### 3. And provisioning is a human, not an API

A Trail tenant is created **only** as a side effect of a first Google login on an unknown address (`routes/auth.ts:121`). No `POST /tenants`, no admin UI, no key that can do it. So "set up a separate Trail for fd-sundhed" is: someone logs in, creates the KB, mints a `trail_` key. The module can automate steps 2–3, never step 1.

**None of this blocks F079.1** — the core is model-injected and stores nothing, so it is exactly the right thing to build while these are settled. It blocks fd-sundhed *going live on Trail*, which is a different date and a decision for Christian.

## The second surface, already designed — do not block it

The mocked chat Christian referred to is **not in fd-sundhed's code**: it is a cardmem mockup, approved at v13, screens 4 and 4b of *"FD Sundhed — mobil kunderejse"*. An employee writes freely about an injury; the assistant asks **one clarifying question at a time** and ends in an **action** ("shall I find you a time?"), never in an assessment.

**Sequence is settled: the admin chat first.** This is not what gets built now — it is what must not be walled off. Three things it demands that the admin chat does not:

1. **The user is an EMPLOYEE, not an admin** — and the permission set is *disjoint*, not a subset. She may only ever discuss **her own** case. fd-sundhed has 13 `user` rows today and 15.863 arriving. Anything that assumes "fewer tools = a smaller admin" is wrong before it ships.
2. **Free text about an injury is article 9 data going straight into a model.** This is the strongest argument that the EU tier and the retention limit are first-line constraints rather than v2: it is not an admin asking for a number, it is a municipal employee describing her body.
3. **"No diagnoses" is a product decision, and it must be PROVABLE.** Their sentence is the requirement: *"if the core gets a prompt or policy mechanism, this is the kind of rule it must carry — and it must be provable, not merely written."*

### Why point 3 changes something, and what it does not change yet

A prompt instruction is an **agreement**: it works for whoever reads it. buddy made the same argument against a JSDoc warning earlier the same day and was right then too.

So a rule like "never state a diagnosis" cannot live only in `systemPrompt` if anyone is expected to rely on it. It needs somewhere a **test can drive it** — and the honest version is not a diagnosis detector, which would be a guard that fails green the first time a phrasing slips past it. It is a **policy hook over the outgoing frame stream**: the consumer's rule lives as code, sees every text frame before it leaves, and can refuse or rewrite.

**The core already permits this without a shape change** — `run()` yields an async iterable, so a policy is a transform over it. That is deliberate and is the reason this section exists now rather than after the adapters: nothing built today forecloses it, and nothing is being built for it speculatively either.

## Rollout — smallest first, each one useful alone

| # | Story | Why this order |
|---|---|---|
| **F079.1** | Headless core: conversation loop, tool registry, **deny-by-default authorization**, SSE frames | The contract. Everything else is an adapter over it, and the authorization rule cannot be retrofitted. |
| **F079.2** | Retrievers — `trail` · `document` · `collection` | Answers Christian's actual question about what the knowledge is based on. `document` is the one nobody has: *a long text cc maintains per site*. |
| **F079.3** | Stack A + Stack B adapters | Same shape as `@broberg/device-stats` — thin, structural, no vendor types. |
| **F079.4** | The widget: streaming, human handoff, feedback, transcript, unread badge | The Dinero surface. Handoff first — it is what sanne missed most. |
| **F079.5** | Spend cap + per-visitor rate limit + Turnstile | Must exist *before* the first public deploy, not after the first bill. |
| **F079.6** | Retention, consent, redaction | A required value, not a default. |
| **F079.7** | Pilot: Eir migrates to the core, keeping its own prompt and tools | The proof. If Eir cannot adopt it without losing anything, the extraction is wrong. |

**External dependencies — two, both proposed to trail, neither promised:**

1. **The tool socket** — a site cannot give Trail its own tools today. Without it a shared module can never say "here are your free slots".
2. **A boot assertion** that refuses to start when the resolved backend is `claude-cli` in production. trail chose this over a test that reads `chain.ts`, for the right reason: a test sees what the CODE prefers, the assertion sees what the running process actually resolved to — and the failure would arrive by someone changing the IMAGE without touching the chain.

Both are marked **awaiting owner GO**, not "on the way". trail put them to Christian rather than acting on a peer's recommendation, and said plainly they did not want us planning on a promise they had not been allowed to make. That is the right shape, and this plan does not assume either lands.

## Decided by Christian, 2026-08-27

> *"Og ja den skal kunne aktivere værktøjer der er unikke for det enkelte site eller platform."*

**Site-specific tools are in scope from day one, not a later phase.** So the tool registry is the core of the module rather than an extension point bolted on afterwards — which is also the only order that works, because retrofitting authorization into a chat that already ships is precisely the defect cms found this week.

Two things follow, and they are the shape of the whole build:

1. **Answering ships to every site.** Knowledge, streaming, handoff, retention. This is Eir minus Sanne.
2. **Acting is enabled per site, on Christian's word.** Booking, prices, availability. Eir keeps the tools it already has; nobody else gets acting tools without him saying so. The *capability* is universal; the *permission* is per site.

That split is why deny-by-default is the package's contract and not a setting: a module that can carry site-specific tools to every repo in the fleet is a module where one forgotten permission declaration is a live hole on a customer's site.

## Non-goals

- Not a Trail replacement, and not a second knowledge store.
- Not a brand. The system prompt is the consumer's; Eir's 391 lines are 100% Sanne and must never be packaged.
- Not a live-support product. Human handoff means *reaching* a human, not an inbox with agents and queues.
- No fine-tuning. Retrieval from an editable source beats it and updates in seconds.
