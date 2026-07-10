# @broberg/soundkit

A tiny **browser audio-effect engine** — synthesized tones + noise via the Web
Audio API, optional MP3/Opus via Howler.js, a single typed `play(name)` over a
sound registry, and mute/volume persisted to `localStorage`. It handles the
browser **autoplay policy** for you (the `AudioContext` is created + resumed on
the first user gesture) and **ships dark**: with no Web Audio in scope it's an
inert no-op that never throws, so it's safe to construct anywhere.

Generalises the ~80-line Web Audio file independently hand-copied into buddy,
cms and catan.

```bash
npm i @broberg/soundkit
```

## Core (no framework)

```ts
import { createSoundKit } from "@broberg/soundkit";
import { UI_SOUNDS } from "@broberg/soundkit/presets";

const kit = createSoundKit(UI_SOUNDS);      // or your own registry
// … on a click / keydown somewhere in the app the engine warms up automatically
kit.play("success");
kit.toggleMute();                            // persisted to localStorage
kit.setVolume(0.5);                          // master volume, persisted
```

A **sound** is a step or an ordered sequence of steps — a tone, a noise burst,
or a file — each with an optional `delay` (ms) so you can compose little jingles:

```ts
const registry = {
  ping:  [{ freq: 880, duration: 0.2, type: "sine", volume: 0.15 }],
  chord: [
    { freq: 523, duration: 0.12, type: "sine" },
    { freq: 659, duration: 0.16, type: "sine", delay: 100 },
  ],
  tick:  [{ noise: 0.05, volume: 0.18 }, { freq: 300, duration: 0.08, type: "triangle" }],
  bell:  { file: "/sounds/bell.mp3", volume: 0.7 },   // needs the Howler layer
};
```

`play(name)` on an unknown name, before the first gesture, or with no Web Audio
present is always a safe no-op.

## File sounds (optional Howler layer)

`howler` is an **optional peer** — tone-only apps tree-shake it out. Enable file
playback by passing the Howler namespace (avoids a dynamic import):

```ts
import { Howl, Howler } from "howler";
const kit = createSoundKit(registry, { howler: { Howl, Howler } });
kit.play("bell");            // plays the MP3; mute() also calls Howler.mute()
```

Without Howler, `file` steps silently no-op while every tone/noise sound keeps working.

## React (Stack A)

```tsx
import { useSoundKit } from "@broberg/soundkit/react";
import { UI_SOUNDS } from "@broberg/soundkit/presets";

function Toolbar() {
  const sound = useSoundKit(UI_SOUNDS);
  return (
    <button data-testid="mute-toggle" onClick={sound.toggleMute} onMouseDown={() => sound.play("click")}>
      {sound.muted ? "🔇" : "🔊"}
    </button>
  );
}
```

The kit is created once (stable across re-renders); `muted`/`volume` are reactive
React state kept in sync with the engine, torn down on unmount. `react` is an
optional peer; no `next/*` import, so it works in any React app.

## Preact signals (Stack B)

```ts
import { useSoundKitSignals } from "@broberg/soundkit/preact";

const { kit, enabled, volume } = useSoundKitSignals(UI_SOUNDS);
enabled.value = false;   // mutes
volume.value = 0.4;      // sets master volume
kit.play("notify");
```

`enabled`/`volume` are `@preact/signals` wired to the engine via `effect()`
(the trail ambient-store pattern) and persisted to `localStorage`.

## Options

```ts
createSoundKit(registry, {
  storageKeyPrefix: "myapp-sound",   // localStorage keys, default "broberg-soundkit"
  initialVolume: 0.8,                // 0–1, used when nothing is persisted
  disabled: userPrefersSilence,      // force the kit inert (consumer policy)
  howler: { Howl, Howler },          // enable file playback
  // audioContextFactory / storage — injection seams for tests + custom hosts
});
```

## Presets

`UI_SOUNDS` (`success` · `notify` · `click` · `error`) is a small brand-neutral
starter set. buddy's severity tones and cms's publish/expire chimes ship as
exact-transcribed `BUDDY_SOUNDS` / `CMS_SOUNDS` presets when those apps adopt the
package (so their audio stays byte-identical post-migration).

## Notes

- **Autoplay policy** — audio can't start before a user gesture; the engine arms
  itself on the first `click`/`keydown`, so `play()` before any interaction is a
  no-op by design.
- **Zero runtime deps** — core is pure Web Audio; `howler`, `react`, `preact` and
  `@preact/signals` are all optional peers.
- **Not an ambient-stream engine** — this is for short UI/game SFX, deliberately
  separate from a long-running ambient audio provider.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
