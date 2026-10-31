# @broberg/call

Voice calls for 2–10 people, like a Slack huddle: the app decides who may enter a room, the audio goes through a self-hosted LiveKit media server (SFU) in the EU, and the browser gets mute, output mute, device choice, per-person volume, who-is-speaking and the participant list. Camera and screen share since 0.2.0 (opt-in per ticket). Epic F104.

```bash
npm i @broberg/call
```

> **Renamed from `@broberg/voice` (F104.6).** `@broberg/call` 0.1.0 is `@broberg/voice` 0.2.0 under a new name — same API, same server. Moving over means changing the import path only: `@broberg/voice/server` → `@broberg/call/server`, `@broberg/voice/client` → `@broberg/call/client`. Camera and screen share arrived in 0.2.0 (F104.7); recording is planned (F104.9).
>
> **Server:** the shared LiveKit media server `broberg-voice` (Fly `arn`, voice.broberg.ai, F104.2) with TURN over TLS on 443 in `broberg-voice-turn` (F104.5); both owned by components.

## Server — `@broberg/call/server`

```ts
import { createRoomToken, verifyWebhook, VoiceError } from "@broberg/call/server";

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
- The ticket admits to **one room**, may **only publish the microphone** unless you pass `sources` (never the data channel), and may listen to everyone in the room.
- **Camera and screen share (0.2.0):** `createRoomToken({ …, sources: ["microphone", "camera", "screen_share", "screen_share_audio"] })` — the ticket allows exactly the sources named. Leave `sources` out and it is microphone-only, as before, so an app that never asks for video keeps a sound-only ticket. Empty or unknown sources, and `sources` together with `canPublish: false`, are refused (`VoiceError` `invalid_sources`).
- Missing `apiKey`/`apiSecret` is refused (`VoiceError` `missing_credentials`) — LiveKit's SDK would otherwise silently fall back to `LIVEKIT_*` from the environment.
- Every rejection of a webhook (changed body, wrong secret, missing header) is `VoiceError` `invalid_webhook`.

## Browser — `@broberg/call/client`

No `node:` imports. Call `joinVoice` from a click: browsers only let audio play after a user gesture.

```ts
import { joinVoice } from "@broberg/call/client";

const call = await joinVoice({ url: "wss://voice.broberg.ai", token });

call.onParticipants((people) => render(people));     // [{ identity, name, isLocal }], at once and on every join/leave
call.onSpeaking((ids) => highlight(ids));            // who is speaking now, loudest first
await call.mute(); await call.unmute(); call.muted;  // your microphone
call.setOutputMuted(true);                           // silence everyone else …
call.setVolume(identity, 0.5);                       // … each person's own volume is kept and comes back on unmute
await call.setInputDevice(deviceId);                 // from navigator.mediaDevices.enumerateDevices()
await call.setOutputDevice(deviceId);
await call.leave();                                  // disconnects; no callback fires after this

// 0.2.0 — camera and screen share (the ticket must allow them, see `sources`)
await call.setScreenShare(true);                     // the browser asks which screen/window/tab; { audio: true } offers tab sound
await call.setCamera(true, { deviceId });            // deviceId optional
call.localMedia;                                     // { camera, screenShare } — what you send now
call.onLocalMedia((m) => setButtons(m));             // at once + on every change, INCLUDING the browser's own «stop sharing» button
call.onVideos((videos) => renderTiles(videos));      // [{ id, identity, name, isLocal, source: "camera"|"screen_share", attach(el), detach(el) }]
videos[0].attach(videoEl);                           // sets autoplay + playsinline; your own picture is muted
call.setAudioOnly(true);                             // weak connection: stop receiving others' video, keep sound
```

- The microphone opens with **noise suppression, echo cancellation and auto gain** on.
- If joining fails — the microphone is refused, the ticket is rejected — `joinVoice` rejects AND disconnects first, so nobody is left in the room listening without a way to leave.
- Other people's audio is attached to hidden `<audio>` elements and removed when they leave.
- Reconnection after a network drop (ICE restart, resume) is LiveKit's own.
- **2–10 people with video:** the room runs with simulcast (each camera is sent in several sizes), adaptive stream (you only receive the size your tile shows) and dynacast (sizes nobody watches are paused) — `VIDEO_ROOM_OPTIONS`. Video is never added to the page by the package; the app places each picture with `attach`.
- The package draws no UI. If you build one, give every control a `data-testid`.
