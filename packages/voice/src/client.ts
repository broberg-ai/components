// @broberg/voice/client — the browser's half of a voice call (F104.3).
//
// A thin layer over livekit-client that does the four things every app would
// otherwise get slightly wrong on its own: open the microphone with noise
// suppression, echo cancellation and auto gain; actually PLAY the other people
// (a subscribed audio track is silent until it is attached to an element);
// keep "mute everyone" and per-person volume apart so unmuting restores what
// each person was set to; and stop calling the app back after leave().
// No node: imports.

import { Room, RoomEvent, Track } from "livekit-client";
import type { Participant, RemoteParticipant, RemoteTrack } from "livekit-client";

export interface VoiceParticipant {
  identity: string;
  name: string;
  isLocal: boolean;
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
  leave(): Promise<void>;
}

export const AUDIO_CAPTURE = { noiseSuppression: true, echoCancellation: true, autoGainControl: true } as const;

export async function joinVoice({ url, token, publish = true }: JoinOptions): Promise<VoiceCall> {
  const room = new Room({ audioCaptureDefaults: { ...AUDIO_CAPTURE } });
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

  const handlers: [RoomEvent, (...args: any[]) => void][] = [
    [RoomEvent.ParticipantConnected, (p: RemoteParticipant) => { applyVolume(p); emitParticipants(); }],
    [RoomEvent.ParticipantDisconnected, () => emitParticipants()],
    [RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      if (left) return;
      const ids = speakers.map((s) => s.identity);
      speakingCbs.forEach((cb) => cb(ids));
    }],
    [RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: unknown, p: RemoteParticipant) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      document.body.appendChild(el);
      audioEls.set(track, [el]);
      applyVolume(p);
    }],
    [RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      track.detach().forEach((el) => el.remove());
      audioEls.delete(track);
    }],
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
    async leave() {
      left = true;
      for (const [event, fn] of handlers) room.off(event, fn);
      speakingCbs.clear();
      participantCbs.clear();
      audioEls.forEach((_els, track) => track.detach().forEach((el) => el.remove()));
      audioEls.clear();
      await room.disconnect();
    },
  };
}

function toVoiceParticipant(p: Participant, isLocal: boolean): VoiceParticipant {
  return { identity: p.identity, name: p.name || p.identity, isLocal };
}
