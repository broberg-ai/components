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

**Cost per conversation: unknown — and the reason matters more than a number.** Every measured conversation ran on `claude-cli`: Christian's Max subscription as a subprocess. $0, because it is *his* quota. That cannot serve strangers on a public page — no cap, no attribution, and a vendor agreement not written for it. A public chat must go through a paid API via `@broberg/ai-sdk`, at which point the cost is unknown **on a surface where strangers decide the volume**. Hence: spend cap and rate limit are architecture.

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

## Non-goals

- Not a Trail replacement, and not a second knowledge store.
- Not a brand. The system prompt is the consumer's; Eir's 391 lines are 100% Sanne and must never be packaged.
- Not a live-support product. Human handoff means *reaching* a human, not an inbox with agents and queues.
- No fine-tuning. Retrieval from an editable source beats it and updates in seconds.
