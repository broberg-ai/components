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

export interface SetiInputResult {
  ok: boolean;
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
