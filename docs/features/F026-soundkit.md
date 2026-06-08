# F026 — SoundKit — synthesized & file-based audio effects for browser apps

> L3 Domain · runtime-package · effort **M** · impact **medium** · owner `buddy`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A zero-dependency (or optional Howler.js) audio-effect engine running entirely in the browser via the Web Audio API. It handles the browser autoplay policy (lazy AudioContext gated on first user gesture), plays synthesized tones through oscillator+gain chains, optionally plays MP3/Opus assets via Howler.js, and exposes a single typed playSound(name) call + mute/volume controls persisted in localStorage. NOT an ambient-background-stream engine (that's trail's AmbientProvider, a different concern).

## Solution
**runtime-package.** The same Web Audio pattern (lazy AudioContext warm-up on first gesture, oscillator+gain beep, mute persisted to localStorage) appears verbatim in buddy/sounds.ts, cms/notification-sound.ts, catan/sounds.ts — three independent repos copy-owning a ~80-line file. Every new app copies it again. The core is stable (Web Audio is settled), the mute/volume contract is identical, and the only divergence is the SOUND NAME REGISTRY (the app-specific extension point). runtime-package justified.

## Scope

### In scope
- Extract from `cbroberg/catan-multi-player` `packages/app/lib/sounds.ts`.
- Headless core (AudioEngine + createSoundKit) + Howler optional layer + React hook + Preact-signals adapter + BUDDY_SOUNDS/CMS_SOUNDS presets.

### Out of scope
- trail AmbientProvider (ambient-stream concern — stays separate).
- Per-app sound registries (the extension point; presets ship as examples).

## Architecture

### Best source (reference implementation)
`cbroberg/catan-multi-player` — `packages/app/lib/sounds.ts`: cleanest dual-layer — Web Audio oscillator+noise synth (playTone/playNoise) + Howler.js MP3 (getHowl), typed SoundName union, single playSound(name) dispatch table, mute/toggleMute via localStorage + Howler.mute() sync. buddy/sounds.ts has the best gesture-gating (one-time document listener) but narrower; catan is the structural template.

### Other implementations seen
- `webhouse/buddy` `apps/web/src/lib/sounds.ts` — best gesture-gating (one-time document listener at module load); 4 severity tones (low/medium/high/critical). Preset source.
- `webhouse/cms` `packages/cms-admin/src/lib/notification-sound.ts` — publish ascending chime + expire descending chime. Preset source.

### Headless core vs. adapters
- **Core (no React/next):** AudioEngine (lazy AudioContext singleton, master GainNode, gesture warm-up click+keydown once:true, visibilitychange suspend/resume); playTone(freq,dur,type,vol,offset); playNoise(dur,vol); playFile(src,vol) (Howler lazy + buffer cache, optional/tree-shakeable); createSoundKit(registry) → {play,mute,unmute,toggleMute,setVolume,isMuted}; localStorage persistence helpers (configurable key prefix). The autoplay-policy guard + suspended→running state machine live here.
- **Stack A (Next/React):** useSoundKit(registry) (stable ref, warm-up on first interaction, reactive isMuted/volume); optional SoundKitProvider context. No next/navigation.
- **Stack B (Bun/Hono/Preact):** useSoundKitSignals(registry) → {kit, enabled: Signal, volume: Signal} mirroring localStorage (trail ambient-store pattern). effect() wires signals to the engine.

### Public API
```ts
export type SoundDef = { tones?: ToneStep[]; noise?: {duration:number;volume?:number}; file?: string; fileVolume?: number };
export interface SoundKit<N extends string> { play(name:N): void; mute(): void; unmute(): void; toggleMute(): boolean; setVolume(v:number): void; isMuted(): boolean; destroy(): void }
export function createSoundKit<N extends string>(registry: Record<N,SoundDef>, options?: { storageKeyPrefix?: string; initialVolume?: number }): SoundKit<N>;
export function useSoundKit<N extends string>(registry, options?): SoundKit<N>;        // Stack A
export function useSoundKitSignals<N extends string>(registry): { kit; enabled; volume }; // Stack B
export { BUDDY_SOUNDS, CMS_SOUNDS }; // tree-shakeable presets
```

