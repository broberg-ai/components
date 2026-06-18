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

```js
import { handlePush, handleNotificationClick } from '@broberg/webpush/sw';
self.addEventListener('push', handlePush);
self.addEventListener('notificationclick', handleNotificationClick);
```

## What you still own

Subscriptions table, per-user notification prefs, notification history, dead-
endpoint pruning, and the brand-styled enable/disable UI. This package is the
delivery primitive, not the product surface.

---

Ships compiled `dist/` (ESM + CJS + `.d.ts`) via tsup; four entry points
(`.` · `./client` · `./sw` · `./types`). Owner: `broberg-ai/components`. Pilot
consumer: **cardmem** (F162/F163).
