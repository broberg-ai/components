# @broberg/webpush

Storage-agnostic **Web Push** core for the broberg.ai fleet. One hard part done
once: shape a declarative + classic payload and fan it out over VAPID without
ever throwing into your request path — plus the browser subscribe/badge helpers
and the service-worker handlers.

**Scope:** Web Push only (VAPID · browser `PushManager` · PWAs). **NOT** native
push — APNs/FCM for native iOS/Android apps is a different channel (see a future
`@broberg/nativepush`). Web Push works in any modern browser; iOS additionally
requires the PWA be installed to the home screen.

The package **never touches your database.** You fetch subscriptions, gate on the
user's prefs, persist history, and prune the dead endpoints `send()` returns.

> ### Prerequisite: a secure context. Check this before you plan anything.
>
> A service worker cannot be registered outside a **secure context**, and no part
> of Web Push works without one. That means:
>
> | origin | works |
> | --- | --- |
> | `https://…` | yes |
> | `http://localhost` · `http://127.0.0.1` | yes — treated as trustworthy |
> | **`http://192.168.x.x`** · any bare LAN IP | **no** |
> | `http://` anything else | no |
>
> The LAN row is the one that surprises people. A dev server you reach from your
> own machine on `localhost` registers fine; **the same server reached from a
> phone on the same wifi does not**, because the phone uses the IP. So a
> LAN-only tool with no domain is excluded from Web Push entirely — not by this
> package, by the platform — and no amount of configuration changes it. The fix
> is an HTTPS origin (a tunnel, a real hostname with a cert), not a flag.
>
> Raised by torrent-search-api, who reach their tool at `192.168.x.x:7734` from
> an iPhone and would otherwise have found this out halfway through building.

## Server

```ts
import { createPushSender, generateVapidKeys } from '@broberg/webpush';

// once, offline: store privateKey as a secret, ship publicKey to the client
const { publicKey, privateKey } = generateVapidKeys();

const pusher = createPushSender({ publicKey, privateKey, subject: 'mailto:you@example.com' });

// in a request handler — never blocks, never throws:
const { sent, dead } = await pusher.send(subscriptions, {
  title: 'Ny Inbox-item',
  body: 'En mail landede i dit projekt',
  navigate: 'https://app.example.com/inbox?p=acme#idea=123',
  badge: unseenCount, // OS app-badge number
});
await pruneEndpoints(dead); // your DB
```

**Silent badge sync** — a data-only push that updates the OS app-badge with **no
banner** (for cross-device read-sync: when a user clears a notification on one
device, the other closed PWAs count their badge down silently). It carries no
title/body and is NOT sent as declarative Web Push, so Safari 18.4+ doesn't
auto-render it; the SW handler calls `setAppBadge` (badge `0` clears it):

```ts
await pusher.sendSilent(otherDeviceSubs, { badge: remainingUnread });
```

Wire the SW once — `handlePush` already branches on the silent payload:

```ts
import { handlePush } from '@broberg/webpush/sw';
self.addEventListener('push', handlePush); // visible + silent both handled
```

Ship-dark: hold `createPushSender` behind a "VAPID env present?" check — no keys,
no sender, no-op.

