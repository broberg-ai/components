/**
 * @broberg/soundkit/react — a React 19 hook wrapping the headless core so a
 * client component gets a stable kit + reactive mute/volume with no manual
 * lifecycle. Imports `react` only (optional peer); never `next/*`.
 */

import { useRef, useState, useEffect, useCallback } from "react";
import { createSoundKit, type SoundDef, type SoundKit, type SoundKitOptions } from "./core.js";

export interface UseSoundKit<N extends string> {
  play: (name: N) => void;
  muted: boolean;
  toggleMute: () => void;
  setMuted: (m: boolean) => void;
  volume: number;
  setVolume: (v: number) => void;
}

/**
 * Create a kit once (stable across re-renders) and expose `muted`/`volume` as
 * reactive React state kept in sync with the underlying engine. The engine
 * installs its own first-gesture warm-up listener; the hook tears the kit down
 * on unmount.
 */
export function useSoundKit<N extends string>(
  registry: Record<N, SoundDef>,
  options?: SoundKitOptions,
): UseSoundKit<N> {
  const kitRef = useRef<SoundKit<N> | null>(null);
  if (kitRef.current === null) kitRef.current = createSoundKit(registry, options);
  const kit = kitRef.current;

  const [muted, setMutedState] = useState<boolean>(() => kit.isMuted());
  const [volume, setVolumeState] = useState<number>(() => kit.getVolume());

  useEffect(() => {
    return () => kit.destroy();
    // Kit is created once; deliberately not re-created on option changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = useCallback((name: N) => kit.play(name), [kit]);
  const setMuted = useCallback(
    (m: boolean) => {
      if (m) kit.mute();
      else kit.unmute();
      setMutedState(kit.isMuted());
    },
    [kit],
  );
  const toggleMute = useCallback(() => {
    kit.toggleMute();
    setMutedState(kit.isMuted());
  }, [kit]);
  const setVolume = useCallback(
    (v: number) => {
      kit.setVolume(v);
      setVolumeState(kit.getVolume());
    },
    [kit],
  );

  return { play, muted, toggleMute, setMuted, volume, setVolume };
}
