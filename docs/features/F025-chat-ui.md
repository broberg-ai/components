# F025 — Chat / Chatbot UI

> L3 Domain · hybrid · effort **L** · impact **high** · owner `cms`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A full-featured AI chat surface: SSE-streamed message exchange (user/assistant bubbles), live streaming cursor, thinking/tool-call progress animations, conversation history with sidebar drawer (rename/star/delete/search), markdown rendering with inline rich elements (code, tables, doc-pills, treatment-cards), a multi-line composer with file-upload (drag-drop + click), per-message copy + reactions, follow-up suggestion pills, abort/stop. Two mounting styles: full-panel (admin shell — CMS) + floating corner widget with FAB (sanneandersen/Eir). All three primary repos share the same SSE event contract: text/tool_call/tool_result/thinking/error/done over a ReadableStream reader.

## Solution
**hybrid.** The SSE streaming engine + message-state machine are identical across cms (chat-interface.tsx), sanneandersen (eir-chat.tsx), trail (chat.tsx) — the headless loop (fetch → getReader → decode SSE → dispatch events → abort) is a safe runtime package. The UI diverges radically (cms full-panel + zero-dep markdown + file-upload; Eir floating widget + treatment-cards + react-markdown; trail Preact + marked + carousels + citations) — both component tree + styling diverge per brand → copy-owned. So: headless SSE engine (package) + copy-owned UI shells per stack.

## Scope

### In scope
- Extract from `webhouse/cms` `packages/cms-admin/src/components/chat/*` + `app/api/cms/chat/route.ts`.
- @broberg/chat-core (sseStream + useChatStream + extractFollowups + types) + React + Preact UI shell scaffolds + a zero-dep MarkdownRenderer.