> ### ⚠️ `sent: 0` used to mean two different things (fixed in v0.4.0)
>
> Until 0.4.0, `send()` returned `{ sent, dead }` and quietly discarded every
> failure that was not a `404`/`410`. Measured on 0.3.1:
>
> ```
> 0 subscribers        -> {"sent":0,"dead":[]}
> 1 failing subscriber -> {"sent":0,"dead":[]}
> ```
>
> **Byte-identical**, for "nothing to do" and "every single send failed." The
> statuses that vanished were the ones you most need: `401`/`403` means the VAPID
> credentials are wrong, so *every* push fails and every future one will too —
> reported exactly as a quiet day is reported. And a new PWA legitimately starts
> at zero subscribers, so the reading looks normal during precisely the window
> when the wiring is most likely to be wrong.
>
> ### ⛔ Only `dead` may be deleted from. Never `failed`.
>
> Read this before you write the handler. Every consumer already has the habit
> *`dead` → delete the rows*, and **failed** reads like *did not work, clean up* —
> but when the VAPID keys are wrong, `failed` is **every subscriber you have**. One
> typo in a secret would delete an app's entire push table, and fixing the key
> afterwards would not bring them back: every user would have to re-subscribe, on
> every device. `dead` is churn; `failed` is for logging, alarming and retrying.
>
> *(Raised by xrt81, who run this on real iPhones in production.)*
>
> ```ts
> const { sent, dead, failed, allFailed } = await sender.send(subs, msg);
>
> for (const e of dead) await db.deleteSubscription(e);   // churn — the ONLY delete
>
> if (allFailed) {
>   // Nothing got through and nothing was merely gone. In practice this is what
>   // a wrong VAPID key looks like from the outside. Alarm; do not delete.
> }
> ```
>
> `allFailed` is `failed.length > 0 && sent === 0` — something was attempted and
> none of it landed. An empty send is not an outage, and pure churn stays quiet
> because a batch of 410s carries no failures at all.
>
> **It deliberately does NOT require `dead` to be empty.** The first version did,
> and xrt81 measured what that costs on a real fleet: 13 subscriptions, 2 handsets
> replaced (410) and 11 failing on auth gave `allFailed: false` — a total outage,
> silent again, on exactly the day someone gets a new phone *and* the key is
> wrong. A batch is a whole user base at once and churn never stops, so that is a
> coincidence waiting rather than a rare one. The question is *did anything get
> through*, not *was the batch pristine*.

> ### ⚠️ A message with no `title` is refused (v0.5.0)
>
> Send a message whose `title` is missing or blank and you get
> `kind: 'payload'` for every subscription, with no network call — instead of a
> notification that **arrives, renders blank, and errors nowhere**.
>
> ```js
> // Reported by torrent-search-api against their own sender:
> buildPayload({ titel: 'Ny film', tekst: '…', url: '/x' })
> // -> {"web_push":8030,"notification":{}}     structurally valid, no content
> ```
>
> Encrypted, POSTed, accepted with a 201, delivered, rendered as nothing — and
> counted in `sent`. TypeScript rejects `{ titel }`, but only for consumers who
> compile, and plenty of the fleet is plain JS with no build step.
>
> An empty `body` is still legal (a title-only notification is a real thing), and
> `sendSilent()` is untouched — it carries no title by design. `buildPayload`
> remains a pure builder; the gate lives where delivery is attempted.
>
> **And the lesson from how it was found is worth more than the rule.** Their test
> suite survived four mutations of this bug, because it only ever asserted on the
> answer from `send()` — never on the body that went over the wire. *A test that
> only reads the return value cannot see an empty message.* This package's suite
> had the same blind spot and now asserts the wire payload directly.
>
> | `kind` | statuses | what to do |
> | --- | --- | --- |
> | `auth` | 401, 403 | Stop. Fix the VAPID credentials — every send is failing. |
> | `payload` | 400, 413 | Stop. Fix the message; it is a code bug. |
> | `transient` | 429, 5xx, DNS/TLS/offline, anything unrecognised | Retry later. |
>
> Each entry carries `endpoint`, `statusCode` and `reason`. **Branch on `kind`,
> never on `reason`.** Unrecognised codes fall to `transient` deliberately: an
> unknown permanent fault then costs some wasted retries, where the opposite
> default would silently stop retrying something that would have worked.
>
> **Two shape guarantees, both asked for by a consumer and both worth relying on:**
> `failed` is ALWAYS an array — empty on a clean run and on an empty send, never
> `undefined`, so `result.failed.length` needs no `?? []`. And `statusCode` is
> ALWAYS PRESENT, `null` when there was no HTTP response at all (a transport
> failure, or a config fault caught before the request). `null` rather than an
> absent key, because an absent key cannot be told apart from a package version
> that has no such field. Do not write `f.statusCode >= 500` without checking it.
>
> `sent` and `dead` are unchanged, so a caller that ignores `failed` is exactly as
> correct as it was — and exactly as blind. **`send()` still never throws**; that
> contract is load-bearing and sealed by a test. A failure is made *visible*, not
> *fatal*.
>
> ### Know at boot, not at the first notification
>
> ```ts
> const sender = createPushSender({ subject, publicKey, privateKey });
>
> if (sender.status !== 'ready') {
>   // 'no-keys'      — nothing configured. Expected when push ships dark.
>   // 'invalid-keys' — configured, and web-push rejects it. Always a bug.
>   console.warn('push not sending:', sender.statusReason);
> }
> ```
>
> Three states rather than a boolean, because two of them mean opposite things: a
> dark-shipped environment and a broken deploy must not look alike. The check uses
> **web-push's own validation**, so the readback cannot disagree with the send it
> predicts.
>
> A sender that is not `ready` short-circuits: every subscription comes back as
> `kind: 'auth'` **without touching the network**. Before 0.4.0 a missing subject
> surfaced as `kind:'transient'` — telling the caller to retry the one thing
> retrying can never fix.
>
> Raised by torrent-search-api, who asked whether this package had a trap of the
> `MAIL_LIVE` family instead of waiting to be bitten by one — and who then found
> the "always with" claim above contradicting its own example, and asked for the
> boot readback.

