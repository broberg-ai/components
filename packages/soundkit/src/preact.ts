/**
 * @broberg/soundkit/preact — a Preact-signals adapter for Stack B (Bun/Hono/
 * Preact). Returns the kit plus `enabled`/`volume` signals wired to the engine
 * via `effect()`, mirroring the trail ambient-store pattern. Imports
 * `@preact/signals` only (optional peer); never React or `next/*`.
 */

import { signal, effect, type Signal } from "@preact/signals";
import { createSoundKit, type SoundDef, type SoundKit, type SoundKitOptions } from "./core.js";

export interface SoundKitSignals<N extends string> {
  kit: SoundKit<N>;
  /** Writing `enabled.value = false` mutes the kit. */
  enabled: Signal<boolean>;
  /** Writing `volume.value = 0.4` sets the master volume. */
  volume: Signal<number>;
  /** Detach the effect + destroy the kit. */
  destroy(): void;
}

/**
 * Create a kit + reactive signals. `enabled` is the inverse of muted (sounds on
 * = enabled), hydrated from the engine's persisted state; an `effect()` pushes
 * signal writes into the engine (which persists them to localStorage).
 */
export function useSoundKitSignals<N extends string>(
  registry: Record<N, SoundDef>,
  options?: SoundKitOptions,
): SoundKitSignals<N> {
  const kit = createSoundKit(registry, options);
  const enabled = signal<boolean>(!kit.isMuted());
  const volume = signal<number>(kit.getVolume());

  const dispose = effect(() => {
    if (enabled.value) kit.unmute();
    else kit.mute();
    kit.setVolume(volume.value);
  });

  return {
    kit,
    enabled,
    volume,
    destroy() {
      dispose();
      kit.destroy();
    },
  };
}
