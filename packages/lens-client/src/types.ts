// @broberg/lens-client — the wire types for the HOSTED Lens (lens.cardmem.com).
//
// These mirror lens-cloud's frozen HTTP contract: the request bodies are the
// engine's captureBody/flowBody PLUS one optional `auth` (mintEndpoint) field;
// the responses are the SERVICE shape (a `screenshot_url` into /artifact, NOT
// raw PNG bytes). They are RE-DECLARED here (not imported from
// @broberg/lens-engine) so this client carries NO Playwright dependency.

export type CaptureMode = "viewport" | "fullPage" | "element";

/** Self-healing layered locator. A step target is a plain string (CSS selector
 *  or a bare data-testid value) OR this spec, tried in fixed priority order:
 *  testid → css → role → label → placeholder → text → vision. First unique
 *  visible match wins; a vision-only DOM-miss fails cleanly (never guesses). */
export interface LocateSpec {
  testid?: string;
  css?: string;
  role?: string;
  /** Accessible name for `role` (getByRole(role, { name })). */
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  /** Exact match for name/label/placeholder/text (default false = fuzzy). */
  exact?: boolean;
  /** Pick the nth match when a layer is ambiguous (default 0). */
  nth?: number;
  /** Natural-language description for the vision (Set-of-Marks) fallback. */
  vision?: string;
}

export type Target = string | LocateSpec;

export interface Viewport {
  width: number;
  height: number;
}

/** Mint-endpoint auth to capture behind the TARGET's login (this is the
 *  target's login, NOT auth against Lens itself — that is the Bearer token). */
export interface MintAuth {
  adapter: "mintEndpoint";
  url: string;
  secret?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** Playwright storageState (cookies + per-origin localStorage). */
export interface StorageState {
  cookies?: Array<Record<string, unknown>>;
  origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>;
}

export interface UploadFile {
  name: string;
  mimeType?: string;
  url?: string;
  content_base64?: string;
}

export type FlowStep =
  | { action: "goto"; url: string; waitFor?: number | string }
  | { action: "click"; target: Target }
  | { action: "fill"; target: Target; value: string }
  | { action: "type"; target: Target; text: string }
  | { action: "press"; key: string; target?: Target }
  | { action: "select"; target: Target; value: string }
  | { action: "upload"; target: Target; files: UploadFile[] }
  | { action: "waitFor"; target?: Target; ms?: number }
  | { action: "assert"; js: string }
  | { action: "expectText"; target: Target; text: string }
  | { action: "expectVisible"; target: Target }
  | { action: "screenshot"; name?: string; mode?: CaptureMode; target?: Target };

export interface CaptureRequest {
  url: string;
  mode?: CaptureMode;
  /** Required for `element` mode: a CSS selector or a bare data-testid value. */
  selector?: string;
  viewport?: Viewport;
  device?: string;
  waitFor?: number | string;
  /** Pre-resolved storageState to capture behind a login. */
  storageState?: StorageState;
  /** OR let the service mint one from the target's mint endpoint. */
  auth?: MintAuth;
}

export interface FlowRequest {
  name?: string;
  base_url: string;
  viewport?: Viewport;
  device?: string;
  /** Hint that this flow mutates real target state (echoed back). */
  mutates?: boolean;
  steps: FlowStep[];
  storageState?: StorageState;
  auth?: MintAuth;
}

// ── Response shapes (SERVICE-level — the PNG is uploaded to R2 server-side) ────

export interface CaptureResult {
  run_id: string;
  /** A `/artifact?key=…` URL (fetch it with fetchArtifact); null if R2 is dark. */
  screenshot_url: string | null;
  dom_hash: string;
  status: "ok";
  width: number;
  height: number;
  final_url: string;
  title: string;
}

export interface FlowStepResult {
  index: number;
  action: string;
  status: "ok" | "failed";
  ms: number;
  detail?: string;
  /** Which self-healing layer resolved the target (testid/css/role/…/vision).
   *  Surfaced so a consumer can log a 'degraded-match' when it wasn't testid. */
  resolved_via?: string;
  error?: string;
  screenshot_run_id?: string;
  screenshot_url?: string;
}

export interface FlowResult {
  run_id: string;
  name?: string;
  /** A `failed` flow is a VALID result (a failing step stops it + pins a
   *  screenshot) — read `steps` to see which step + why. It is NOT thrown. */
  status: "passed" | "failed";
  final_url?: string;
  steps: FlowStepResult[];
}

/** Thrown ONLY for transport/auth failures (bad token, ship-dark, network after
 *  retry) — never for a `failed` flow, which comes back as data. */
export class LensClientError extends Error {
  readonly status?: number;
  readonly kind: "auth" | "unavailable" | "network" | "http";
  constructor(message: string, opts: { status?: number; kind: LensClientError["kind"]; cause?: unknown }) {
    super(message);
    this.name = "LensClientError";
    this.status = opts.status;
    this.kind = opts.kind;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}