## Client

```ts
import {
  pushSupported, subscribeToPush, unsubscribeFromPush, syncBadge, isIOSStandalone,
} from '@broberg/webpush/client';

// in a user-gesture handler, after Notification.requestPermission() === 'granted':
const sub = await subscribeToPush(vapidPublicKey);
await fetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });

// on app load + window focus:
syncBadge(await fetchUnseenCount());
```

> ### ⚠️ Writing your own `push` listener? Read THESE field names.
>
> `buildPayload()` puts the same notification on the wire twice, so either path
> renders it:
>
> ```jsonc
> {
>   "web_push": 8030,                                    // declarative — Safari 18.4+
>   "notification": { "title": …, "body": …, "navigate": …, "app_badge": … },
>   "title": …, "body": …, "navigate": …,                // classic SW handler
>   "badge": …, "icon": …, "tag": …
> }
> ```
>
> **A hand-written listener that reads its own field names gets an empty
> notification and no error.** It arrives, it renders, the text is blank, and
> every layer reports success. Sender and receiver must agree on the format — use
> `@broberg/webpush/sw` and the question does not arise.
>
> *(Raised by torrent-search-api, whose first listener did exactly this.)*

## Service worker

If your `sw.js` goes through a bundler:

```js
import { handlePush, handleNotificationClick } from '@broberg/webpush/sw';
self.addEventListener('push', handlePush);
self.addEventListener('notificationclick', handleNotificationClick);
```

### If your service worker is a static file in `public/` (v0.2.0)

It is served straight to the browser, never reaches the bundler, and **cannot
import from `node_modules`.** That is why two repos ended up hand-writing copies
of these handlers. Use the classic build instead — no import, no export:

```jsonc
// package.json — copy it next to your worker at build time
"scripts": {
  "prebuild": "cp node_modules/@broberg/webpush/dist/sw.global.js public/"
}
```

```js
// public/sw.js
importScripts('/sw.global.js');   // listeners are attached for you

// Changing a default? Use configure() — never add a second listener.
BrobergWebPush.configure({ defaultTitle: 'Notification' });

// …keep your own non-push logic here.
```

**`configure()` replaces what the single registered listener calls.** That is the
whole point of it: the file attaches exactly ONE `push` listener for the lifetime
of the worker, so configuring cannot produce a duplicate. Calling
`createPushHandler()` yourself and registering *that* re-opens the trap — you
would then have this file's handler and yours, both calling `showNotification`.

It also exposes `self.BrobergWebPush = { configure, createPushHandler, handlePush, handleNotificationClick }`
for tests and for anyone deliberately wiring things by hand.

> ### ⚠️ DELETE YOUR OWN `push` HANDLER WHEN YOU ADOPT THIS
>
> `addEventListener` is **additive**. This file's listener does not replace
> yours — it runs *alongside* it, and **two handlers both calling
> `showNotification` produce two banners per push.** It will hit you exactly
> when you believe you are cleaning up. Remove yours in the same change.
>
> **"Your own" includes one you did not write.** A handler inherited from a PWA
> template, or registered by another package, counts and is the harder case —
> there is no error, only two banners. Before you adopt, grep everything that
> ends up in your worker:
>
> ```bash
> grep -rn "addEventListener('push'\|addEventListener(\"push\"" src public
> ```
>
> **On `skipWaiting: false`** (serwist/next-pwa default in several fleet repos):
> a new worker *waits* rather than reloading someone mid-action, so the worker
> handling a push may be the OLD one until the user updates. Two versions of the
> handler live side by side for a while — harmless in itself, but it means a
> change to titles, badges or click targets does not land for everyone at once.

### Configuring the defaults

`handlePush` works with no configuration. When you need to change something —
most often the title, because `'Notifikation'` is Danish and your product may
not be — build your own listener instead of copying the file:

