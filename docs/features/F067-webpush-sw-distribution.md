# F067 — `@broberg/webpush`: own the service-worker half all the way to a usable file

**Status:** backlog · **Package:** `@broberg/webpush` · **Ships as:** v0.2.0

## Motivation

Two repos hand-wrote the same two service-worker handlers within a week of each
other. Neither did it out of ignorance — both knew the package exported them.

The reason is structural: **a service worker in `public/` is a static file.** It
is served straight to the browser, never passes through Vite/esbuild, and
therefore cannot `import` from `node_modules`. The package's `/sw` export, which
already contains exactly the right logic, is unreachable from the one place it is
meant to run.

cardmem then measured the fact that settles the design:

> `dist/sw.js` has **zero import lines**. 54 self-contained lines. The only thing
> preventing an unbundled service worker from using it is the last line:
> `export { handleNotificationClick, handlePush };`

So three loosely-scoped options collapse into one cheap one. There is no bundling
to do — it is another **output format** of something already built.

### What it costs to leave it

xrt81 bundles the package into their SW. Their built artifact contains **zero**
occurrences of `setAppBadge` — they are pinned to 0.1.0 and the badge arrived in
0.1.1. They discovered it by unpacking the tarball, not by reading their own
code. A hand-rolled build step does not remove the drift problem; it swaps
*"we drift from the package"* for *"we are frozen, and nothing says so."*

## Scope

**In scope**

1. **`dist/sw.global.js`** — the same code, classic-script format (no `export`),
   which assigns `self.BrobergWebPush = { handlePush, handleNotificationClick }`
   **and** attaches both listeners. Consumable three ways: copied into `public/`
   at build, served directly, or pulled in with `importScripts()`.
2. **Badge on a VISIBLE push** (cardmem's blocker). Today the badge is only set
   on the `silent` path, so the number on the icon does not move when the message
   arrives — only when it is read somewhere else. Payloads without the field are
   unaffected, so this is backwards-compatible.
3. **`navigate` fallback.** `openWindow` is only called when the payload carries
   `navigate`; with the app closed and the field absent, a tap does nothing.
4. **`createPushHandler({ defaultTitle, defaultNavigate, badgeOnVisible })`** —
   `handlePush` stays exactly as it is (no consumer breaks); the factory returns a
   configured listener. This is how the **Danish default title** gets fixed:
   `'Notifikation'` is a language choice hard-coded into a fleet package, and
   cardmem's product UI is English. Any default is a language choice, so the
   answer is a parameter, not a different constant.

**Non-goals**

- A new package. xrt81 first proposed moving the badge logic into its own npm;
  it is already here, and the problem was never where the code lived.
- Prescribing anyone's build. The point is that a consumer needs **no** build
  step; those who already have one keep it.
- Declarative Web Push. Safari 18.4+ renders `web_push` payloads without the
  worker ever running — that path is unaffected by everything here.

## The duplicate-notification trap (must be documented, not just built)

`addEventListener` is **additive**, so a global file that attaches its own
listeners does not prevent a consumer from keeping theirs. That sounds like a
feature and is a trap: **two `push` listeners both calling `showNotification`
produce two notifications.** The recipe must say, in the imperative: delete your
own push handler, keep the rest of your `sw.js`. Otherwise we trade a drift
problem for a duplicate problem.

## What each side got right — worth keeping in the record

Both copies of this logic contained a defect the other did not, and **neither
side could see its own**:

- **The package was wrong about rejection.** `nav?.setAppBadge?.(n)` guards a
  *missing* API and does nothing about a *rejecting* one. `setAppBadge` rejects on
  engines that expose it but refuse it, and a rejected promise handed to
  `waitUntil` fails the push event — so a badge that could not be set would throw
  the notification away. cardmem's hand-written copy had `.catch(() => {})`.
  Fixed in 0.1.2; the two rejection cases were proved RED first.
- **The copy was wrong about where the API lives.** cardmem tests
  `'setAppBadge' in self` and calls `self.setAppBadge(...)`; in a service worker
  it is on `self.navigator`. Their fallback branch is dead — and invisible,
  because the badge they see on the iPhone comes from the **declarative** payload
  that Safari renders without their code ever running. It looked right, so nobody
  looked.

That pair is the argument for the epic in one line: the shared half should live
where it can be tested once, because a consumer copy is only ever exercised by
the cases that consumer happens to hit.

## Reuse

Checked Discovery (`/api/search?q=service+worker`, `?q=push`, `?q=badge`) before
writing this. `@broberg/webpush` **is** the fleet's push primitive — there is
nothing to reuse and nothing to build alongside it; the work is to finish the
distribution of what it already owns. Sibling `@broberg/pwa` covers
install/update detection, a different concern, and must not grow push logic.
No new dependency: the classic build is a tsup format, not a bundler step.

## Rollout

- Ships as **0.2.0** — additive, but the visible-push badge changes observable
  behaviour for a payload that carries `app_badge`, and a minor on `0.x` means
  nobody is carried into it by an automatic update.
- **Blocked first:** 0.1.2 (the rejection fix) could not publish — `@broberg/webpush`
  has no npm Trusted Publisher (measured: no `dist.attestations` on 0.1.1, unlike
  `logger` and `lens-engine`). Either Christian configures it, or 0.1.2 goes out
  as a local bootstrap publish with a one-time code. That must be resolved before
  0.2.0 can follow the normal tag route.
- Consumers in order: cardmem (live-proven on the iPhone, so a regression is
  visible immediately), then xrt81 (a fresh setup that has never seen one land —
  the honest test of whether the recipe is usable by someone without cardmem's
  code in front of them).