### Out of scope
- Per-brand UI tree + styling (copy-owned).
- App-specific conversation persistence endpoints.

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/cms-admin/src/components/chat/` (chat-interface/chat-input/message-list/tool-call-card/thinking-animation/markdown-renderer.tsx) + `app/api/cms/chat/route.ts`: most complete + best-decomposed (10 files, 57 data-testid, file-upload drag-drop, inline forms, artifact cards, cross-device SSE sync, export/import, memory panel, star/rename/delete, thinking timer, zero-dep MarkdownRenderer); route shows the canonical SSE protocol over @broberg/ai-sdk.

### Other implementations seen
- `webhouse/sanneandersen` `site/src/components/chat/eir-chat.tsx` — floating corner widget + FAB; welcome-back banner, reactions, share-with-Sanne, i18n, localStorage draft, follow-up pills, read-more collapse; react-markdown + remark-gfm; the extractFollowups/displayText algorithm (strips model-emitted JSON arrays from the visible stream) is key to port.
- `broberg/trail` `apps/admin/src/panels/chat.tsx` — Preact (viable without React); session sidebar grouped by recency, citations with neuronId links, image carousels, per-session turn cap, save-turn-as-neuron, audience selector; marked.

### Headless core vs. adapters
- **Core (@broberg/chat-core, no React/Preact/next):** sseStream(url,body,signal) (fetch ReadableStream → typed ChatEvent text/tool_call/tool_result/thinking/error/done/form/artifact/conversation); useChatStream (framework-agnostic state machine: messages[], isThinking, activeTool, abort → {messages,isThinking,send,stop}); extractFollowups(raw) (strips model-emitted JSON followups block, from eir-chat.tsx); Message/ToolCall/ChatEvent types (partially in @broberg/ai-sdk).
- **Stack A (Next/React/shadcn):** React hooks over useChatStream; copy-owned tree: ChatInterface (full-panel), EirChatWidget (floating FAB), MessageList/Bubble, ChatInput (file-upload + drag-drop), ToolCallCard, ThinkingAnimation, MarkdownRenderer, ConversationDrawer, MemoryPanel; Tailwind v4 CSS vars.
- **Stack B (Bun/Hono/Vite/Preact):** Preact hooks over the same core; thinner UI (MessageList, ChatInput, ThinkingAnimation); marked (not react-markdown); trail chat.tsx reference.

### Public API
```ts
export type ChatEventType = 'text'|'tool_call'|'tool_result'|'thinking'|'error'|'done'|'form'|'artifact'|'conversation';
export interface ChatMessage { id: string; role: 'user'|'assistant'; content: string; toolCalls?: ToolCall[]; isStreaming?: boolean }
export function sseStream(url: string, body: unknown, signal?: AbortSignal): AsyncIterable<{event: ChatEventType; data: unknown}>;
export function extractFollowups(raw: string): { stripped: string; followups: string[]|null };
// Stack A/B UI shells are copy-owned scaffolds (full-panel + floating widget), not versioned deps
```

## Stories
- **F025.1** — Extract headless SSE engine into @broberg/chat-core — _AC:_ exports sseStream (AsyncIterable of typed ChatEvents) + extractFollowups + shared types; zero React/Preact/next imports; cms route still emits the same SSE contract; tests cover text/tool_call/tool_result/done parsing, partial-frame buffering, abort propagation, extractFollowups strips tagged/untagged/bare JSON arrays without corrupting text.
- **F025.2** — Stack A ChatInterface + MessageList + ChatInput — _AC:_ full-panel chat with streaming, tool-call cards, thinking animation (elapsed timer), markdown (headings/code/tables/lists/blockquotes/doc-pills), file-upload drag-drop, per-message copy, conversation drawer (rename/star/delete/search), export/import; data-testid everywhere; Lens smoke on cms dev.
- **F025.3** — Stack A EirChatWidget (floating corner) — _AC:_ FAB + corner panel open/close animation, ESC, new-session, follow-up pills (extractFollowups), welcome-back banner, reactions, read-more collapse (>600 chars), localStorage draft, i18n strings prop; data-testid; Lens smoke.
- **F025.4** — Stack A ThinkingAnimation + ToolCallCard — _AC:_ ThinkingAnimation orbiting-dot CSS + elapsed timer (M:SS), label + startTime; ToolCallCard running/done/error states + destructive variant + friendly-label registry; Lens baseline.
- **F025.5** — Stack B Preact adapter consuming @broberg/chat-core — _AC:_ trail chat.tsx refactored to use sseStream instead of its own loop; session sidebar/citations/carousels/audience/save-as-neuron preserved; no React imports; marked; no regression on trail admin.
- **F025.6** — MarkdownRenderer zero-dep block parser — _AC:_ standalone (no react-markdown); handles headings h1-h3, fenced code + lang label + copy, lists, blockquotes, tables, hr, inline bold/italic/code/strike/links; extensible via slot props (doc-pills/treatment-cards); works in React + Preact via JSX pragma.

## Acceptance criteria
1. @broberg/chat-ui builds + typechecks clean; headless core imports no framework packages.
2. Each story (F025.1–F025.6) meets its own AC.
3. Piloted in cms and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (sanneandersen or trail) migrates onto the shared core with identical behaviour.

## Dependencies
- F001 tokens (blocks). External: @broberg/ai-sdk (SSE/fetch layer), lucide-react (Stack A), react-markdown+remark-gfm (optional Stack A), marked (Stack B).

## Rollout
Strangler: 1) extract sseStream + extractFollowups + types into @broberg/chat-core (or fold into @broberg/ai-sdk) — owner cms; 2) refactor cms ChatInterface onto it, verify no regression; 3) copy-own the Stack A UI shell into components as a documented scaffold; 4) port Eir onto chat-core + adopt the shell as a starting point then brand-diverge; 5) port trail (Stack B) onto chat-core, keep its Preact tree; 6) document both mount patterns in README.

Graduate-candidate: no — stays in `components`.

## Open Questions
- sseStream in @broberg/ai-sdk (owns the AI fetch layer) or a separate @broberg/chat-core?
- Which markdown renderer wins? cms zero-dep vs react-markdown (Eir) vs marked (trail) — needs testing on all three corpora.
- cms doc-pill / form-inbox inline tokens ([doc:..]/[form:..]) — plugin/slot system or stripped from shared?
- Conversation persistence: a chat-core store interface or intentionally app-specific?
- EirChatWidget custom events (eir:open / eir:booking-confirmed) wiring — z-index + decoupling guidance.

## Effort estimate
**L** — owner session: `cms`. Reuse model: hybrid.

## Risks
SSE event-contract divergence (cms {text}, sanneandersen {delta}, trail agentic loop) — normalising into one chat-core contract needs coordinated server changes across 3 repos; define the canonical shape in @broberg/ai-sdk first, each repo adopts on its own timeline with an interim shim. Markdown-renderer divergence (3 renderers) — the cms zero-dep parser (~630 lines) is most capable but needs testing against all corpora before it's canonical. File-upload (ChatInput) is cms-specific (/api/upload + /api/extract-text) — Stack B omits it or accepts an upload handler prop.