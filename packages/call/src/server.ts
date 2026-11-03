// @broberg/call/server — the app's half of a call (F104.3; video and screen share F104.7).
//
// The app never carries audio. It decides who may enter a room, signs a short
// ticket for that one room, and hears from the media server (LiveKit) through a
// signed webhook when people join and leave. Built on LiveKit's own SDK so the
// ticket format and the webhook signature are LiveKit's, not ours.

import { AccessToken, TrackSource, WebhookReceiver } from "livekit-server-sdk";
import type { WebhookEvent } from "livekit-server-sdk";

export type { WebhookEvent };

export type VoiceErrorCode =
  | "missing_credentials"
  | "invalid_room"
  | "invalid_identity"
  | "invalid_ttl"
  | "invalid_sources"
  | "invalid_webhook"
  | "invalid_control_url"
  | "recording_failed";

export class VoiceError extends Error {
  constructor(
    readonly code: VoiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VoiceError";
  }
}

export interface Credentials {
  apiKey: string;
  apiSecret: string;
}

export interface RoomTokenOptions extends Credentials {
  /** One room, e.g. `jam:<jam-id>`. The ticket admits to this room only. */
  room: string;
  /** Stable id of the person — the same person joining twice replaces the first connection. */
  identity: string;
  /** Display name other participants see. */
  name?: string;
  /** Seconds the ticket can be used to ENTER. Default 600, max 3600. A call in progress is not cut off when it expires. */
  ttl?: number;
  /**
   * F104.4 — `false` makes a LISTEN-ONLY ticket: the person can join and hear
   * everyone but publish nothing (no microphone, no data). Default `true`.
   * Pair it with `joinVoice({ publish: false })` in the browser.
   */
  canPublish?: boolean;
  /**
   * F104.7 — what the person may send. Default `["microphone"]`, so an app that
   * never asks for video still mints a sound-only ticket. Add `"camera"`,
   * `"screen_share"` and/or `"screen_share_audio"` (the sound of a shared tab).
   * Refused together with `canPublish: false` — a listener sends nothing.
   */
  sources?: CallSource[];
}

/** F104.7 — the kinds of media a ticket may allow a person to send. */
export type CallSource = "microphone" | "camera" | "screen_share" | "screen_share_audio";

const SOURCE_TO_LIVEKIT: Record<CallSource, TrackSource> = {
  microphone: TrackSource.MICROPHONE,
  camera: TrackSource.CAMERA,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};

export const DEFAULT_TTL_SECONDS = 600;
export const MAX_TTL_SECONDS = 3600;

function requireCredentials({ apiKey, apiSecret }: Partial<Credentials>): void {
  // LiveKit's AccessToken falls back to LIVEKIT_API_KEY/SECRET from the
  // environment when these are missing — a ticket signed with a key the caller
  // never chose. Refuse instead.
  if (!apiKey || !apiSecret) {
    throw new VoiceError("missing_credentials", "apiKey and apiSecret are required");
  }
}

/**
 * Sign a ticket for one room — microphone only unless `sources` says more.
 * Check the person's access BEFORE calling this.
 */
export async function createRoomToken(opts: RoomTokenOptions): Promise<string> {
  requireCredentials(opts);
  if (!opts.room?.trim()) throw new VoiceError("invalid_room", "room is required");
  if (!opts.identity?.trim()) throw new VoiceError("invalid_identity", "identity is required");
  const ttl = opts.ttl ?? DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > MAX_TTL_SECONDS) {
    throw new VoiceError("invalid_ttl", `ttl must be a whole number of seconds between 1 and ${MAX_TTL_SECONDS}`);
  }

  const speak = opts.canPublish !== false;
  const sources = resolveSources(opts.sources, speak);

  const token = new AccessToken(opts.apiKey, opts.apiSecret, { identity: opts.identity, name: opts.name, ttl });
  token.addGrant({
    room: opts.room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: speak,
    ...(speak ? { canPublishSources: sources.map((src) => SOURCE_TO_LIVEKIT[src]) } : {}),
    canPublishData: false,
  });
  return token.toJwt();
}

function resolveSources(sources: CallSource[] | undefined, speak: boolean): CallSource[] {
  if (sources === undefined) return ["microphone"];
  if (!speak) throw new VoiceError("invalid_sources", "sources cannot be given with canPublish: false — a listener sends nothing");
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new VoiceError("invalid_sources", "sources must name at least one of microphone, camera, screen_share, screen_share_audio");
  }
  const unknown = sources.filter((src) => !Object.hasOwn(SOURCE_TO_LIVEKIT, src));
  if (unknown.length) throw new VoiceError("invalid_sources", `unknown source(s): ${unknown.join(", ")}`);
  return [...new Set(sources)];
}

