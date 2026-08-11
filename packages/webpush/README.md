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
// …keep your own non-push logic here.
```

It also exposes `self.BrobergWebPush = { handlePush, handleNotificationClick, createPushHandler }`
if you would rather wire them yourself.

> ### ⚠️ DELETE YOUR OWN `push` HANDLER WHEN YOU ADOPT THIS
>
> `addEventListener` is **additive**. This file's listener does not replace
> yours — it runs *alongside* it, and **two handlers both calling
> `showNotification` produce two banners per push.** It will hit you exactly
> when you believe you are cleaning up. Remove yours in the same change.

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
