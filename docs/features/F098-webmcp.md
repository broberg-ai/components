# F098 — @broberg/webmcp: book and order from the customer's own AI

> Epic · components (format + package) with cms (manifest generation) · effort L · status: planned 7/10, GO from Christian

## Summary
Every site and service that offers booking, a shop or any kind of order can be used directly by external AI agents and chat services such as Claude and ChatGPT, so a consumer can book or order from us without leaving the chat. One shared format describes what a site can do. From it come Schema.org data and prefilled booking links, which work in a plain chat today, plus a thin WebMCP layer for agents that drive a browser. It works with or without the CMS.

## Motivation
Christian, 7/10: «Vi skal være forberedt på at alle vores sites og services der udstiller enten booking, shops, eller bestillinger af nogen art på på en offentligt web flade skal kunne kontaktes af eksterne agenter og chat services som claude og chatGPT med henblik på at forbrugeren kan bestille fra os direkte i deres chat interface.» He asked whether it should start in cms or here, «med henblik på at lave en fælles pakke som alle sites kan anvende, også dem der IKKE anvender cms». His plan v2 is kept verbatim at `F098-owner-plan-WEBMCP-PLAN-v2.md` (in this folder).

## Solution, and why it is born HERE
The **format is the contract**, so it cannot live in cms: a site without cms would then depend on cms. Split (the plan's own §3, made concrete):

| Part | Owner |
|---|---|
| Tool manifest format (JSON Schema + types + validate) | **components**: `@broberg/webmcp/manifest` |
| JSON-LD + deep-link generator from a manifest | **components**: `@broberg/webmcp` |
| Browser layer: feature detection, register/unregister, safety layer | **components**: `@broberg/webmcp` |
| Generating the manifest from cms content and plugins, and the editor toggle | **cms** (its own epic) |
| Sites and apps without cms | define their manifest in code |

**Order follows what works today.** Schema.org plus a deep link reaches a plain chat now (plan §8.3). WebMCP needs an agent with a live browser and a spec that is still moving (§7). So F098.3 is valued above F098.4, and the browser part is kept thin.

## Reuse
- **Server MCP:** `@broberg/mcp` (F007). Evaluate in F098.1 whether its tool definition can be the manifest's basis instead of a third format.
- **JSON-LD on cms sites:** `@webhouse/cms/enrich` already writes SEO and llms.txt. Coordinate (F098.3 AC) so a site never gets two JSON-LD blocks.
- **Booking:** `@broberg/complimenta-sdk` (fdaa) is a booking SDK in the fleet. Relevant for §6.5, the booking backend.
- **Measurement:** `@upmetrics/sdk` for logging tool calls (plan phase 5).
- **Payment (shop):** `@broberg/stripe`. ACP is cms' PATCH-SHOP-ACP; not repeated here.
- Discovery search 7/10 for «webmcp», «schema.org», «agent tools» and «acp»: no existing package covers this. Build.

## Design
The only visual surface is the user's confirmation of a write action. It is designed in F098.4 after the spike, because WebMCP may itself require a browser or agent confirmation. Everything else has no UI.

## Scope
### In scope
The manifest format, JSON-LD and deep links, the browser layer and the safety layer in `packages/webmcp`, the spike, and the pilot on sanneandersen.dk together with cms and sanne.
### Out of scope
- cms' manifest generation, editor toggle and ACP (cms' own).
- appkit's logged-in tools (plan phase 4, later).
- A broberg.ai-level booking app across customers (plan §8.4: a separate decision).
- Default-on for existing customer sites (plan §6.3: Christian's decision later, D-5f65b6).

## Stories
- **F098.1** — Spike: spec and browser status measured, and whether plain chat reads Schema.org and deep links.
- **F098.2** — The format: JSON Schema + validate, aligned with WebMCP, agreed with cms.
- **F098.3** — Schema.org JSON-LD + deep links from the manifest (works today).
- **F098.4** — Browser layer + safety layer, zero cost without support.
- **F098.5** — Pilot sanneandersen.dk, measured end to end.

## Acceptance criteria
1. A site without cms can describe its tools in code and get JSON-LD, deep links and WebMCP registration from the same manifest. Measured in vitest on a manifest written by hand.
2. A plain chat can take a customer from a question to a prefilled confirmation step on the pilot site. Measured on the live site, with a transcript and a Lens screenshot.
3. A browser without WebMCP shows no errors and loads nothing extra. Measured in vitest and with a bundle check in CI.
4. No write action happens without the user's confirmation, and a retried call is not executed twice. Measured in vitest, mutation-checked.

## Dependencies
- cms: tool registry and manifest generation (their epic). F098.2 needs their written agreement on the format.
- sanne/cms: the booking backend for the pilot (§6.5).

## Rollout
New opt-in package. The pilot is on one site. Nothing changes for other sites until Christian decides on default-on (§6.3).

## Open Questions
1. **Booking backend for sanneandersen.dk** (plan §6.5): the site's own, or an adapter to the system the customer already uses? This decides F098.5. Christian's decision before the pilot.
2. **Default-on for existing customers, or opt-in per site** (§6.3): not needed until after the pilot.

## Findings — F098.1 spike

### Pure chat, measured 11/10 2026 (around 23:57 Danish time)
Christian typed the same request into claude.ai and ChatGPT, both with web search on: «Book en kort behandling hos WebMCP-lab Testklinik den 20. oktober kl. 10 — siden er https://discovery.broberg.ai/webmcp-lab». The lab page's own server log (GET /webmcp-lab/hits, user-agent class only) is the evidence, not what the chats said:

| client | fetched the page | fetched /book itself | what it gave the user |
|---|---|---|---|
| claude.ai (`claude-user`) | yes, once | **no** | the correct prefilled link `…/book?service=kort&date=2026-10-20&time=10:00`, «open it and confirm» |
| ChatGPT (`chatgpt-user`) | yes, once | **no** | a booking card (service, price, date, 10.00–10.30) with a «Fortsæt til bookingbekræftelse» button |

End to end, measured: Christian pressed ChatGPT's button and the lab log shows `book` · `chrome` · «kort 2026-10-20 10:00» at 21:59:05Z — the confirmation step opened in HIS browser with the right service, date and time. So one click takes a chat user from a question to a prefilled confirmation; the confirmation itself is the person's, as the plan requires (nothing is stored by the lab).

Both read the page and both built the right deep link from it. Neither completed or even opened the booking step itself, and neither saw WebMCP tools (Claude said so explicitly: «siden ikke stillede nogen WebMCP-tools til rådighed for mig»). That is the expected split: WebMCP tools only exist for an agent driving a live browser.

**Consequence for the plan:** route 1+2 (plain HTML + Schema.org/deep link, F098.3) already takes a chat user from a question to a prefilled confirmation step in both major chats today. It is the part worth building first; the WebMCP layer (F098.4) only adds value for browser agents. Not measured: whether the chats used the JSON-LD `urlTemplate` or the plain-HTML link pattern (the log cannot tell; Claude described «tekst og et URL-mønster»).

### Presentation differs per chat (Christian 11–12/10)
- **ChatGPT** rendered a rich booking card (service, price, date, time, button) — and decorated it with an image from an UNRELATED spa site («Eco-Friendly Spa Designs – MedicalSpaStay»), because the lab page offers no image of its own.
- **Claude** showed the same correct link as plain clickable text, no card.
The card is the chat's own UI; we cannot add it to Claude. What we control: **F098.3 must emit complete structured data — name, own image and logo, price, duration, address, opening hours** — so any chat that renders a card renders OURS, never a borrowed picture. A richer in-Claude experience would need a connector (remote MCP) the customer adds; that is a separate decision, not part of making a site readable.

### Still open (F098.1 AC 1)
Browser agents calling a registered WebMCP tool (Claude in Chrome, Gemini, Atlas, Copilot) — not measured yet. Lens cannot drive WebMCP today (cardmem F074.109 / F074.112).

## Effort estimate
**L**: spike 1–2 days, format 1 day, JSON-LD/deep links 1 day, browser layer 2 days, pilot depending on the backend.
