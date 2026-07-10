// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { createSoundKit, type AudioContextLike, type AudioBufferLike, type StorageLike } from "../src/core.js";
import { UI_SOUNDS } from "../src/presets.js";

// ── Mock storage (happy-dom's localStorage stub lacks the Storage methods) ──
class MockStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

// ── Mock Web Audio ─────────────────────────────────────────────────────────
class MockParam {
  value = 0;
  events: Array<[string, number, number]> = [];
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.events.push(["set", v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(["ramp", v, t]);
  }
}
class MockOsc {
  type = "sine";
  frequency = new MockParam();
  started = false;
  stopped = false;
  connect() {}
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
class MockGain {
  gain = new MockParam();
  connect() {}
}
class MockBufferSource {
  buffer: AudioBufferLike | null = null;
  started = false;
  connect() {}
  start() {
    this.started = true;
  }
}
class MockCtx implements AudioContextLike {
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  state = "suspended";
  resumed = 0;
  closed = false;
  oscillators: MockOsc[] = [];
  gains: MockGain[] = [];
  sources: MockBufferSource[] = [];
  resume() {
    this.resumed++;
    this.state = "running";
  }
  close() {
    this.closed = true;
  }
  createOscillator() {
    const o = new MockOsc();
    this.oscillators.push(o);
    return o;
  }
  createGain() {
    const g = new MockGain();
    this.gains.push(g);
    return g;
  }
  createBuffer(_c: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    const s = new MockBufferSource();
    this.sources.push(s);
    return s;
  }
}

let ctx: MockCtx | undefined;
let store: MockStorage;
const factory = () => {
  ctx = new MockCtx();
  return ctx;
};

beforeEach(() => {
  ctx = undefined;
  store = new MockStorage();
});

/** Build a kit wired to the mock ctx + mock storage. */
function kitFor<N extends string>(registry: Record<N, import("../src/core.js").SoundDef>, extra = {}) {
  return createSoundKit(registry, { audioContextFactory: factory, storage: store, ...extra });
}

describe("createSoundKit — playback", () => {
  it("play() schedules an oscillator per tone step with the right freq/type", () => {
    kitFor(UI_SOUNDS).play("success"); // two sine tones (523, 659)
    expect(ctx!.oscillators.length).toBe(2);
    expect(ctx!.oscillators[0].frequency.value).toBe(523);
    expect(ctx!.oscillators[0].type).toBe("sine");
    expect(ctx!.oscillators[0].started).toBe(true);
    expect(ctx!.oscillators[0].stopped).toBe(true);
  });

  it("play() schedules a buffer source for a noise step", () => {
    kitFor(UI_SOUNDS).play("click"); // noise + a triangle tone
    expect(ctx!.sources.length).toBe(1);
    expect(ctx!.sources[0].started).toBe(true);
    expect(ctx!.oscillators.length).toBe(1);
    expect(ctx!.oscillators[0].type).toBe("triangle");
  });

  it("resumes a suspended context on play", () => {
    kitFor(UI_SOUNDS).play("notify");
    expect(ctx!.resumed).toBeGreaterThan(0);
  });

  it("unknown name is a safe no-op", () => {
    const kit = kitFor(UI_SOUNDS);
    // @ts-expect-error intentional unknown key
    expect(() => kit.play("nope")).not.toThrow();
  });

  it("master volume scales the tone gain (0.15 * 0.5 = 0.075)", () => {
    kitFor(UI_SOUNDS, { initialVolume: 0.5 }).play("notify"); // notify volume 0.15
    expect(ctx!.gains[0].gain.events[0][1]).toBeCloseTo(0.075, 5);
  });
});

describe("createSoundKit — mute + volume persistence", () => {
  it("mute/unmute/toggle persist to storage under the prefix", () => {
    const kit = kitFor(UI_SOUNDS, { storageKeyPrefix: "app-x" });
    kit.mute();
    expect(kit.isMuted()).toBe(true);
    expect(store.getItem("app-x:muted")).toBe("true");
    expect(kit.toggleMute()).toBe(false);
    expect(store.getItem("app-x:muted")).toBe("false");
  });

  it("hydrates muted state from storage on creation", () => {
    store.setItem("broberg-soundkit:muted", "true");
    expect(kitFor(UI_SOUNDS).isMuted()).toBe(true);
  });

  it("muted play() schedules nothing (no context constructed)", () => {
    const kit = kitFor(UI_SOUNDS);
    kit.mute();
    kit.play("success");
    expect(ctx).toBeUndefined();
  });

  it("setVolume clamps to 0..1 and persists", () => {
    const kit = kitFor(UI_SOUNDS);
    kit.setVolume(5);
    expect(kit.getVolume()).toBe(1);
    kit.setVolume(-1);
    expect(kit.getVolume()).toBe(0);
    kit.setVolume(0.4);
    expect(store.getItem("broberg-soundkit:volume")).toBe("0.4");
  });
});

describe("createSoundKit — lifecycle", () => {
  it("disabled kit is inert (no context, no throw)", () => {
    kitFor(UI_SOUNDS, { disabled: true }).play("success");
    expect(ctx).toBeUndefined();
  });

  it("warms up the context on the first document gesture", () => {
    kitFor(UI_SOUNDS);
    expect(ctx).toBeUndefined();
    document.dispatchEvent(new Event("click"));
    expect(ctx).toBeInstanceOf(MockCtx);
  });

  it("destroy() closes the context", () => {
    const kit = kitFor(UI_SOUNDS);
    kit.play("notify");
    const created = ctx!;
    kit.destroy();
    expect(created.closed).toBe(true);
    expect(() => kit.play("notify")).not.toThrow();
  });

  it("file step calls the injected Howler + syncs mute", () => {
    const played: string[] = [];
    const muteCalls: boolean[] = [];
    const howler = {
      Howl: class {
        constructor(public opts: { src: string[]; volume?: number }) {}
        play() {
          played.push(this.opts.src[0]);
        }
      },
      Howler: { mute: (m: boolean) => muteCalls.push(m) },
    };
    const kit = kitFor({ ding: { file: "/s/ding.mp3" } }, { howler });
    kit.play("ding");
    expect(played).toEqual(["/s/ding.mp3"]);
    kit.mute();
    expect(muteCalls).toContain(true);
  });
});

describe("SSR / no Web Audio", () => {
  it("kit with no audio context factory never throws on play", () => {
    const kit = createSoundKit(UI_SOUNDS, { audioContextFactory: undefined, storage: store });
    expect(() => kit.play("success")).not.toThrow();
  });
});
