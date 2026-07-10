/**
 * @broberg/soundkit — headless core. A Web Audio synth engine + a typed
 * `play(name)` over a sound registry, mute/volume persisted to localStorage.
 *
 * Framework-free (no React/Preact/next). Generalises the ~80-line Web Audio
 * pattern hand-copied into buddy, cms and catan: a lazy `AudioContext` warmed
 * up on the FIRST user gesture (the browser autoplay policy blocks audio before
 * one), oscillator+gain tones with an exponential decay, decaying white-noise,
 * and an optional Howler.js file layer.
 *
 * Ship-dark: with no Web Audio in scope (SSR / Node) the kit is an inert no-op
 * that never throws — so it's safe to construct at module load anywhere.
 */

export type OscType = "sine" | "square" | "sawtooth" | "triangle";

/** One oscillator beep. */
export interface ToneStep {
  freq: number;
  /** Seconds. */
  duration: number;
  type?: OscType;
  /** 0–1, pre-master. Default 0.3. */
  volume?: number;
  /** Start this step N ms after the sound begins. Default 0. */
  delay?: number;
}

/** A burst of decaying white noise (clicks, whooshes). */
export interface NoiseStep {
  /** Seconds. */
  noise: number;
  volume?: number;
  delay?: number;
}

/** An MP3/Opus asset (needs the optional Howler layer). */
export interface FileStep {
  file: string;
  volume?: number;
  delay?: number;
}

export type SoundStep = ToneStep | NoiseStep | FileStep;
/** A sound is a single step or an ordered sequence of them. */
export type SoundDef = SoundStep | SoundStep[];
export type SoundRegistry = Record<string, SoundDef>;

export interface SoundKit<N extends string = string> {
  /** Schedule the named sound. Unknown name / pre-gesture = safe no-op. */
  play(name: N): void;
  mute(): void;
  unmute(): void;
  /** @returns the new muted state. */
  toggleMute(): boolean;
  isMuted(): boolean;
  /** Master volume 0–1. */
  setVolume(v: number): void;
  getVolume(): number;
  /** Remove the gesture listeners + close the AudioContext. */
  destroy(): void;
}

// A structural subset of the Web Audio API — lets tests inject a mock without
// pulling the whole lib.dom AudioContext into the type surface.
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: unknown;
  readonly state: string;
  resume(): Promise<void> | void;
  close(): Promise<void> | void;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): BufferSourceLike;
}
export interface AudioParamLike {
  value: number;
  setValueAtTime(v: number, t: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
}
export interface OscillatorLike {
  type: string;
  frequency: AudioParamLike;
  connect(dst: unknown): void;
  start(t?: number): void;
  stop(t?: number): void;
}
export interface GainLike {
  gain: AudioParamLike;
  connect(dst: unknown): void;
}
export interface AudioBufferLike {
  getChannelData(ch: number): Float32Array;
}
export interface BufferSourceLike {
  buffer: AudioBufferLike | null;
  connect(dst: unknown): void;
  start(t?: number): void;
}

/** The two localStorage methods the kit needs (inject for tests/custom stores). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SoundKitOptions {
  /** localStorage key prefix for mute + volume. Default `broberg-soundkit`. */
  storageKeyPrefix?: string;
  /** Master volume 0–1 when nothing is persisted. Default 1. */
  initialVolume?: number;
  /** Force the kit inert (consumer policy, e.g. a user preference). */
  disabled?: boolean;
  /** Inject an AudioContext factory (tests / non-standard hosts). */
  audioContextFactory?: () => AudioContextLike;
  /** Inject a storage backend. Default: global localStorage when usable. */
  storage?: StorageLike;
  /** Pass a Howler namespace to enable file playback without a dynamic import. */
  howler?: HowlerLike;
}

/** Minimal Howler surface used by the file layer. */
export interface HowlerLike {
  Howl: new (opts: { src: string[]; volume?: number }) => { play(): void };
  Howler: { mute(muted: boolean): void };
}

const DEFAULT_PREFIX = "broberg-soundkit";

function readCtxCtor(): (() => AudioContextLike) | null {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? () => new Ctor() : null;
}

function safeStorage(): StorageLike | null {
  try {
    const s = (globalThis as unknown as { localStorage?: Partial<StorageLike> }).localStorage;
    // Require the real Storage methods — some environments (SSR shims, certain
    // test DOMs) expose a `localStorage` object without them.
    if (s && typeof s.getItem === "function" && typeof s.setItem === "function") {
      return s as StorageLike;
    }
    return null;
  } catch {
    return null;
  }
}

