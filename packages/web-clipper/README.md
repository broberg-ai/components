# @broberg/web-clipper

The fleet's one web-clipper base — Trail Web Clipper and Jam Clipper build on it (epic F099, Christian's build order 12/10 2026). No forks: improvements go upstream here.

## `@broberg/web-clipper/core` — the fingerprint engine (F099.2)

```ts
import { chain, diff, idempotencyKey, verify } from "@broberg/web-clipper/core";

const units = [{ kind: "turn", role: "user", content: "Hej", position: 0 }, /* … */];
const d = await diff(knownChainFps, units);   // what the destination already has, in order ([] for new)
// d.kind: "same" (nothing to send) | "append" (send d.units) | "branch" (an earlier unit changed:
//         a new branch from d.forkAt with parent d.parentChainFp — the old line is never overwritten)
for (const link of d.kind === "same" ? [] : d.links) send(unit, { idempotencyKey: idempotencyKey(link) });
```

- A **unit** is one page, or one chat turn. Its fingerprint is sha256 over (kind, role, position, content).
- The **chain** fingerprint of a unit includes the previous one, so a change anywhere earlier changes everything after it.
- **Send only new**, **resend without duplicates** (the idempotency key is the chain fingerprint), **branches** when a prompt is edited or an answer regenerated, and `verify()` finds a tampered unit by position.
- A destination that replaces the whole page each time (Trail: one source per URL) simply passes `[]` and sends everything — that is the default for destinations without append-only.

## `@broberg/web-clipper/extract` — the extraction plug-in point (F099.3)

```ts
import { extractClip, type Extractor } from "@broberg/web-clipper/extract";

const chatgpt: Extractor = { id: "chatgpt", matches: (u) => u.hostname === "chatgpt.com", extract: async (doc, url) => ({ /* Clip */ }) };
const clip = await extractClip(document, new URL(location.href), [chatgpt]);  // yours first, the article extractor otherwise
```

- `articleExtractor` is Trail's extractor (Readability + turndown, same options and rules) lifted unchanged; a test holds it to byte-identical output against Trail's own file (f5ce8ba) on the same pages.
- Your extractors are tried in the order you pass them; the first match wins. Nothing matches → the article extractor.
- **Deterministic, always:** the same DOM must give byte-identical markdown, or a reload looks like an edit and the fingerprint engine opens a false branch. That rule binds your extractors too.
- A page with nothing to clip throws `NothingToClipError` — never an empty clip.

## `@broberg/web-clipper/transport` — destinations and the sender (F099.4)

```ts
import { sendClip, DestinationError, type Destination } from "@broberg/web-clipper/transport";

const trail: Destination = {
  id: "trail", label: "Trail",
  targets: async (s) => /* tenant × brain */ [],
  async send(units, { target, session, clip }) {
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${session.accessToken}` }, body });
    if (!res.ok) throw new DestinationError(res.status);   // report the HTTP answer — the base decides what it means
  },
};
const r = await sendClip({ destination: trail, target, clip, auth });
// r.state: "sent" | "login_required" («log ind igen») | "consent_required" | "refused" (4xx) | "unavailable" (5xx/network, retries spent)
```

- **Only new units** for an `appendOnly` destination (it answers `lastSeen(anchor)` with the chain fingerprints it holds); every other destination gets the whole clip each time.
- **Idempotency key = chain fingerprint.** Batches (`batchSize`, default 50) are committed one by one, so an interrupted run resumes where it stopped: nothing twice, nothing lost.
- **401** → one forced session refresh and a resend; no session or 401 again → `login_required`. **5xx / network** → backoff (500 ms, doubling, 4 attempts) → `unavailable`. Never confused. **Other 4xx** → `refused`, not retried.
- A destination with `requiresConsent` gets nothing until `consented: true` for that anchor.

Coming in the next stories: the extraction and destination plug-in points, Broberg ID login from the extension, the extension skeleton and UI (Preact + Tailwind v4 + @broberg/theme, per D-7598d1).
