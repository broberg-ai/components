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

## `@broberg/web-clipper/auth` — Broberg ID login from the extension (F099.5)

```ts
import { createBidAuth } from "@broberg/web-clipper/auth";

const auth = createBidAuth({
  issuer: "https://id.broberg.ai",
  clientId: "trail-clipper",                 // this extension's PUBLIC BID client — no secret anywhere
  audience: "https://app.trailmem.com",      // optional: session() then returns a user TICKET for that receiver
  ticketScope: "trail:clip",
});
await auth.login();                          // chrome.identity.launchWebAuthFlow, PKCE (S256) + state
const r = await sendClip({ destination, target, clip, auth });   // auth IS the sender's session source
```

- Needs the `identity` and `storage` permissions. Tokens live in `chrome.storage.local`, keyed by client id — two extensions never share a login.
- `session()` renews ahead of expiry. **Refused refresh** (the user's BID login ended) → `null` and the login is cleared → show «log ind igen». **BID not answering** → `BidUnavailableError`, the login is kept, and the sender reports `unavailable`, not a logout.
- With `audience`: the BID token is swapped for a 5-minute user ticket (BID F087.37), reused while valid, fetched anew when the sender forces a refresh after a 401. `session_ended` → `null`; a setup refusal (`no_rule_for_audience`, `scope_not_allowed`) → `BidTicketRefusedError` (the sender reports `refused`).
- The redirect is `chrome.identity.getRedirectURL()` = `https://<extension-id>.chromiumapp.org/` — BID matches it character for character, so the extension needs a FIXED id (manifest `key`).

## The extension: `/extension`, `/content`, `/vite`, `/ui` (F099.6)

```ts
// vite.config.ts — a whole clipper from the shared build
import { defineConfig } from "vite";
import { defineClipperManifest } from "@broberg/web-clipper/extension";
import { clipperViteConfig } from "@broberg/web-clipper/vite";
export default defineConfig(clipperViteConfig({
  manifest: defineClipperManifest({ name: "Trail Web Clipper", version: "0.3.0", apiHosts: ["https://app.trailmem.com/*"], geckoId: "trail-clipper@broberg.ai" }),
}));

// src/content.ts — import ONLY /content and your extractors here
import { runContentScript } from "@broberg/web-clipper/content";
runContentScript([myChatReader]);

// src/popup.tsx
import "@broberg/theme/css/palettes.css";
import "@broberg/web-clipper/css/clipper.css";
import { createBidAuth, extensionStorage } from "@broberg/web-clipper/auth";
import { clipActiveTab, CONTENT_SCRIPT_PATH } from "@broberg/web-clipper/extension";
import { ClipperPopup } from "@broberg/web-clipper/ui";
render(<ClipperPopup title="Trail" auth={createBidAuth({ issuer, clientId: "trail-clipper", audience, ticketScope })}
  destination={trail} getClip={() => clipActiveTab(CONTENT_SCRIPT_PATH)} storage={extensionStorage()} />, root);
```

- **Permissions:** `activeTab`, `scripting`, `identity`, `storage` — and `apiHosts` for your backend only. No page hosts: the content script is injected on click, never declared.
- **The content script must stand alone.** It runs as a classic script, so it cannot `import`; the build fails (naming the shared chunk) if it shares a module with the popup.
- **The popup** (Preact, `@broberg/theme` tokens, no native controls): log in, pick a target (custom listbox, keyboard included, remembered per destination), clip, and a status line that tells «log ind igen», «kunne ikke nå frem» and «afvist» apart. Every interactive element has a `clipper-*` data-testid.
- `examples/web-clipper` is a complete extension (`pnpm --filter web-clipper-example build` → `dist/`, load unpacked) plus the same popup served as a page for Lens (`preview`, :5200).

Coming next: the first release (F099.7), then Trail's clipper and a Jam prototype on it.