function toSteps(def: SoundDef): SoundStep[] {
  return Array.isArray(def) ? def : [def];
}

/**
 * Create a sound kit over a registry. `play(name)` schedules the whole step
 * sequence; the AudioContext is created + resumed lazily on the first user
 * gesture (or the first `play()` after one), so nothing violates the autoplay
 * policy and construction is side-effect-light.
 */
export function createSoundKit<N extends string>(
  registry: Record<N, SoundDef>,
  options: SoundKitOptions = {},
): SoundKit<N> {
  const prefix = options.storageKeyPrefix ?? DEFAULT_PREFIX;
  const muteKey = `${prefix}:muted`;
  const volKey = `${prefix}:volume`;
  const storage = options.storage ?? safeStorage();
  const ctxFactory = options.audioContextFactory ?? readCtxCtor();
  const howler = options.howler ?? null;

  let muted = storage?.getItem(muteKey) === "true";
  let volume = clamp01(
    storage?.getItem(volKey) != null ? Number(storage.getItem(volKey)) : options.initialVolume ?? 1,
  );
  let ctx: AudioContextLike | null = null;
  let gestureArmed = false;
  let destroyed = false;

  function clamp01(v: number): number {
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  }

  function ensureCtx(): AudioContextLike | null {
    if (destroyed || options.disabled || !ctxFactory) return null;
    if (!ctx) ctx = ctxFactory();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }

  // Warm-up: the browser only lets us start audio inside a user gesture. Arm the
  // context once on the first click/keydown so later programmatic plays work.
  const warmUp = (): void => {
    gestureArmed = true;
    ensureCtx();
  };
  const doc = (globalThis as unknown as { document?: Document }).document;
  if (doc && ctxFactory && !options.disabled) {
    doc.addEventListener("click", warmUp, { once: true });
    doc.addEventListener("keydown", warmUp, { once: true });
  } else {
    // No document (SSR) — nothing to arm; ensureCtx still works on demand.
    gestureArmed = true;
  }

  function scheduleTone(c: AudioContextLike, step: ToneStep, at: number): void {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = step.type ?? "sine";
    osc.frequency.value = step.freq;
    const vol = (step.volume ?? 0.3) * volume;
    gain.gain.setValueAtTime(Math.max(vol, 0.0001), at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + step.duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(at);
    osc.stop(at + step.duration);
  }

  function scheduleNoise(c: AudioContextLike, step: NoiseStep, at: number): void {
    const len = Math.max(1, Math.floor(c.sampleRate * step.noise));
    const buffer = c.createBuffer(1, len, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.max(0, 1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const gain = c.createGain();
    gain.gain.value = (step.volume ?? 0.15) * volume;
    src.connect(gain);
    gain.connect(c.destination);
    src.start(at);
  }

  function playFile(step: FileStep): void {
    if (!howler || muted) return;
    new howler.Howl({ src: [step.file], volume: (step.volume ?? 0.7) * volume }).play();
  }

  function play(name: N): void {
    if (muted || options.disabled || destroyed) return;
    const def = registry[name];
    if (!def) return;
    const c = ensureCtx();
    for (const step of toSteps(def)) {
      const delayMs = "delay" in step && step.delay ? step.delay : 0;
      if ("file" in step) {
        if (delayMs) setTimeout(() => playFile(step), delayMs);
        else playFile(step);
        continue;
      }
      if (!c) continue; // no audio context → tone/noise silently skipped
      const at = c.currentTime + delayMs / 1000;
      if ("noise" in step) scheduleNoise(c, step, at);
      else scheduleTone(c, step, at);
    }
  }

  function persistMute(): void {
    storage?.setItem(muteKey, String(muted));
    howler?.Howler.mute(muted);
  }

  return {
    play,
    mute() {
      muted = true;
      persistMute();
    },
    unmute() {
      muted = false;
      persistMute();
    },
    toggleMute() {
      muted = !muted;
      persistMute();
      return muted;
    },
    isMuted() {
      return muted;
    },
    setVolume(v: number) {
      volume = clamp01(v);
      storage?.setItem(volKey, String(volume));
    },
    getVolume() {
      return volume;
    },
    destroy() {
      destroyed = true;
      if (doc) {
        doc.removeEventListener("click", warmUp);
        doc.removeEventListener("keydown", warmUp);
      }
      if (ctx) void ctx.close();
      ctx = null;
    },
  };
}

/** Exposed for adapters that want the armed-state (currently informational). */
export type { SoundKit as SoundKitInstance };
