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
    TrackPublished: "trackPublished",
    LocalTrackPublished: "localTrackPublished",
    LocalTrackUnpublished: "localTrackUnpublished",
  };
  const Track = {
    Kind: { Audio: "audio", Video: "video" },
    Source: { Camera: "camera", Microphone: "microphone", ScreenShare: "screen_share", ScreenShareAudio: "screen_share_audio" },
  };
  class Room {
    options: any;
    listeners = new Map<string, Set<(...a: any[]) => void>>();
    remoteParticipants = new Map<string, any>();
    localParticipant: any = {
      identity: "me", name: "Me", micCalls: [] as any[],
      isCameraEnabled: false, isScreenShareEnabled: false,
      videoTrackPublications: new Map<string, any>(),
      setMicrophoneEnabled: vi.fn(async function (this: any, on: boolean, opts?: any) { if (state.micError) throw state.micError; state.room.localParticipant.micCalls.push([on, opts]); }),
      // Mirrors LiveKit: enabling publishes a local video track, disabling removes it.
      setCameraEnabled: vi.fn(async (on: boolean) => localVideoToggle("camera", on)),
      setScreenShareEnabled: vi.fn(async (on: boolean) => localVideoToggle("screen_share", on)),
    };
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
  function localVideoToggle(source: "camera" | "screen_share", on: boolean) {
    const lp = state.room.localParticipant;
    lp[source === "camera" ? "isCameraEnabled" : "isScreenShareEnabled"] = on;
    const sid = `L-${source}`;
    if (on) lp.videoTrackPublications.set(sid, { trackSid: sid, source, track: videoTrack(source, sid) });
    else lp.videoTrackPublications.delete(sid);
  }
  return { Room, RoomEvent, Track };
});

function videoTrack(source: string, sid: string) {
  return { kind: "video", source, sid, attached: [] as any[], attach: vi.fn(function (this: any, el: any) { this.attached.push(el); return el; }), detach: vi.fn(function (this: any, el?: any) { this.attached = el ? this.attached.filter((x: any) => x !== el) : []; return []; }) };
}

import { AUDIO_CAPTURE, VIDEO_ROOM_OPTIONS, joinVoice } from "../src/client";

