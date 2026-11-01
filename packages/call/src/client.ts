// @broberg/call/client — the browser's half of a call (F104.3; camera + screen share F104.7).
//
// A thin layer over livekit-client that does the four things every app would
// otherwise get slightly wrong on its own: open the microphone with noise
// suppression, echo cancellation and auto gain; actually PLAY the other people
// (a subscribed audio track is silent until it is attached to an element);
// keep "mute everyone" and per-person volume apart so unmuting restores what
// each person was set to; and stop calling the app back after leave().
// F104.7 adds camera and screen share: simulcast + adaptive stream + dynacast
// so 2–10 people with video stay usable, the browser's own «stop sharing»
// button is reported back to the app, and audio-only drops incoming video.
// No node: imports.

import { Room, RoomEvent, Track } from "livekit-client";
import type { LocalTrackPublication, Participant, RemoteParticipant, RemoteTrack, RemoteTrackPublication } from "livekit-client";

export interface VoiceParticipant {
  identity: string;
  name: string;
  isLocal: boolean;
}

/** F104.7 — one video picture in the call: a camera or a shared screen, yours or someone else's. */
export interface CallVideo {
  /** Stable for as long as this picture exists — use it as a render key. */
  id: string;
  identity: string;
  name: string;
  isLocal: boolean;
  source: "camera" | "screen_share";
  /** Show it in a `<video>` element (autoplay + playsinline are set for you). */
  attach(el: HTMLVideoElement): void;
  detach(el: HTMLVideoElement): void;
}

/** F104.7 — what you are sending right now. */
export interface LocalMedia {
  camera: boolean;
  screenShare: boolean;
}

export interface JoinOptions {
  /** The media server, e.g. `wss://voice.broberg.ai`. */
  url: string;
  /** A ticket from `createRoomToken` on the app's server. */
  token: string;
  /**
   * F104.4 — `false` joins as a listener: the microphone is never opened
   * (a listen-only ticket would be refused if it tried). Default `true`.
   */
  publish?: boolean;
}

export interface VoiceCall {
  mute(): Promise<void>;
  unmute(): Promise<void>;
  readonly muted: boolean;
  /** Silence everyone else (true) or bring back each person's own volume (false). */
  setOutputMuted(muted: boolean): void;
  setInputDevice(deviceId: string): Promise<void>;
  setOutputDevice(deviceId: string): Promise<void>;
  /** 0–1 for one person. Kept while output is muted and applied on unmute. */
  setVolume(identity: string, volume: number): void;
  /** Identities of the people speaking right now, loudest first. Returns an unsubscribe. */
  onSpeaking(cb: (identities: string[]) => void): () => void;
  /** Everyone in the call, you included; called at once and on every join/leave. Returns an unsubscribe. */
  onParticipants(cb: (participants: VoiceParticipant[]) => void): () => void;
  /** F104.7 — turn your camera on or off. Needs a ticket with `"camera"` in `sources`. */
  setCamera(on: boolean, opts?: { deviceId?: string }): Promise<void>;
  /**
   * F104.7 — share your screen (the browser asks which screen/window/tab) or stop.
   * `audio: true` also offers the tab's sound (needs `"screen_share_audio"` in the ticket).
   * Stopping with the browser's own «stop sharing» button is reported through `onLocalMedia`.
   */
  setScreenShare(on: boolean, opts?: { audio?: boolean }): Promise<void>;
  readonly localMedia: LocalMedia;
  /** Called at once and whenever your camera/screen share turns on or off — also from the browser's own stop button. Returns an unsubscribe. */
  onLocalMedia(cb: (media: LocalMedia) => void): () => void;
  /** Every video picture in the call (yours included), at once and whenever one comes or goes. Returns an unsubscribe. */
  onVideos(cb: (videos: CallVideo[]) => void): () => void;
  /** F104.7 — `true` stops receiving other people's video (weak connection); sound is untouched. `false` brings it back. */
  setAudioOnly(on: boolean): void;
  readonly audioOnly: boolean;
  leave(): Promise<void>;
}

/** F104.7 — the room settings that keep 2–10 people with video usable. */
export const VIDEO_ROOM_OPTIONS = { adaptiveStream: true, dynacast: true, publishDefaults: { simulcast: true } } as const;

export const AUDIO_CAPTURE = { noiseSuppression: true, echoCancellation: true, autoGainControl: true } as const;

