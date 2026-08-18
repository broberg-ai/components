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

## F067.5 — `sent: 0` cannot tell "nobody subscribed" from "every send failed"

Found by **torrent-search-api**, who did not report a bug: they asked whether the
package had a trap of the `MAIL_LIVE` family — *something that returns ok without
actually delivering*. It does.

Measured against `dist/` at 0.3.1, with a real VAPID keypair and an unreachable
endpoint standing in for any non-`404/410` failure:

```
0 subscribers        -> {"sent":0,"dead":[]}
1 failing subscriber -> {"sent":0,"dead":[]}
```

**Byte-identical**, for two situations that could not be more different. The
first is nothing to do; the second is a delivery failure affecting every
recipient.

`fanOut` isolates per-subscription failures so a push can never break the
caller's request path — which is right, and stays. But the isolation currently
goes one step further than it should: only `404`/`410` survive into `dead`, and
**every other status is swallowed with no trace at all**. `SendResult` has two
fields and there is nowhere for a failure to go.

### Why this is the expensive kind

The statuses that vanish are the ones you most need to see:

- **`401` / `403` — the VAPID keys are wrong.** Not transient, not partial:
  *every* push fails, forever, and the sender reports `sent: 0` exactly as it
  would on a quiet day. A misconfigured deploy is indistinguishable from an app
  nobody has subscribed to yet.
- **`5xx` / network / TLS** — the push service is down or unreachable. Worth
  retrying; today it is unknowable.
- **`413`** — payload too large. A code fix, silently discarded.

And the failure is shaped to hide: a new PWA legitimately *starts* with zero
subscribers, so `sent: 0` reads as normal during exactly the window when the
wiring is most likely to be wrong.

> This is the same defect the fleet has been pulling out all week, one layer
> along: **an answer that collapses two different facts.** `@broberg/mail` grew
> `mode` because three conditions all returned `{ok:true, skipped:true}`;
> `@broberg/seti-client` grew a third outcome because a timeout is a measurement
> and not a fact about delivery; `lens-engine` grew `no-verdict` because the
> absence of an answer was being read as one. Here, the absence of a *failure*
> is being read as the absence of *work*.

### The shape of the fix

`SendResult` gains `failed` — the sends that neither succeeded nor were gone —
carrying enough to act on: endpoint, status code where there was one, and a
reason. `sent` and `dead` keep their current meaning, so no consumer breaks; a
caller that ignores the new field is exactly as correct as it is today.

Two things to decide by measuring rather than by argument:

- **Whether a permanent config failure (`401`/`403`) deserves to be separable
  from a transient one.** They call for opposite responses — one is "fix your
  deploy", the other is "retry later" — and a caller that cannot tell them apart
  will either retry forever or alarm on a blip.
- **Whether a sender with subscriptions and a 100% failure rate should be able
  to say so loudly.** A boot-time readback in the shape of `mailer.mode` does not
  fit (there is nothing to check until you actually send), so the signal has to
  live in the result.

**Non-goal: throwing.** The never-throws contract is load-bearing — `send()` is
designed to be safe to `void` from inside a request handler, and consumers do.
The fix is to make the failure *visible*, not to make it *fatal*.
