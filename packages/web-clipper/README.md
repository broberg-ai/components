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

## `@broberg/web-clipper/auth` — BrobergID login from the extension (F099.5)

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

- **Run the login in the BACKGROUND (0.4.0).** Chrome closes a popup the moment it loses focus, and the login window takes focus — a login started in the popup dies before the tokens are stored (BrobergID says yes, the button still says «Log ind»; measured in Trail 12/10). So:
  ```ts
  // background.ts
  import { createBidAuth, serveLogin } from "@broberg/web-clipper/auth";
  serveLogin(createBidAuth(bidOptions));
  // popup.tsx — same bidOptions
  import { createBidAuth, popupAuth } from "@broberg/web-clipper/auth";
  <ClipperPopup auth={popupAuth(createBidAuth(bidOptions))} … />
  ```
  The popup asks, the background logs in and stores; closing the popup mid-login loses nothing, the next popup finds the session.
- A refused code exchange says the HTTP status and a short excerpt of BrobergID's answer (codes and tokens scrubbed), e.g. `BID refused the code (HTTP 400): http_400 redirect_uri mismatch…`.
- Needs the `identity` and `storage` permissions. Tokens live in `chrome.storage.local`, keyed by client id — two extensions never share a login.
- `session()` renews ahead of expiry. **Refused refresh** (the user's BID login ended) → `null` and the login is cleared → show «log ind igen». **BID not answering** → `BidUnavailableError`, the login is kept, and the sender reports `unavailable`, not a logout.
- With `audience`: the BID token is swapped for a 5-minute user ticket (BID F087.37), reused while valid, fetched anew when the sender forces a refresh after a 401. `session_ended` → `null`; a setup refusal (`no_rule_for_audience`, `scope_not_allowed`) → `BidTicketRefusedError` (the sender reports `refused`).
- The redirect is `chrome.identity.getRedirectURL()` = `https://<extension-id>.chromiumapp.org/` — BID matches it character for character, so the extension needs a FIXED id (manifest `key`).

## Draw your OWN popup: `/engine` (0.7.0, F099.12)

**The design belongs to the extension that uses this package, not to the package** (owner, 13/10). `/engine` is everything the popup DOES — log in, load and remember the target, clip, consent per conversation, send, report — with no element, no CSS and no text:

```ts
import { createClipper } from "@broberg/web-clipper/engine";   // framework-free
import { useClipper } from "@broberg/web-clipper/ui";           // the same, as a Preact hook

const [s, clipper] = useClipper({ auth: popupAuth(createBidAuth(opts)), destination, getClip: () => clipActiveTab(CONTENT_SCRIPT_PATH), storage: extensionStorage() });

s.phase.kind          // "checking" | "logged_out" (reason "login_again" | "login_failed", message) | "logging_in" | "ready"
s.targets, s.target   // where it can go; the chosen one (remembered per destination)
s.run                 // { kind: "idle" | "clipping" } | { kind: "done", result, clip } | { kind: "error", message }
                      //   result.sent = units sent · clip.completeness = { complete, reason } — show it when complete is false
s.consentFor          // a conversation that needs «record this conversation» → clipper.clip({ consent: true })
s.notAConversation    // consent needed but the page is no conversation — say so
clipper.login() · clipper.logout() · clipper.choose(id) · clipper.clip({ fields })
```

Your texts, your layout, your height. `ClipperPopup` (below) is one ready-made way to draw it — optional, and built on this same engine, so it behaves exactly like yours.

## The extension: `/extension`, `/content`, `/vite`, `/ui` (F099.6)

```ts
// vite.config.ts — a whole clipper from the shared build
import { defineConfig } from "vite";
import { defineClipperManifest } from "@broberg/web-clipper/extension";
import { clipperViteConfig } from "@broberg/web-clipper/vite";
export default defineConfig(clipperViteConfig({
  manifest: defineClipperManifest({ name: "Trail Web Clipper", version: "0.3.0", apiHosts: ["https://app.trailmem.com/*"], bidIssuer: "https://id.broberg.ai", geckoId: "trail-clipper@broberg.ai" }),
}));

// src/content.ts — import ONLY /content and your extractors here
import { runContentScript } from "@broberg/web-clipper/content";
runContentScript([myChatReader]);

// src/popup.tsx
import "@broberg/theme/css/palettes.css";
import "@broberg/web-clipper/css/clipper.css";
import { createBidAuth, popupAuth, extensionStorage } from "@broberg/web-clipper/auth";
import { clipActiveTab, CONTENT_SCRIPT_PATH } from "@broberg/web-clipper/extension";
import { ClipperPopup } from "@broberg/web-clipper/ui";
render(<ClipperPopup title="Trail" auth={popupAuth(createBidAuth({ issuer, clientId: "trail-clipper", audience, ticketScope }))}
  destination={trail} getClip={() => clipActiveTab(CONTENT_SCRIPT_PATH)} storage={extensionStorage()} />, root);
```

- **Permissions:** `activeTab`, `scripting`, `identity`, `storage`, your `apiHosts` (backend only) and BrobergID's origin from `bidIssuer` (0.3.0, required — its token endpoint sends no CORS headers, so login fails without it). No page hosts: the content script is injected on click, never declared.
- **The content script must stand alone.** It runs as a classic script, so it cannot `import`; the build fails (naming the shared chunk) if it shares a module with the popup.
- **Your own fields** (0.2.0, F099.8): `ClipperPopup({ fields: [{ id: "tags", label: "Emneord", placeholder: "kommasepareret" }] })` — a text input per field (`clipper-field-<id>`); the values reach your `send()` as `ctx.fields` (`{ tags: "…" }`). Never stored: a new popup starts empty. Without `fields`, `ctx.fields` is absent.
- **Chat readers (0.5.0, F099.9):** `runContentScript(chatReaders)` (from `/extract`) clips ChatGPT (`chatgpt.com/c/…`) and Claude (`claude.ai/chat/…`) as one unit per turn, anchor = the conversation id. They read the WHOLE conversation from the page's own data (signed in as the user; the thread on screen is `clip.units`, with no hidden tool/search messages; other branches come in `clip.branches` since 0.10.0), because the screen holds only ~8 messages of a long thread and a saved page has none. If the data cannot be read, they clip what is on screen and set `clip.completeness = { complete: false, source: "dom", reason }`; only a full read is `complete: true`. Shared ChatGPT links (`chatgpt.com/share/…`) carry the whole conversation in the page itself (no login needed) and are read complete from there (0.5.1, measured on a real shared link: 30 turns, where the screen showed 13); Claude share links are still read from the screen and marked incomplete. **Claude artifacts as files (0.6.0, F099.10):** every artifact a turn creates or changes (claude.ai's artifacts tool, and the file tools `create_file` / `str_replace`) is a `unit.assets[]` entry `{ type: "file", id, name, mime, language?, content, version }` — the file AS OF that turn (a change is applied to the previous version). The turn's text gets `[Artefakt: <title>]`, so a turn that is only an artifact is no longer dropped. `Asset.url` is now optional. Files the person attached are kept too (0.6.1): a message that is only an attachment stays its own turn (`[Bilag: name]`, the extracted text as a file) and an uploaded image is named (`[Fil: name]`). A message part the reader does not understand, or a change that cannot be applied, makes the clip `complete: false` with the reason — it is never silently skipped. Each clip REPLACES the content script's previous listener (0.5.1), so a reloaded extension works in an already-open tab without reloading it. **An append-only destination should hold back an incomplete chat clip:** its units are the visible TAIL numbered from 0, so their positions do not match the whole conversation and the chain would read as a new branch. A complete clip always has positions 0..n-1 for the whole thread, and the same thread gives byte-identical units on every read. Build your own reader on `htmlToMarkdown(html)` (exported from `/extract`) — the same conversion as the article extractor.
- **No silent skips (0.7.1, F099.13):** a Claude tool call the reader does not know — a code tool that writes files or renders images — makes the clip `complete: false` naming the tool. Only tools that read or search (`web_search`, `web_fetch`, `view`, …) are skipped. Files from the code tool itself come in 0.8.0. **What is missing (0.7.2):** an incomplete clip says `completeness.missing`: `"files"` = every turn was read whole and only a file is absent — keep the turns, show a file warning; `"turns"` = the turns themselves are not whole (read from the screen, or a part that may hold words was not understood).
- **The files themselves (0.8.0, F099.13):** files the conversation SHOWS but does not carry are fetched by the content script with the page's own session (your server never logs in to claude.ai / chatgpt.com) and arrive as `unit.assets[]`: `{ type: "file", id, name, mime, size, content }` — text as text, anything else (PNG, ZIP, MP4) with `encoding: "base64"`. Claude: every file in the Artifacts panel (what `present_files` handed over; a file presented more than once is fetched once, on its last turn) and uploaded images. ChatGPT: generated images and uploads (`image_asset_pointer`) and code-tool files (`sandbox:/mnt/data/…` links). The turn's text names each file (`[Fil: …]`, `[Billede: …]`). Limits: 25 MB per file, 60 MB per clip. A file that cannot be fetched or is over the limit is named in `completeness.reason` with `missing: "files"` — the turns are still whole. Not yet: ChatGPT canvas, files on shared links (named, `missing: "files"`). **0.8.1:** ChatGPT files now download (the download address is ChatGPT's own and needs the login — 0.8.0 got 403); a generated image is named by its own title; Claude takes the full list of files from what `present_files` was ASKED to hand over (0.8.0 read only the result, which names fewer); `completeness.problems[]` lists every problem and `reason` names them all; the reference popup says «Alle ture er gemt — N filer mangler» (neutral, `clipper-incomplete-files`) when only files are missing. **0.8.2 — missing files as DATA:** `completeness.missingFiles: { name, why, status?, tool? }[]` — every file the clip does not carry, never the first few. `why`: `no_url` · `http` (+`status`) · `network` · `no_download_url` · `too_large` · `clip_limit` · `unknown_tool` (+`tool`) · `unapplied`. Draw the message however your site wants; `reason` stays as plain text. **0.8.3:** a refused batch reports `sent` (how many units arrived before it); files up to 100 MB each / 300 MB per clip (configurable: `maxFileBytes`, `maxClipFileBytes` on the reader) — a file bigger than one extension message travels in parts and is reassembled by `clipActiveTab`; Claude: a `current_leaf` with replies after it is followed to the real end of the thread, and if a NEWER version of the conversation exists off the clipped thread the clip says `missing: "turns"`.
- **Gemini (0.12.0, F099.22):** `chatReaders` now includes `geminiReader` (`gemini.google.com/app/<id>`, also `/u/<n>/app/<id>` and Gems). One unit per turn (user lines; the answer as markdown), anchor = the conversation id, screen-reader labels left out. It reads the SCREEN — Gemini loads a conversation through Google's internal RPC, not yet measured — so the clip says `complete: false, source: "dom", missing: "turns"`: a long conversation keeps only part of itself on screen. Hold such a clip back the same way as any screen read.
- **Perplexity (0.13.0, F099.22):** `chatReaders` now includes `perplexityReader` (`perplexity.ai/search/<slug>`). One unit per turn — the question from `[data-message-bubble]`, the answer as markdown from `[data-renderer]` — anchor = the thread slug. Like Gemini it reads the SCREEN for now (`complete: false, source: "dom", missing: "turns"`): the thread's data call is known (GET /rest/thread/<slug>), the block holding the answer text is not yet measured.
- **Microsoft 365 Copilot (0.14.0, F099.22):** `chatReaders` now includes `copilotReader` (`copilot.cloud.microsoft/chat/conversation/<id>`). One unit per turn from `.fai-UserMessage` / `.fai-CopilotMessage__content` (answer as markdown); accessible headings, names and toolbars left out. SCREEN read, `complete: false, source: "dom", missing: "turns"` — Copilot's list is virtualised (only turns near the viewport exist) and its data call has not been seen.
- **Embedded login (0.15.0, F099.24):** `auth.embedded()` on the BidAuth from `createBidAuth` (and `popupAuth` passes it through) — the login INSIDE the popup against BID's F084.166 contract v1: no window, a 6-digit code by mail, then a second factor if the account has one (`totp` app code, or `sms` after `sendSms()`). A headless state machine — `state()`, `subscribe()`, `resume()`, `start(email)`, `verify(code)`, `sendSms()`, `verifySecondFactor(method, code)`, `resend()`, `restart()` — with `step: "email" | "code" | "second_factor" | "signed_in"`, `busy`, and `error` as data (`invalid_code {attemptsLeft}`, `expired`, `locked {retryAfter}`, `too_many_requests {retryAfter}`, `not_embedded`, `invalid_request`, `unavailable`). You draw the screen. It ends in the SAME stored Session as `login()` (the authorization code is swapped on /oauth2/token with the PKCE verifier and your first registered redirect). The flow lives in storage, so when Chrome closes the popup while the user reads their mail, call `resume()` on the next open and they are back on the code step. `expired` and `locked` end the flow (back to `email`); `not_embedded` means the client is not allowed — fall back to `login()`. No password is ever handled in the extension. NOT live yet: BID builds the endpoints after the owner approves its mockup.
- **Passkey login (0.17.0, F099.25):** `auth.embedded().passkeyStart()` — Face ID / fingerprint against BID's F084.166 contract v2, no mail code. The state goes to `step: "passkey"` with `frameUrl`: show `<iframe src={frameUrl} allow="publickey-credentials-get">` (~360×64) — BID's frame draws the button, because the tap must happen inside it. The engine listens for the frame's answer itself (only from the issuer's origin, only its own `flow_id`, only `type: "bid-embedded-passkey"`), completes the flow and swaps the code exactly like the mail code → `signed_in`, the same Session. `cancelled` leaves the step without an error (the frame's button is ready again); `not_found` / `failed` set `error: {kind: "passkey", reason}` on the step, and `start(email)` still works from there (mail code under «Andre muligheder»). A `frame_url` off BID's origin is refused. The flow survives a closed popup: `resume()` brings back the step and listens again. Pass `messages` to `createBidAuth` only if the frame posts somewhere other than the popup's own window. `EmbeddedLoginForm` does not draw this step — your screen does.
- **Le Chat reader (0.19.0, F099.22):** `lechatReader` / `createLeChatReader()` in `chatReaders` — chat.mistral.ai `/chat/<id>` and `/work/<id>`, read from the DATA (the same tRPC batch the page sends: `chat.byId,message.all,canva.all`), one unit per turn in order, text from `content` or the text chunks (tool calls left out), Le Chat's canvases as files on the answer that made them. Not guessed, NAMED in `completeness` instead: older versions of an edited message (the latest is on the line), a further page (`nextCursor`), attached files. No screen fallback — the sample only shows the answers' container.
- **Passkey first on the ready screen (0.18.0, F099.26):** `EmbeddedLoginForm` — and so `ClipperPopup` with `embeddedLogin` — now opens on the passkey after BID's approved mockup v2: BID's frame (`embedded-login-passkey-frame`), «Andre muligheder» (`embedded-login-other-options`) → the mail code with «← Log ind med adgangsnøgle» (`embedded-login-back-passkey`). A client BID gives no passkey (passkey/start refused: 403/404, or an older BID's 400) gets `error: {kind: "passkey", reason: "not_enabled"}` from the engine and the classic mail screen — never the window fallback. **Behaviour change** for `embeddedLogin` popups: the first screen is the passkey. The README line above about `EmbeddedLoginForm` not drawing the passkey step is superseded.
- **Embedded login screen (0.16.0, F099.24):** `EmbeddedLoginForm` and `CodeInput` in `/ui` draw `auth.embedded()` after BID's mockup 01a1409a — mail → six-box code (paste or one-time-code autofill into the first box fills all six) → second factor → signed in, plus «Vent lidt» (locked/too many, with BID's minutes) and «Ingen forbindelse» (with «Prøv igen»). Every control carries a `embedded-login-*` data-testid (the mockup's own). `ClipperPopup` logs in INSIDE the popup when you pass `embeddedLogin` (0.16.1: opt-in — 0.16.0 turned it on by itself, before BID serves the endpoints; skip 0.16.0); if BID answers `not_embedded` or 404 it falls back to the old window button by itself. One way to draw the engine — draw your own if your popup looks different. Lens-verified on examples/web-clipper `?state=embedded` (in-page contract-v1 BID).
- **Images from web pages (0.11.0, F099.23):** `createArticleExtractor({ images: true, maxImages, maxImageBytes, maxImageFileBytes?, minImageSize? })` from `/extract` — put it LAST in your extractor list (it matches every page). The page unit gets `assets` for the article's CONTENT images (`{ type: "image", url, alt, name, mime, size, width?, height?, encoding: "base64", content }`; an svg comes as text), fetched in the page with its own session, so images behind a login come too. `url` is exactly the address in the markdown's `![alt](url)` — point that reference at your stored file. Left out: `role=presentation`, `aria-hidden`, svg sprites (`#fragment`), and any image whose size (from the tag or measured from its PNG/GIF/JPEG/WebP header) is under `minImageSize` (64 px). The caps are YOURS to pass (owner 15/10: per Jam org); unset they are 50 images / 100 MB per clip. An image over a cap or that cannot be fetched is named in `completeness.missingFiles` (`clip_limit` / `too_large` / `http` / `network`), with `complete: false, missing: "files"` — the text is whole. `articleExtractor` itself is unchanged (text only).
- **Every branch (0.10.0, F099.21):** a conversation is a tree (an edited prompt, a «try again»). `clip.units` is still the thread on screen; `clip.branches?: Unit[][]` holds every OTHER line, each whole from root to leaf with positions 0..n-1 of its own. A stretch shared with the main line is the same units, so it fingerprints the same and the line forks where the conversation did. Absent when nothing branched (the popup can say «148 ture · 2 sidegrene» from `clip.branches.length`). `sendClip` sends the main line FIRST as before, then — to an `appendOnly` destination — each side line as ONE send of its WHOLE path, with `ctx.side = { index, of, from }` (`from` = the batch's first position; a long line still goes in batches). Diff it against what you hold: the shared stretch you have, the new units hang on the last link you share. A side line you already hold in full is skipped; implement the optional `heldKeys(anchor, target, session)` (every chain fp you hold for the anchor — the whole tree) so a re-clip knows, or each side line is resent per clip (harmless, keyed, but counted in `sent`). A destination that is not appendOnly gets one send of the main line, with the branches on `ctx.clip.branches`. A file shown on several lines is fetched once; a Claude artifact's versions follow their own line.
- **Big files stream straight to your storage (0.9.0, F099.20):** set `streamOverBytes` on the reader (Jam: 25 MB). A file over it is NOT put in the clip; it arrives as `{ type: "file", name, mime, size, transfer: "stream", streamRef }`. Then, in the extension: get `partsNeeded(asset.size, partSize)` presigned part addresses from YOUR server (`@broberg/media` 0.6.0: `multipart.create` + `presignPart`), call `streamAsset(asset, { partUrls, partSize })` from `/extension` — the page reads the file with its own session and PUTs it part by part (one part in memory at a time) — and finish on your server with `multipart.complete(etags)` (or `abort` if it threw). Parts ≥ 5 MiB except the last. The bucket's CORS must allow `PUT` from https://claude.ai and https://chatgpt.com and expose `ETag`; a part without a visible ETag fails with a message that says so.
- **One height (0.6.2):** the popup keeps the same height in every state (log in → clip → clipping → result). Set it in YOUR extension's CSS: `.bwc-popup { --bwc-popup-height: 480px }` (default 420px).
- **Never silent (0.5.0):** an incomplete clip shows `clipper-incomplete` with the reason; a consent destination on a page that is no conversation shows `clipper-not-a-conversation`; «Klippet · N sendt» says how many units went. `ClipperPopup({ text: { noTargets: "…" } })` replaces any of the popup's texts.
- **The popup** (Preact, `@broberg/theme` tokens, no native controls): log in, pick a target (custom listbox, keyboard included, remembered per destination), clip, and a status line that tells «log ind igen», «kunne ikke nå frem» and «afvist» apart. Every interactive element has a `clipper-*` data-testid.
- `examples/web-clipper` is a complete extension (`pnpm --filter web-clipper-example build` → `dist/`, load unpacked) plus the same popup served as a page for Lens (`preview`, :5200).

Coming next: the first release (F099.7), then Trail's clipper and a Jam prototype on it.
