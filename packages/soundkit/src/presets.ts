/**
 * Starter sound registry — a small, brand-neutral set of UI effects derived
 * from the catan reference synth (oscillator + noise, no assets). Tree-shakeable;
 * import only what you use, or define your own registry.
 *
 * NOTE: buddy's 4 severity tones and cms's publish/expire chimes get their own
 * exact-transcribed `BUDDY_SOUNDS` / `CMS_SOUNDS` presets at adopt-back time
 * (F026.5) so their audio is byte-identical post-migration — they are
 * intentionally NOT approximated here.
 */

import type { SoundRegistry } from "./core.js";

export const UI_SOUNDS = {
  /** Short rising two-tone — a positive confirmation. */
  success: [
    { freq: 523, duration: 0.12, type: "sine", volume: 0.2 },
    { freq: 659, duration: 0.16, type: "sine", volume: 0.22, delay: 100 },
  ],
  /** Single soft ping — a neutral notification. */
  notify: [{ freq: 880, duration: 0.22, type: "sine", volume: 0.15 }],
  /** Percussive click — a UI tick. */
  click: [
    { noise: 0.05, volume: 0.18 },
    { freq: 300, duration: 0.08, type: "triangle", volume: 0.18 },
  ],
  /** Descending two-tone — a soft error / dismissal. */
  error: [
    { freq: 392, duration: 0.14, type: "sine", volume: 0.2 },
    { freq: 294, duration: 0.2, type: "sine", volume: 0.2, delay: 110 },
  ],
} satisfies SoundRegistry;

export type UiSoundName = keyof typeof UI_SOUNDS;