```js
import { createPushHandler } from '@broberg/webpush/sw';
self.addEventListener('push', createPushHandler({ defaultTitle: 'Notification' }));
```

| option | default | what it does |
| --- | --- | --- |
| `defaultTitle` | `'Notifikation'` | title when the payload carries none |
| `defaultNavigate` | `'/'` | where a tap goes when the payload names no destination — without it a tap opens *nothing* |
| `badgeOnVisible` | `true` | sync the OS badge on a **visible** push too, so the number moves when the message arrives rather than when it is read elsewhere |
| `defaultIcon` | *(none)* | icon when the payload carries none. **No default on purpose** — see below |
| `defaultBadgeIcon` | *(none)* | the small monochrome image, when the payload carries none |

> ### ⚠️ An icon URL that returns HTML renders NOTHING on iOS — silently (v0.3.0)
>
> Until 0.3.0 this package **guessed** `/icon-192.png` for both the icon and the
> badge, and the badge could not be overridden at all. xrt81 lost a full day to
> it. Their icons live under `/icons/`, so the guessed path fell through to their
> SPA's catch-all and returned `index.html` — **200 OK, `content-type: text/html`**.
>
> A notification whose icon resolves to an HTML document **is not rendered at
> all on iOS/Safari**, and nothing reports it. Chrome on a Mac renders the same
> notification without an icon — so their Mac "worked" all day while the iPhone
> stayed silent, and it looked like a phone problem. The server, Apple's `201`
> and the delivery all reported success. An in-worker probe is what finally
> proved the push had *arrived* (`bytes:355`) and simply was not displayed.
>
> **So a Mac that works proves nothing about a phone — and ARRIVAL proves
> nothing about DISPLAY.** That second half is xrt81's, and it is the sharper
> one: their in-worker probe was the right instrument, it answered honestly, and
> it still did not answer the question they needed. "It arrived" and "it was
> shown" are two claims, and every layer they could see reported only the first.
>
> Check your own path:
>
> ```bash
> curl -sI https://your.app/icons/icon-192.png | grep -i content-type
> #   image/png   → good
> #   text/html   → your notifications are invisible on iOS
> ```
>
> 0.3.0 emits **no** `icon`/`badge` key unless you supply one. The browser then
> uses its own — visibly imperfect, never invisible. Guessing turned a cosmetic
> omission into total silent failure on the platform where push matters most.

**Payload fields:** `icon` (unchanged) and **`badgeIcon`** for the small
monochrome image. It is deliberately *not* called `badge` — that field already
means the OS app-badge **count**, and an image and a number cannot share a name.

### Cold start no longer reports a subscribed user as unsubscribed (v0.3.0)

`subscribeToPush` waited for the service worker (`ready`) while `getSubscription`
asked for it immediately (`getRegistration`), which answers `undefined` while the
worker is still starting. Two functions answering the same question two ways —
so on every cold start a subscribed user's settings UI showed **off**. xrt81's
owner switched it back on and they went hunting a subscribe bug that did not
exist. A wrong *no* sends the debugging somewhere else.

`unsubscribeFromPush` was quietly broken by the same thing: it goes through
`getSubscription`, so an unsubscribe during a cold start no-opped and returned
`null` — the toggle went off and **the server was never told to forget the
endpoint**, so the pushes kept coming.

Both now share `resolveRegistration()`, exported if you need it. It waits for a
starting worker but is **bounded** (`REGISTRATION_TIMEOUT_MS`, 3 s) and returns
`null` rather than hanging — because `ready` never resolves when no worker is
registered at all, and trading a wrong answer for *no* answer would have been
worse.

All three default to the working value on purpose. A fix that ships behind a
flag reaches only the people who read changelogs — which is the people who did
not need it. If you send no `badge` in a payload, `badgeOnVisible` cannot affect
you; there is a test that proves exactly that rather than asserting it.

## What you still own

Subscriptions table, per-user notification prefs, notification history, dead-
endpoint pruning, and the brand-styled enable/disable UI. This package is the
delivery primitive, not the product surface.

---

Ships compiled `dist/` (ESM + CJS + `.d.ts`) via tsup; four entry points
(`.` · `./client` · `./sw` · `./types`). Owner: `broberg-ai/components`. Pilot
consumer: **cardmem** (F162/F163).
