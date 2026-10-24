# @broberg/nativepush

Push to **native apps** — Apple **APNs** and Google **FCM** (HTTP v1) — behind one
server-side sender. The sibling of [`@broberg/webpush`](../webpush) (Web Push / VAPID),
with the same contract:

- `send()` **never throws** into your request path;
- `dead` = tokens the platform says are gone for good — **the only list you may delete from**;
- `failed` = everything else, each with a `kind` (`auth` · `payload` · `transient`) — never delete these;
- `status` per platform at boot: `ready` · `no-keys` (deliberate dark ship) · `invalid-keys` (a bug).

Zero dependencies (`node:crypto`, `node:http2`, `fetch`). No database — you own the tokens.
The APNs half is ported from buddy (`apps/server/src/push/apns.ts`).

```ts
import { createNativePushSender } from "@broberg/nativepush";

const push = createNativePushSender({
  apns: {
    key: process.env.APNS_P8!,          // contents of AuthKey_<keyId>.p8, not a path
    keyId: process.env.APNS_KEY_ID!,
    teamId: process.env.APNS_TEAM_ID!,
    topic: "dk.buzz.app",               // bundle id
    production: process.env.APNS_PRODUCTION === "true",  // debug builds = sandbox
  },
  fcm: { serviceAccount: process.env.FCM_SERVICE_ACCOUNT! }, // the JSON, as a string
});

if (push.status.apns !== "ready") log.warn("iOS push dark:", push.statusReason.apns);

const r = await push.send(
  [{ platform: "ios", token: iosToken }, { platform: "android", token: androidToken }],
  {
    title: "Alarm: pumpe 3",
    body: "Tryk for at kvittere",
    data: { alarmId: "a1" },
    level: "critical",                          // needs Apple's Critical Alerts entitlement
    sound: { critical: true, volume: 1 },
    mutableContent: true,                       // let a Notification Service Extension rewrite it
    collapseId: "a1",
    ttlSeconds: 300,
    android: { dataOnly: true },                // the app shows its own full-screen alarm
  },
);

await db.deleteTokens(r.dead);                  // ONLY these
for (const f of r.failed) log.warn(f.platform, f.kind, f.statusCode, f.reason);
if (r.allFailed) alarm("push is down — check the keys");
```

**Without the Critical Alerts entitlement** send `level: "time-sensitive"` with a normal
`sound: "default"` — it breaks through Focus (the app needs the Time Sensitive capability)
but not silent mode. With `level: "critical"` and no entitlement, iOS delivers an ordinary alert.

## What lands where

| Answer | Result |
|---|---|
| APNs 200 · FCM 200 | `sent` |
| APNs **410** Unregistered · FCM **UNREGISTERED** | `dead` — delete |
| APNs 401/403 · FCM 401/403 (incl. SENDER_ID_MISMATCH) · no/invalid keys | `failed`, `auth` — fix the config |
| APNs 400 (incl. **BadDeviceToken**) / 413 · FCM 400 | `failed`, `payload` |
| 429, 5xx, network, timeouts | `failed`, `transient` — retry later |

`BadDeviceToken` is deliberately **not** dead: it is what a sandbox token sent to production
(or the reverse) answers, and deleting on it would empty your table over one config flag.

## Details

- APNs: one ES256 provider token per sender, reused for 50 minutes; one HTTP/2 connection per
  `send`. `level: "passive"` goes at priority 5, everything else at 10.
- FCM: the service account signs an RS256 JWT for an OAuth token, cached until five minutes
  before it expires. `android.priority` is always `high`. `dataOnly` copies title/body into `data`.
- FCM `data` values must be strings.
