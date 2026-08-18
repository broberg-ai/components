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

## F067.6 — a notification with no text is built, sent, accepted and shows nothing

torrent-search-api, reporting their own bug after adopting 0.4.1. They had
written the sender in Danish:

```js
buildPayload({ titel: 'Ny film', tekst: '…', url: '/film/42' })
```

Measured against 0.4.1's dist:

```
danske feltnavne  -> {"web_push":8030,"notification":{}}
helt tomt objekt  -> {"web_push":8030,"notification":{}}
```

A structurally valid payload with **no content whatsoever**. It would be
encrypted, POSTed, accepted with a 201, delivered to the device, and rendered as
nothing. `sent` would count it. Every layer reports success.

### The part that generalises

**Their test survived four mutations.** In their words: the tests only looked at
the answer from `send()`, never at the body that went over the wire — so the
mutation *"swap to Danish field names"* came back **green**. It went red only
once they parsed the sent payload and required that both the classic and the
declarative form actually carried the text.

> **A test that only reads the return value cannot see an empty message.**

That is the same shape as this package's own falsely-green transport test
(`p256dh: 'p'`, rejected during encryption before a socket was ever opened) and
as `sent: 0` meaning two things. The instrument agreed with itself and disagreed
with reality.

### Why the package owns this and not the caller

TypeScript rejects `{ titel }` — but only for consumers that compile.
torrent-search-api is plain JS with no build step, and so are others. A package
that defends itself with types alone defends half its consumers (the F070
lesson, restated). And here the package can *see* the message is empty before it
sends anything.

### Scope

`send()` refuses a message with no `title` and reports it as **`kind: 'payload'`**
— the category that already means *stop, this is a code bug, retrying will not
help* — without touching the network. The reason names the expected fields, so a
consumer who wrote `titel` reads `title` in the error and the fix is one line.

**Non-goals.** `buildPayload` stays a pure builder and keeps building whatever it
is given; the gate belongs where delivery is attempted. `sendSilent` is untouched
— it carries no title by design, which is the whole point of a silent badge
update. And an empty `body` stays legal: a title-only notification is a real
thing.

## F067.7 — the last blind stretch: Apple accepted it, but did a phone ever show it?

**Status: interim. Scope is deliberately open — the design waits on a measurement
that is currently running.** Written now because the context is live, not because
the answer is known.

Offered by xrt81, who are the only consumers running this on real iPhones in
production, and who have already built a temporary version of it: a receipt
listener in the service worker that reported *ARRIVED ON DEVICE*.

### What we can and cannot see today

After 0.4.x the send path is observable end to end — right up to the push
service's `201`. What no layer reports is the part after that:

```
send() → encrypt → POST → Apple accepts (201) → ??? → phone → a human's eye
                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                                    still invisible
```

**That gap is exactly where F067.3 lived.** An icon URL answering `text/html`
made the notification render *nothing at all* on iOS — silently. The push had
provably arrived (`bytes:355`); it simply was not displayed. Every instrument we
own said success, and it cost xrt81 a full day.

So this is not a nice-to-have observability feature. It is the one remaining
place in this package where a total failure is indistinguishable from a success,
which is the defect class the whole F067 line has been closing.

### Open questions — to answer with data, not argument

1. **What does a receipt actually assert?** *Delivered to the worker* and
   *displayed to the user* are different claims, and the second is the one that
   was wrong in F067.3. A receipt that only proves the first would recreate the
   bug at a new layer — the package's own recurring failure.
2. **Where does it POST to?** The package is storage-agnostic and touches no
   database; a receipt needs an endpoint. That may make this a consumer-owned
   piece with a package-supplied helper rather than a package feature.
3. **What does it cost?** A receipt on every push doubles the request count and
   adds a write per notification. On a club of 13 that is nothing; the shape has
   to be honest about where it stops being nothing.
4. **Opt-in, certainly — but at which end?** Sender, worker, or both.
5. **Does it survive the thing it exists to catch?** A worker that fails to
   render also has to still send the receipt, or the signal disappears exactly
   when it matters.

### Sequencing — deliberately not now

xrt81's week-long measurement (13 subscriptions / 9 members / 11 iOS, logging
`kind` + `reason`) is running. It may well change what a receipt should carry: if
`kind` turns out to be the wrong cut, or `reason` texts are not stable enough to
group on, that lands in the same design.

**So: no design until their numbers are in.** Building it first would be guessing
at the shape of a thing we are two weeks from being able to measure — and this
package has spent four releases learning what guessing costs.
