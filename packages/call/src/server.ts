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
  | "invalid_webhook";

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
