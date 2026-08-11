/** A cc session registered on an edge (intercom channel snapshot). */
export interface SetiRemoteSession {
  ccSessionId: string | null;
  sessionName: string | null;
  cwd: string;
}

/** One edge host in the fleet roster. */
export interface SetiEdge {
  edgeId: string;
  connected: boolean;
  lastSeenMs: number;
  connectedAtMs: number | null;
  sessions: SetiRemoteSession[];
  /**
   * The tmux session names live on the edge — the STREAMABLE units. Stream and
   * input target these by name (channel sessionNames can differ, e.g. container
   * tmux "cc" vs channel "fly-arn-1-cc"). Empty = nothing streamable (M1 iTerm).
   */
  tmuxSessions: string[];
}

export interface SetiRoster {
  edges: SetiEdge[];
  error?: string;
}

/** tmux key names accepted by input's `key` field (navigates cc's menus). */
export const SETI_KEYS = [
  "Escape",
  "Up",
  "Down",
  "Left",
  "Right",
  "Enter",
  "BSpace",
  "Tab",
] as const;
export type SetiKey = (typeof SETI_KEYS)[number];

/**
 * What the client actually KNOWS about a send. A timeout is a measurement, not a
 * fact about delivery: the client saying "not sent" only ever means "no receipt
 * within my budget", and the edge may have injected the message anyway.
 *
 * - `delivered`   the server gave a verdict and it was yes.
 * - `rejected`    the server gave a verdict and it was no. Safe to surface as a
 *                 failure, and safe to retry — nothing was written.
 * - `unconfirmed` no verdict reached us: we stopped waiting, the network broke,
 *                 or the server answered without saying. The message may well
 *                 have arrived. **Do not auto-retry** — POST /input is not
 *                 idempotent, so a retry is how a false "not sent" becomes a
 *                 real duplicate.
 */
export type SetiSendOutcome = "delivered" | "rejected" | "unconfirmed";

export interface SetiInputResult {
  /** True only for `delivered`. Unchanged in meaning, so existing callers keep
   *  working — but a caller that shows a failure on `!ok` is showing one for
   *  `unconfirmed` too, which is the case worth rendering differently. */
  ok: boolean;
  /** What we know, as opposed to what we assume. See SetiSendOutcome. */
  outcome: SetiSendOutcome;
  edgeConnected: boolean;
  error?: string;
}

export type SetiStreamState = "connecting" | "open" | "reconnecting" | "closed";

export interface SetiStreamHandlers {
  /** First event after (re)connect: { edge, session, edgeConnected }. */
  onHello?: (info: { edge: string; session: string; edgeConnected: boolean }) => void;
  /** A full capture-pane snapshot of the session's visible window. */
  onFrame?: (content: string) => void;
  /** Idle keep-alive carrying the latest edge connectivity. */
  onPing?: (info: { edgeConnected: boolean }) => void;
  onStateChange?: (state: SetiStreamState) => void;
}

export interface SetiStreamHandle {
  close: () => void;
}
