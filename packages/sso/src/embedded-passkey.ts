// components-F084.186 — the BROWSER half of the embedded passkey login.
//
// BID's contract (broberg-id src/embedded-login.ts, measured by bid #48995, 6 Nov 2026):
//   POST {issuer}/embedded/passkey/start   {client_id, code_challenge, code_challenge_method:"S256",
//                                          nonce, redirect_uri} → {flow_id, frame_url, expires_in}
//   iframe frame_url (always on the issuer) → postMessage to the parent:
//                                          {type:"bid-embedded-passkey", flow_id, ok:true}
//                                          {type:"bid-embedded-passkey", flow_id, ok:false,
//                                           error:"not_found"|"cancelled"|"failed"}
//   POST {issuer}/embedded/passkey/complete {client_id, flow_id} → {next:"done", code, passkey_setup?}
// BID accepts start/complete only by the page's Origin (on the client's list) — which is why this
// runs here and not on your server.
//
// What this module does NOT have, on purpose: the PKCE verifier and the nonce's partner. Your
// server makes them (client.embeddedPasskey.begin) and keeps them in a sealed cookie; this gets
// only the challenge, and hands back only the code. A browser that held the verifier could be
// fed an attacker's code + verifier and sign the user in to the attacker's account.
//
// No Node, no jose: this file is imported by the page.

export const PASSKEY_MESSAGE_TYPE = "bid-embedded-passkey";

/** Why a passkey login did not produce a code. BID's three, plus the four this side can see. */
export type EmbeddedPasskeyFailure =
  | "not_found" // BID: no passkey for this browser/account
  | "cancelled" // BID: the user dismissed the prompt
  | "failed" // BID: the ceremony failed
  | "refused" // BID answered 4xx (e.g. this origin is not on the client's list, invalid_redirect_uri)
  | "unavailable" // network error, 5xx, or an answer that is not the contract
  | "timeout" // no answer from the frame before the flow expired
  | "aborted"; // your AbortSignal

export class EmbeddedPasskeyError extends Error {
  readonly reason: EmbeddedPasskeyFailure;
  readonly status?: number;
  constructor(reason: EmbeddedPasskeyFailure, message: string, status?: number) {
    super(message);
    this.name = "EmbeddedPasskeyError";
    this.reason = reason;
    if (status !== undefined) this.status = status;
  }
}

/** Exactly what client.embeddedPasskey.begin() returns as `browser`. */
export interface EmbeddedPasskeyBrowserStart {
  issuer: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce: string;
}

export interface EmbeddedPasskeyOptions {
  /** Where the frame goes. You style the container; the frame fills it. */
  container: HTMLElement;
  /** Give up after this many ms (capped at the flow's own lifetime). Default: the flow's lifetime. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Accessible name of the frame. Default "Log ind med adgangsnøgle". */
  iframeTitle?: string;
  /** For tests. */
  fetch?: typeof fetch;
  window?: Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">;
  document?: Pick<Document, "createElement">;
}

export interface EmbeddedPasskeyResult {
  /** Post ONLY this to your server; it calls client.embeddedPasskey.complete({ code, flow }). */
  code: string;
  passkeySetup?: { setupId: string; frameUrl: string; expiresIn: number };
}

async function call(
  f: typeof fetch,
  url: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    throw new EmbeddedPasskeyError("unavailable", `BID did not answer: ${e instanceof Error ? e.message : String(e)}`);
  }
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    // the status says enough
  }
  if (!res.ok) {
    const code = typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
    throw new EmbeddedPasskeyError(res.status >= 500 ? "unavailable" : "refused", `BID refused ${new URL(url).pathname}: ${code}`, res.status);
  }
  return json;
}

/**
 * Run the passkey ceremony in a BID frame and return the authorization code.
 * Always settles: a code, or an EmbeddedPasskeyError — never a promise that hangs.
 */
