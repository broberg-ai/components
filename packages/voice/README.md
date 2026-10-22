# @broberg/voice

Voice calls for 2–10 people, like a Slack huddle: the app decides who may enter a room, the audio goes through a self-hosted LiveKit media server (SFU) in the EU, and the browser gets mute, output mute, device choice, per-person volume, who-is-speaking and the participant list. Audio only. Epic F104.

```bash
npm i @broberg/voice
```

> **Status 0.1.0:** the package is tested against LiveKit's own SDKs (ticket and webhook signature verified with LiveKit's verifier; the browser half against a stand-in room). It has **not yet** been run against a real media server — that is F104.2 (the server in Fly `arn`, tested on iPhone, Android, 4G, a UDP-blocking network, 10 people, and a deploy in the middle of a call).

## Server — `@broberg/voice/server`

```ts
import { createRoomToken, verifyWebhook, VoiceError } from "@broberg/voice/server";

// POST /jam/:id/voice-token — check the person's access FIRST, then:
const token = await createRoomToken({
  apiKey: process.env.LIVEKIT_API_KEY!,
  apiSecret: process.env.LIVEKIT_API_SECRET!,
  room: `jam:${id}`,      // one room per ticket
  identity: user.id,      // the same person joining twice replaces the first connection
  name: user.name,
  // ttl: 600            // seconds the ticket can be used to ENTER (default 600, max 3600)
});

// POST /voice/webhook — join/leave from the media server. Pass the RAW body:
const event = await verifyWebhook(await req.text(), req.headers.get("authorization"), { apiKey, apiSecret });
if (event.event === "participant_joined") { /* … */ }
```

- **Listen-only (0.2.0):** `createRoomToken({ …, canPublish: false })` gives a ticket that can join and hear everyone but publish nothing — pair it with `joinVoice({ url, token, publish: false })`, which never opens the microphone (`call.muted` is `true`; `unmute()` would be refused by the server).
- The ticket admits to **one room**, may **only publish the microphone** (no camera, screen or data channel), and may listen to everyone in the room.
- Missing `apiKey`/`apiSecret` is refused (`VoiceError` `missing_credentials`) — LiveKit's SDK would otherwise silently fall back to `LIVEKIT_*` from the environment.
- Every rejection of a webhook (changed body, wrong secret, missing header) is `VoiceError` `invalid_webhook`.

## Browser — `@broberg/voice/client`

No `node:` imports. Call `joinVoice` from a click: browsers only let audio play after a user gesture.

```ts
import { joinVoice } from "@broberg/voice/client";

const call = await joinVoice({ url: "wss://voice.broberg.ai", token });

call.onParticipants((people) => render(people));     // [{ identity, name, isLocal }], at once and on every join/leave
call.onSpeaking((ids) => highlight(ids));            // who is speaking now, loudest first
await call.mute(); await call.unmute(); call.muted;  // your microphone
call.setOutputMuted(true);                           // silence everyone else …
call.setVolume(identity, 0.5);                       // … each person's own volume is kept and comes back on unmute
await call.setInputDevice(deviceId);                 // from navigator.mediaDevices.enumerateDevices()
await call.setOutputDevice(deviceId);
await call.leave();                                  // disconnects; no callback fires after this
```

- The microphone opens with **noise suppression, echo cancellation and auto gain** on.
- If joining fails — the microphone is refused, the ticket is rejected — `joinVoice` rejects AND disconnects first, so nobody is left in the room listening without a way to leave.
- Other people's audio is attached to hidden `<audio>` elements and removed when they leave.
- Reconnection after a network drop (ICE restart, resume) is LiveKit's own.
- The package draws no UI. If you build one, give every control a `data-testid`.
