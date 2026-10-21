// F103.1 — what travels between server and client. One file, so both halves agree.

/** One event on a channel. With `id` it is DURABLE (replayable after a reconnect); without, EPHEMERAL (typing, presence). */
export interface RealtimeEvent {
  type: string;
  data?: unknown;
  id?: string;
}

/** Event types the package uses itself. Hosts' own types must not start with "$". */
export const PING = "$ping";
/** Presence transitions delivered to streams: `{ action: "join" | "leave", member }`. */
export const PRESENCE = "presence";

export class RealtimeError extends Error {
  constructor(readonly code: "payload_too_large" | "invalid_event" | "reserved_type", message: string) {
    super(message);
    this.name = "RealtimeError";
  }
}