export async function loginWithEmbeddedPasskey(
  start: EmbeddedPasskeyBrowserStart,
  options: EmbeddedPasskeyOptions,
): Promise<EmbeddedPasskeyResult> {
  const f = options.fetch ?? fetch;
  const win = options.window ?? window;
  const doc = options.document ?? document;
  const issuerOrigin = new URL(start.issuer).origin;
  if (options.signal?.aborted) throw new EmbeddedPasskeyError("aborted", "aborted before start");

  const s = await call(f, `${issuerOrigin}/embedded/passkey/start`, {
    client_id: start.clientId,
    code_challenge: start.codeChallenge,
    code_challenge_method: "S256",
    nonce: start.nonce,
    redirect_uri: start.redirectUri,
  });
  const flowId = s.flow_id;
  const frameUrl = s.frame_url;
  if (typeof flowId !== "string" || typeof frameUrl !== "string") throw new EmbeddedPasskeyError("unavailable", "BID's start answer has no flow_id/frame_url");
  // A frame off the issuer's origin asking for a passkey is not something to show.
  if (new URL(frameUrl, issuerOrigin).origin !== issuerOrigin) throw new EmbeddedPasskeyError("unavailable", "BID's frame_url is not on the issuer's origin");
  const lifetimeMs = (typeof s.expires_in === "number" && s.expires_in > 0 ? s.expires_in : 600) * 1000;
  const waitMs = Math.min(options.timeoutMs ?? lifetimeMs, lifetimeMs);

  const frame = doc.createElement("iframe");
  frame.src = new URL(frameUrl, issuerOrigin).toString();
  frame.title = options.iframeTitle ?? "Log ind med adgangsnøgle";
  frame.setAttribute("allow", "publickey-credentials-get");
  frame.setAttribute("data-testid", "embedded-passkey-frame");

  let onMessage: ((e: MessageEvent) => void) | undefined;
  let onAbort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answered = new Promise<void>((resolve, reject) => {
      onMessage = (e: MessageEvent) => {
        // Only BID's own origin, only this flow. Anything else is ignored, not an error:
        // a page can receive messages from other frames and extensions.
        if (e.origin !== issuerOrigin) return;
        const d = e.data as { type?: unknown; flow_id?: unknown; ok?: unknown; error?: unknown } | null;
        if (!d || typeof d !== "object" || d.type !== PASSKEY_MESSAGE_TYPE || d.flow_id !== flowId) return;
        if (d.ok === true) return resolve();
        const reason: EmbeddedPasskeyFailure = d.error === "not_found" || d.error === "cancelled" ? d.error : "failed";
        reject(new EmbeddedPasskeyError(reason, `passkey login ${reason}`));
      };
      win.addEventListener("message", onMessage as EventListener);
      timer = win.setTimeout(() => reject(new EmbeddedPasskeyError("timeout", "no answer from the passkey frame in time")), waitMs) as unknown as ReturnType<typeof setTimeout>;
      onAbort = () => reject(new EmbeddedPasskeyError("aborted", "aborted"));
      options.signal?.addEventListener("abort", onAbort);
    });
    options.container.appendChild(frame);
    await answered;
  } finally {
    if (onMessage) win.removeEventListener("message", onMessage as EventListener);
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
    if (timer !== undefined) win.clearTimeout(timer as unknown as number);
    frame.remove();
  }

  const c = await call(f, `${issuerOrigin}/embedded/passkey/complete`, { client_id: start.clientId, flow_id: flowId });
  if (c.next !== "done" || typeof c.code !== "string" || !c.code) throw new EmbeddedPasskeyError("unavailable", "BID's complete answer has no code");
  const ps = c.passkey_setup as { setup_id?: unknown; frame_url?: unknown; expires_in?: unknown } | undefined;
  const passkeySetup =
    ps && typeof ps.setup_id === "string" && typeof ps.frame_url === "string" && new URL(ps.frame_url, issuerOrigin).origin === issuerOrigin
      ? { setupId: ps.setup_id, frameUrl: new URL(ps.frame_url, issuerOrigin).toString(), expiresIn: typeof ps.expires_in === "number" ? ps.expires_in : 600 }
      : undefined;
  return passkeySetup ? { code: c.code, passkeySetup } : { code: c.code };
}