function remote(identity: string, name = identity) {
  return { identity, name, volume: undefined as number | undefined, trackPublications: new Map<string, any>(), setVolume(v: number) { this.volume = v; } };
}
function publication(kind: "audio" | "video", sid: string) {
  return { kind, trackSid: sid, subscribed: true as boolean, setSubscribed(on: boolean) { this.subscribed = on; } };
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

describe("F104.7 — camera and screen share", () => {
  it("joins with simulcast, adaptive stream and dynacast on, and keeps the audio capture settings", async () => {
    await joinVoice({ url: "u", token: "t" });
    expect(state.room.options).toEqual({
      audioCaptureDefaults: AUDIO_CAPTURE,
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: { simulcast: true },
    });
    expect(VIDEO_ROOM_OPTIONS).toEqual({ adaptiveStream: true, dynacast: true, publishDefaults: { simulcast: true } });
  });

  it("an audio-only caller never turns on camera or screen", async () => {
    await joinVoice({ url: "u", token: "t" });
    expect(state.room.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(state.room.localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
  });

  it("setCamera and setScreenShare turn each on and off, report localMedia, and show your own picture", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    const media: any[] = [];
    const vids: string[][] = [];
    call.onLocalMedia((m) => media.push(m));
    call.onVideos((v) => vids.push(v.map((x) => `${x.identity}${x.isLocal ? "*" : ""}:${x.source}`)));
    await call.setCamera(true, { deviceId: "cam-2" });
    expect(state.room.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(true, { deviceId: "cam-2" });
    await call.setScreenShare(true, { audio: true });
    expect(state.room.localParticipant.setScreenShareEnabled).toHaveBeenLastCalledWith(true, { audio: true });
    expect(call.localMedia).toEqual({ camera: true, screenShare: true });
    await call.setCamera(false);
    await call.setScreenShare(false);
    expect(state.room.localParticipant.setScreenShareEnabled).toHaveBeenLastCalledWith(false, undefined);
    expect(media).toEqual([
      { camera: false, screenShare: false },
      { camera: true, screenShare: false },
      { camera: true, screenShare: true },
      { camera: false, screenShare: true },
      { camera: false, screenShare: false },
    ]);
    expect(vids).toEqual([[], ["me*:camera"], ["me*:camera", "me*:screen_share"], ["me*:screen_share"], []]);
  });

  it("screen share without audio asks for no tab sound", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    await call.setScreenShare(true);
    expect(state.room.localParticipant.setScreenShareEnabled).toHaveBeenLastCalledWith(true, { audio: false });
  });

  it("stopping the share with the BROWSER's own button is reported, without the app calling setScreenShare", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    await call.setScreenShare(true);
    const media: any[] = [];
    const vids: number[] = [];
    call.onLocalMedia((m) => media.push(m));
    call.onVideos((v) => vids.push(v.length));
    // What LiveKit does when the browser ends the capture: the track is unpublished.
    const lp = state.room.localParticipant;
    lp.isScreenShareEnabled = false;
    const pub = lp.videoTrackPublications.get("L-screen_share");
    lp.videoTrackPublications.delete("L-screen_share");
    state.room.emit("localTrackUnpublished", pub, lp);
    expect(media.at(-1)).toEqual({ camera: false, screenShare: false });
    expect(vids.at(-1)).toBe(0);
    expect(call.localMedia.screenShare).toBe(false);
  });

  it("gives other people's camera and screen as pictures with who + source, and drops them when they go", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    const seen: string[][] = [];
    call.onVideos((v) => seen.push(v.map((x) => `${x.identity}:${x.source}:${x.isLocal}`)));
    const p = addRemote("ida");
    const cam = videoTrack("camera", "T1");
    const scr = videoTrack("screen_share", "T2");
    state.room.emit("trackSubscribed", cam, {}, p);
    state.room.emit("trackSubscribed", scr, {}, p);
    expect(seen.at(-1)).toEqual(["ida:camera:false", "ida:screen_share:false"]);
    state.room.emit("trackUnsubscribed", scr, {}, p);
    expect(seen.at(-1)).toEqual(["ida:camera:false"]);
    expect(scr.detach).toHaveBeenCalled();
    expect(appended).toEqual([]); // video is never dumped into the page — the app places it
  });

  it("attach puts the picture in the app's video element, playing inline; your own is muted", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    let list: any[] = [];
    call.onVideos((v) => (list = v));
    const p = addRemote("ida");
    const cam = videoTrack("camera", "T1");
    state.room.emit("trackSubscribed", cam, {}, p);
    const el: any = {};
    list[0].attach(el);
    expect(cam.attached).toEqual([el]);
    expect(el).toMatchObject({ autoplay: true, playsInline: true });
    expect(el.muted).toBeUndefined();
    list[0].detach(el);
    expect(cam.attached).toEqual([]);
    await call.setCamera(true);
    const mine: any = {};
    list.find((v) => v.isLocal).attach(mine);
    expect(mine.muted).toBe(true);
  });

  it("audio-only stops receiving video but keeps sound, and brings video back", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    const p = addRemote("ida");
    const v1 = publication("video", "V1");
    const a1 = publication("audio", "A1");
    p.trackPublications.set("V1", v1).set("A1", a1);
    call.setAudioOnly(true);
    expect(call.audioOnly).toBe(true);
    expect([v1.subscribed, a1.subscribed]).toEqual([false, true]);
    call.setAudioOnly(false);
    expect([v1.subscribed, a1.subscribed]).toEqual([true, true]);
  });

  it("audio-only also holds back video from people who publish later", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    const p = addRemote("ida");
    call.setAudioOnly(true);
    const v2 = publication("video", "V2");
    state.room.emit("trackPublished", v2, p);
    expect(v2.subscribed).toBe(false);
    call.setAudioOnly(false);
    const v3 = publication("video", "V3");
    state.room.emit("trackPublished", v3, p);
    expect(v3.subscribed).toBe(true);
  });

  it("after leave, no picture or media callback fires and remote pictures are detached", async () => {
    const call = await joinVoice({ url: "u", token: "t" });
    const p = addRemote("ida");
    const cam = videoTrack("camera", "T1");
    state.room.emit("trackSubscribed", cam, {}, p);
    const vids = vi.fn();
    const media = vi.fn();
    call.onVideos(vids);
    call.onLocalMedia(media);
    vids.mockClear();
    media.mockClear();
    await call.leave();
    expect(cam.detach).toHaveBeenCalled();
    state.room.emit("trackSubscribed", videoTrack("camera", "T9"), {}, p);
    state.room.emit("localTrackUnpublished", {}, state.room.localParticipant);
    expect(vids).not.toHaveBeenCalled();
    expect(media).not.toHaveBeenCalled();
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