/**
 * Verify a webhook from the media server and return its event.
 * `body` must be the RAW request body — re-serialised JSON changes the hash.
 */
export async function verifyWebhook(
  body: string,
  authHeader: string | null | undefined,
  credentials: Credentials,
): Promise<WebhookEvent> {
  requireCredentials(credentials);
  try {
    // A missing header is refused by LiveKit itself ("authorization header is empty").
    return await new WebhookReceiver(credentials.apiKey, credentials.apiSecret).receive(body, authHeader ?? undefined);
  } catch (e) {
    throw new VoiceError("invalid_webhook", `webhook rejected: ${(e as Error).message}`);
  }
}

// ---- F104.9.5 — recording ----------------------------------------------------
//
// The recording itself runs beside LiveKit (broberg-voice-control starts a
// recording machine only while something is being recorded). The app asks for
// it with a 5-minute ticket signed by ITS OWN LiveKit key, bound to ONE room —
// so an app can only ever start, stop or read recordings of rooms it names.
// Webhooks `egress_started` / `egress_ended` arrive through `verifyWebhook`
// like every other event; `event.egressInfo` carries the file.

export interface RecordingOptions extends Credentials {
  /** The recording service, e.g. `https://broberg-voice-control.fly.dev`. */
  controlUrl: string;
}

export interface RecordingFile {
  name: string;
  size: number;
  durationSec: number;
}

export interface Recording {
  recordingId: string;
  egressId?: string;
  room: string;
  /**
   * `recording` while it runs; `stopped` after stopRecording; `complete` if the
   * room emptied by itself; `failed` (with `error`) if it could not be made.
   */
  state: "recording" | "stopped" | "complete" | "failed";
  attempts?: number;
  error?: string;
  /** Absent until the file is written — after a stop, poll getRecording until it is there. */
  files?: RecordingFile[];
}

async function recordingTicket(room: string, credentials: Credentials): Promise<string> {
  requireCredentials(credentials);
  if (!room?.trim()) throw new VoiceError("invalid_room", "room is required");
  const token = new AccessToken(credentials.apiKey, credentials.apiSecret, { ttl: 300 });
  token.addGrant({ room, roomRecord: true });
  return token.toJwt();
}

async function control(path: string, room: string, opts: RecordingOptions, init: { method: string; body?: string }): Promise<Recording> {
  // The request carries a recording ticket: plain http only to this machine, never across a network.
  let u: URL;
  try { u = new URL(opts.controlUrl); } catch { throw new VoiceError("invalid_control_url", "controlUrl must be an https URL"); }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new VoiceError("invalid_control_url", "controlUrl must be https (http only for localhost)");
  const res = await fetch(opts.controlUrl.replace(/\/+$/, "") + path, {
    ...init,
    headers: { authorization: `Bearer ${await recordingTicket(room, opts)}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(90_000), // a cold recording machine takes ~20 s to start
  });
  const text = await res.text();
  let body: any;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text.slice(0, 200) }; }
  if (!res.ok) throw new VoiceError("recording_failed", `recording service answered ${res.status}: ${body?.error ?? "unknown"}`);
  return body as Recording;
}

/**
 * Start recording the whole room (everyone, one video, grid layout).
 * Ask for every participant's consent BEFORE calling this — it records all of them.
 * On a cold recording machine the picture joins after ~20 s.
 */
export function startRecording(room: string, opts: RecordingOptions): Promise<Recording> {
  return control("/v1/recordings", room, opts, { method: "POST", body: JSON.stringify({ room }) });
}

/** Stop a recording. `room` must be the room it was started for. */
export function stopRecording(recordingId: string, room: string, opts: RecordingOptions): Promise<Recording> {
  return control(`/v1/recordings/${encodeURIComponent(recordingId)}/stop`, room, opts, { method: "POST" });
}

/**
 * F104.9.8 — a meeting started: ask the recording service to get ready, so a recording
 * started in the next minutes begins in seconds instead of ~35 s from cold. Nothing is
 * recorded (the service warms up on a blank page). Call it when the first person joins;
 * it returns at once. If no recording follows within 3 minutes, the service turns the
 * recording machine off again, so a meeting without a recording costs those 3 minutes.
 */
export async function prewarmRecording(room: string, opts: RecordingOptions): Promise<{ warmth: "cold" | "warming" | "warm" }> {
  return (await control("/v1/prewarm", room, opts, { method: "POST", body: JSON.stringify({ room }) })) as unknown as { warmth: "cold" | "warming" | "warm" };
}

/** Read where a recording stands — after a stop, poll until `files` is there (or `state` is `failed`). */
export function getRecording(recordingId: string, room: string, opts: RecordingOptions): Promise<Recording> {
  return control(`/v1/recordings/${encodeURIComponent(recordingId)}`, room, opts, { method: "GET" });
}
