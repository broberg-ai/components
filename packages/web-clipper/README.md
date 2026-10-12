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

Coming in the next stories: the extraction and destination plug-in points, Broberg ID login from the extension, the extension skeleton and UI (Preact + Tailwind v4 + @broberg/theme, per D-7598d1).