## Stories
- **F026.1** — Headless core: AudioEngine + createSoundKit — _AC:_ createSoundKit(registry, options); AudioContext created lazily on first gesture (click/keydown once:true); play(name) dispatches the right tone/noise; mute/unmute/toggleMute persist to localStorage with configurable prefix; vitest (no DOM) covers mute persistence + registry dispatch.
- **F026.2** — Howler.js optional file-playback layer — _AC:_ SoundDef.file triggers Howler (lazy + buffer-cached); Howler is a peerDependency — absent at runtime → file sounds silently no-op; toggleMute() syncs Howler.mute(); tree-shake: tone-only imports don't pull Howler.
- **F026.3** — React 19 useSoundKit hook (Stack A) — _AC:_ useSoundKit(registry) returns a stable ref across re-renders; warm-up listener registered in useEffect + removed on unmount; isMuted + volume reactive; no next/* imports.
- **F026.4** — Preact signals adapter (Stack B) — _AC:_ useSoundKitSignals(registry) → {kit, enabled: Signal, volume: Signal}; enabled.value=false calls kit.mute(); volume.value=0.4 calls setVolume; signals hydrate from localStorage + persist via effect() (trail ambient-store pattern).
- **F026.5** — Built-in preset registries — _AC:_ BUDDY_SOUNDS (4 severity tones from buddy sounds.ts) + CMS_SOUNDS (publish ascending + expire descending from cms notification-sound.ts) as SoundDef entries; named exports, tested, documented usage.
- **F026.6** — Adopt @broberg/soundkit in buddy + cms — _AC:_ buddy sounds.ts replaced by createSoundKit + BUDDY_SOUNDS; cms notification-sound.ts replaced by CMS_SOUNDS; both build + CI pass; playFlagSound()/playPublishSound() remain as thin back-compat wrappers; manual verify correct tones play.

## Acceptance criteria
1. @broberg/soundkit builds + typechecks clean; headless core imports no framework packages.
2. Each story (F026.1–F026.6) meets its own AC.
3. Piloted in buddy and adopted back with no regression (runtime-verified).
4. A second consumer (cms) migrates onto the shared package with identical behaviour.

## Dependencies
- External: howler (optional peer, file sounds only), localStorage (browser), @preact/signals (optional, Stack B).

## Rollout
Strangler: 1) extract headless core + React hook from catan sounds.ts; port buddy preset as BUDDY_SOUNDS + cms as CMS_SOUNDS; 2) publish @broberg/soundkit; 3) adopt buddy (keep playFlagSound wrapper); 4) adopt cms (replace notification-sound.ts); 5) spread to catan + new apps.

Graduate-candidate: no — stays in `components`.

## Open Questions
- Shared AudioContext singleton (one per page) or multiple independent instances?
- Howler worth the dep, or native fetch + decodeAudioData (trail .opus pattern) to stay zero-dep?
- Presets in-package or a separate @broberg/soundkit-presets to keep core tiny?
- Preact signals adapter in the same package or a /preact entry point (avoid pulling @preact/signals into Stack A builds)?

## Effort estimate
**M** — owner session: `buddy`. Reuse model: runtime-package.

## Risks
Howler.js is CommonJS — can cause ESM bundler issues (Vite/Bun); keep it an optional peerDependency + document the dynamic-import pattern. Gesture-gating differs subtly (buddy one-time listener at module load vs catan getCtx() per playTone which can create the context outside a gesture) — standardise on buddy's approach + document playSound() is a no-op until first interaction. Keep trail AmbientProvider separate (ambient-stream concern; merging bloats the API).