export async function joinVoice({ url, token, publish = true }: JoinOptions): Promise<VoiceCall> {
  const room = new Room({ audioCaptureDefaults: { ...AUDIO_CAPTURE }, ...VIDEO_ROOM_OPTIONS, publishDefaults: { ...VIDEO_ROOM_OPTIONS.publishDefaults } });
  const localMediaCbs = new Set<(m: LocalMedia) => void>();
  const videoCbs = new Set<(v: CallVideo[]) => void>();
  // F104.10 — kept WITH its publication: a muted camera stays subscribed, so
  // only the publication can say whether there is a picture right now.
  const remoteVideos = new Map<RemoteTrack, { video: CallVideo; pub: RemoteTrackPublication }>();
  let audioOnly = false;
  const speakingCbs = new Set<(ids: string[]) => void>();
  const participantCbs = new Set<(ps: VoiceParticipant[]) => void>();
  const volumes = new Map<string, number>();
  const audioEls = new Map<RemoteTrack, HTMLMediaElement[]>();
  let outputMuted = false;
  let muted = !publish;
  let left = false;

  const participants = (): VoiceParticipant[] => [
    toVoiceParticipant(room.localParticipant, true),
    ...[...room.remoteParticipants.values()].map((p) => toVoiceParticipant(p, false)),
  ];
  const emitParticipants = () => {
    if (left) return;
    const list = participants();
    participantCbs.forEach((cb) => cb(list));
  };
  const applyVolume = (p: RemoteParticipant) => p.setVolume(outputMuted ? 0 : (volumes.get(p.identity) ?? 1));

  const localMedia = (): LocalMedia => ({
    camera: room.localParticipant.isCameraEnabled,
    screenShare: room.localParticipant.isScreenShareEnabled,
  });
  const emitLocalMedia = () => {
    if (left) return;
    const m = localMedia();
    localMediaCbs.forEach((cb) => cb(m));
  };
  const videos = (): CallVideo[] => {
    const local: CallVideo[] = [];
    for (const pub of room.localParticipant.videoTrackPublications.values()) {
      const v = localVideo(pub, room.localParticipant);
      if (v) local.push(v);
    }
    const remote = [...remoteVideos.values()].filter(({ pub }) => !pub.isMuted).map(({ video }) => video);
    return [...local, ...remote];
  };
  const emitVideos = () => {
    if (left) return;
    const list = videos();
    videoCbs.forEach((cb) => cb(list));
  };
  const onLocalChange = () => { emitLocalMedia(); emitVideos(); };
  // Audio-only only ever touches VIDEO publications — sound keeps flowing.
  const applyAudioOnly = (pub: RemoteTrackPublication) => {
    if (pub.kind === Track.Kind.Video) pub.setSubscribed(!audioOnly);
  };

  const handlers: [RoomEvent, (...args: any[]) => void][] = [
    [RoomEvent.ParticipantConnected, (p: RemoteParticipant) => { applyVolume(p); emitParticipants(); }],
    [RoomEvent.ParticipantDisconnected, () => emitParticipants()],
    [RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      if (left) return;
      const ids = speakers.map((s) => s.identity);
      speakingCbs.forEach((cb) => cb(ids));
    }],
    [RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (track.kind === Track.Kind.Video) {
        const source = toVideoSource(track.source);
        if (!source) return;
        remoteVideos.set(track, { video: videoOf(`${p.identity}:${track.sid ?? source}`, p, false, source, track), pub });
        emitVideos();
        return;
      }
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      document.body.appendChild(el);
      audioEls.set(track, [el]);
      applyVolume(p);
    }],
    [RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (remoteVideos.delete(track)) {
        track.detach();
        emitVideos();
        return;
      }
      track.detach().forEach((el) => el.remove());
      audioEls.delete(track);
    }],
    [RoomEvent.TrackPublished, (pub: RemoteTrackPublication) => { if (audioOnly) applyAudioOnly(pub); }],
    // Fired for our own camera/screen going on or off — including when the
    // person ends a screen share with the BROWSER's stop button, which never
    // passes through setScreenShare.
    [RoomEvent.LocalTrackPublished, onLocalChange],
    [RoomEvent.LocalTrackUnpublished, onLocalChange],
    // F104.10 — LiveKit turns a camera off by MUTING it, for you and for
    // everyone else, so a mute is a picture going away (and unmute coming back).
    [RoomEvent.TrackMuted, onLocalChange],
    [RoomEvent.TrackUnmuted, onLocalChange],
  ];
  for (const [event, fn] of handlers) room.on(event, fn);

  try {
    await room.connect(url, token);
    if (publish) await room.localParticipant.setMicrophoneEnabled(true, { ...AUDIO_CAPTURE });
    // joinVoice is called from a click; this is the gesture browsers require before audio may play.
    await room.startAudio();
  } catch (e) {
    // A refused microphone must not leave the person connected and listening
    // with no handle to leave — the caller only gets the rejection.
    left = true;
    for (const [event, fn] of handlers) room.off(event, fn);
    await room.disconnect();
    throw e;
  }

  return {
    get muted() { return muted; },
    async mute() { await room.localParticipant.setMicrophoneEnabled(false); muted = true; },
    async unmute() { await room.localParticipant.setMicrophoneEnabled(true, { ...AUDIO_CAPTURE }); muted = false; },
    setOutputMuted(m) {
      outputMuted = m;
      room.remoteParticipants.forEach(applyVolume);
    },
    async setInputDevice(deviceId) { await room.switchActiveDevice("audioinput", deviceId); },
    async setOutputDevice(deviceId) { await room.switchActiveDevice("audiooutput", deviceId); },
    setVolume(identity, volume) {
      volumes.set(identity, Math.min(1, Math.max(0, volume)));
      const p = room.remoteParticipants.get(identity);
      if (p) applyVolume(p);
    },
    onSpeaking(cb) {
      speakingCbs.add(cb);
      return () => speakingCbs.delete(cb);
    },
    onParticipants(cb) {
      participantCbs.add(cb);
      if (!left) cb(participants());
      return () => participantCbs.delete(cb);
    },
    async setCamera(on, opts) {
      await room.localParticipant.setCameraEnabled(on, opts?.deviceId ? { deviceId: opts.deviceId } : undefined);
      onLocalChange();
    },
    async setScreenShare(on, opts) {
      await room.localParticipant.setScreenShareEnabled(on, on ? { audio: opts?.audio === true } : undefined);
      onLocalChange();
    },
    get localMedia() { return localMedia(); },
    onLocalMedia(cb) {
      localMediaCbs.add(cb);
      if (!left) cb(localMedia());
      return () => localMediaCbs.delete(cb);
    },
    onVideos(cb) {
      videoCbs.add(cb);
      if (!left) cb(videos());
      return () => videoCbs.delete(cb);
    },
    get audioOnly() { return audioOnly; },
    setAudioOnly(on) {
      audioOnly = on;
      room.remoteParticipants.forEach((p) => p.trackPublications.forEach(applyAudioOnly));
    },
    async leave() {
      left = true;
      for (const [event, fn] of handlers) room.off(event, fn);
      speakingCbs.clear();
      participantCbs.clear();
      localMediaCbs.clear();
      videoCbs.clear();
      remoteVideos.forEach((_v, track) => track.detach());
      remoteVideos.clear();
      audioEls.forEach((_els, track) => track.detach().forEach((el) => el.remove()));
      audioEls.clear();
      await room.disconnect();
    },
  };
}

