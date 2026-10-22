import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for livekit-client's Room: records what joinVoice asks of it and
// lets the test fire the room's events.
const state = vi.hoisted(() => ({ room: undefined as any, micError: undefined as Error | undefined }));

vi.mock("livekit-client", async () => {
  const RoomEvent = {
    ParticipantConnected: "participantConnected",
    ParticipantDisconnected: "participantDisconnected",
    ActiveSpeakersChanged: "activeSpeakersChanged",
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
  };
  const Track = { Kind: { Audio: "audio", Video: "video" } };
  class Room {
    options: any;
    listeners = new Map<string, Set<(...a: any[]) => void>>();
    remoteParticipants = new Map<string, any>();
    localParticipant = { identity: "me", name: "Me", micCalls: [] as any[], setMicrophoneEnabled: vi.fn(async function (this: any, on: boolean, opts?: any) { if (state.micError) throw state.micError; state.room.localParticipant.micCalls.push([on, opts]); }) };
    connect = vi.fn(async () => {});
    startAudio = vi.fn(async () => {});
    disconnect = vi.fn(async () => {});
    switchActiveDevice = vi.fn(async () => true);
    constructor(options: any) { this.options = options; state.room = this; }
    on(e: string, fn: any) { (this.listeners.get(e) ?? this.listeners.set(e, new Set()).get(e)!).add(fn); return this; }
    off(e: string, fn: any) { this.listeners.get(e)?.delete(fn); return this; }
    emit(e: string, ...a: any[]) { this.listeners.get(e)?.forEach((fn) => fn(...a)); }
    listenerCount() { let n = 0; this.listeners.forEach((s) => (n += s.size)); return n; }
  }
  return { Room, RoomEvent, Track };
});

import { AUDIO_CAPTURE, joinVoice } from "../src/client";

function remote(identity: string, name = identity) {
  return { identity, name, volume: undefined as number | undefined, setVolume(v: number) { this.volume = v; } };
}
function addRemote(identity: string) {
  const p = remote(identity);
  state.room.remoteParticipants.set(identity, p);
  state.room.emit("participantConnected", p);
  return p;
}
function audioTrack() {
  const el = { removed: false, remove() { this.removed = true; } };
  return { kind: "audio", el, attach: vi.fn(() => el), detach: vi.fn(() => [el]) };
}

const appended: unknown[] = [];
beforeEach(() => {
  appended.length = 0;
  state.micError = undefined;
  (globalThis as any).document = { body: { appendChild: (el: unknown) => appended.push(el) } };
});

describe("joinVoice", () => {
  it("opens the microphone with noise suppression, echo cancellation and auto gain", async () => {
    await joinVoice({ url: "wss://v", token: "t" });
    const room = state.room;
    expect(room.connect).toHaveBeenCalledWith("wss://v", "t");
    expect(room.options.audioCaptureDefaults).toEqual({ noiseSuppression: true, echoCancellation: true, autoGainControl: true });
    expect(room.localParticipant.micCalls[0]).toEqual([true, { noiseSuppression: true, echoCancellation: true, autoGainControl: true }]);
    expect(AUDIO_CAPTURE).toEqual({ noiseSuppression: true, echoCancellation: true, autoGainControl: true });
    expect(room.startAudio).toHaveBeenCalled();
  });

  it("publish:false joins as a listener: the microphone is never opened", async () => {
    const call = await joinVoice({ url: "u", token: "t", publish: false });
    expect(state.room.localParticipant.micCalls).toEqual([]);
    expect(call.muted).toBe(true);
    expect(state.room.startAudio).toHaveBeenCalled();
  });

  it("mute and unmute turn the microphone off and on", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    await call.mute();
    expect(state.room.localParticipant.micCalls.at(-1)[0]).toBe(false);
    expect(call.muted).toBe(true);
    await call.unmute();
    expect(state.room.localParticipant.micCalls.at(-1)).toEqual([true, AUDIO_CAPTURE]);
    expect(call.muted).toBe(false);
  });

  it("output mute silences everyone, and unmuting gives back each person's own volume", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    const a = addRemote("a");
    const b = addRemote("b");
    call.setVolume("a", 0.3);
    call.setOutputMuted(true);
    expect([a.volume, b.volume]).toEqual([0, 0]);
    const c = addRemote("c"); // someone joining while muted is silent too
    expect(c.volume).toBe(0);
    call.setVolume("b", 0.6); // kept, not applied while muted
    expect(b.volume).toBe(0);
    call.setOutputMuted(false);
    expect([a.volume, b.volume, c.volume]).toEqual([0.3, 0.6, 1]);
  });

  it("setVolume reaches only that person", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    const a = addRemote("a");
    const b = addRemote("b");
    call.setVolume("b", 0.25);
    expect(b.volume).toBe(0.25);
    expect(a.volume).toBe(1);
  });

  it("switches microphone and speaker", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    await call.setInputDevice("mic-2");
    await call.setOutputDevice("spk-3");
    expect(state.room.switchActiveDevice.mock.calls).toEqual([["audioinput", "mic-2"], ["audiooutput", "spk-3"]]);
  });

  it("plays another person's audio by attaching it, and removes it again when unsubscribed", async () => {
    await joinVoice({ url: "u", token: "t" });
    const p = addRemote("a");
    const track = audioTrack();
    state.room.emit("trackSubscribed", track, {}, p);
    expect(appended).toEqual([track.el]);
    state.room.emit("trackUnsubscribed", track, {}, p);
    expect(track.el.removed).toBe(true);
  });

  it("reports the participant list at once and on every join and leave", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    const seen: string[][] = [];
    call.onParticipants((ps) => seen.push(ps.map((p) => `${p.identity}${p.isLocal ? "*" : ""}`)));
    addRemote("a");
    state.room.remoteParticipants.delete("a");
    state.room.emit("participantDisconnected", remote("a"));
    expect(seen).toEqual([["me*"], ["me*", "a"], ["me*"]]);
  });

  it("reports who is speaking", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    const seen: string[][] = [];
    call.onSpeaking((ids) => seen.push(ids));
    state.room.emit("activeSpeakersChanged", [remote("b", "Bo"), remote("me", "Me")]);
    expect(seen).toEqual([["b", "me"]]);
  });

  it("leave disconnects, removes every listener and calls nobody back afterwards", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    const room = state.room;
    const p = addRemote("a");
    const track = audioTrack();
    room.emit("trackSubscribed", track, {}, p);
    const speaking = vi.fn();
    const people = vi.fn();
    call.onSpeaking(speaking);
    call.onParticipants(people);
    people.mockClear();
    await call.leave();
    expect(room.disconnect).toHaveBeenCalled();
    expect(room.listenerCount()).toBe(0);
    expect(track.el.removed).toBe(true);
    room.emit("activeSpeakersChanged", [remote("a")]);
    room.emit("participantConnected", remote("z"));
    expect(speaking).not.toHaveBeenCalled();
    expect(people).not.toHaveBeenCalled();
  });
});

describe("joinVoice when the microphone is refused", () => {
  it("rejects, disconnects and leaves no listener — nobody is left in the call listening", async () => {
    state.micError = new Error("NotAllowedError: Permission denied");
    await expect(joinVoice({ url: "u", token: "t" })).rejects.toThrow("Permission denied");
    expect(state.room.disconnect).toHaveBeenCalledTimes(1);
    expect(state.room.listenerCount()).toBe(0);
  });
});

describe("client entry", () => {
  it("imports nothing from node:", () => {
    const src = readFileSync(new URL("../src/client.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+["']node:/);
  });
});