function toVideoSource(source: Track.Source): CallVideo["source"] | undefined {
  if (source === Track.Source.Camera) return "camera";
  if (source === Track.Source.ScreenShare) return "screen_share";
  return undefined;
}

function localVideo(pub: LocalTrackPublication, p: Participant): CallVideo | undefined {
  const source = toVideoSource(pub.source);
  if (!pub.track || !source || pub.isMuted) return undefined;
  return videoOf(`${p.identity}:${pub.trackSid}`, p, true, source, pub.track);
}

function videoOf(
  id: string,
  p: Participant,
  isLocal: boolean,
  source: CallVideo["source"],
  track: { attach(el: HTMLMediaElement): HTMLMediaElement; detach(el: HTMLMediaElement): HTMLMediaElement },
): CallVideo {
  return {
    id,
    identity: p.identity,
    name: p.name || p.identity,
    isLocal,
    source,
    attach(el) {
      el.autoplay = true;
      el.playsInline = true;
      // Your own camera would otherwise echo the room back through the page.
      if (isLocal) el.muted = true;
      track.attach(el);
    },
    detach(el) { track.detach(el); },
  };
}

function toVoiceParticipant(p: Participant, isLocal: boolean): VoiceParticipant {
  return { identity: p.identity, name: p.name || p.identity, isLocal };
}
