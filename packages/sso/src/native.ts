/**
 * components-F084.185 — Face ID / fingerprint login from a NATIVE app (Capacitor).
 *
 * Owner's order 27/10 2026 (via bid #5234): one generic passkey login for iOS and
 * Android that every native app reuses. BID owns the server half (its embedded
 * passkey routes, plus AASA / assetlinks.json per registered app); this module is
 * the client half, so Buzz, Jam Mobile and the next app do not each wire BID's four
 * routes and PKCE by hand.
 *
 * RUNS ON THE DEVICE, as a PUBLIC client: no client secret, PKCE instead. That is
 * why this is its own entry point with no dependencies — only fetch and Web Crypto —
 * and not part of the server client in client.ts, which is a confidential client
 * and pulls in jose.
 *
 * THE NATIVE BRIDGE IS INJECTED. `getAssertion` is the app's call into its Capacitor
 * passkey plugin (ASAuthorization on iOS, Credential Manager on Android). This module
 * owns the protocol, the PKCE pair and the error mapping; it never chooses a plugin,
 * so an app is not locked to one.
 *
 * Tokens are RETURNED, never stored: where they live on the device is the app's
 * decision (secure storage).
 */

/** What BID's /embedded/passkey/options hands the platform. */
export interface NativePasskeyOptions {
  challenge: string;
  rpId: string;
  timeout?: number;
  /** Present only if BID restricts the login to known credentials (today it does not — discoverable only). */
  allowCredentials?: { id: string; type: "public-key"; transports?: string[] }[];
  /**
   * Always "required": BID's contract (bid #5237) is that the platform must verify the
   * user (Face ID / fingerprint / PIN). Set here so no app can forget it — a passkey
   * login without user verification proves possession of the phone, not of the person.
   */
  userVerification: "required";
}

/** The WebAuthn AuthenticationResponseJSON the platform plugin returns. */
export type AuthenticationResponseJSON = Record<string, unknown> & { id: string; rawId: string; type: string; response: Record<string, unknown> };

/**
 * Thrown by the app's `getAssertion` to say WHY the platform gave no assertion.
 *
 * Anything ELSE it throws is classified by name: a WebAuthn-style `NotAllowedError`
 * or `AbortError` is the user cancelling; everything else is `platform_failed` with
 * the platform's own message. 0.22.0 treated every unknown error as "cancelled", so
 * an iOS ASAuthorizationError 1004 («app not associated with the domain») read as
 * «you cancelled» on the owner's iPhone (buzzalert #5255, 17 flows, no /verify).
 */
export class NativePasskeyPlatformError extends Error {
  constructor(readonly reason: "cancelled" | "no_credential" | "platform_failed", message?: string) {
    super(message ?? reason);
    this.name = "NativePasskeyPlatformError";
  }
}

export interface NativePasskeyLoginInput {
  /** BID's origin, e.g. https://id.broberg.ai */
  baseUrl: string;
  clientId: string;
  /** Only if this native client registered one with BID. */
  redirectUri?: string;
  /** The app's call into its Capacitor passkey plugin. */
  getAssertion: (options: NativePasskeyOptions) => Promise<AuthenticationResponseJSON>;
  /** For tests and odd runtimes. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** The token endpoint's answer, untouched. Verify the id_token where you trust the result. */
export interface NativePasskeyTokens {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  [k: string]: unknown;
}

/**
 * Five ways a login can fail, kept apart because they need opposite answers on screen:
 * - `cancelled`       — the user closed Face ID. Say nothing, or offer to try again.
 * - `no_credential`   — this phone has no passkey for BID. Offer another login / set one up.
 * - `platform_failed` — the phone's passkey system itself failed (e.g. the app is not
 *                       associated with id.broberg.ai). A setup fault, not the user — log `message`.
 * - `rejected`      — BID refused (wrong passkey, expired flow, unknown client). Do not retry blindly.
 * - `unavailable`   — BID did not answer. Retry later.
 */
export type NativePasskeyResult =
  | { ok: true; tokens: NativePasskeyTokens }
  | { ok: false; reason: "cancelled" | "no_credential" | "platform_failed" | "rejected" | "unavailable"; message: string };

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A fresh PKCE pair (S256). Exported for tests and for apps that log in by other routes. */
export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

/** An error the app did NOT classify: a cancel by its standard name, otherwise a platform failure. */
function platformReason(e: unknown): "cancelled" | "platform_failed" {
  const name = typeof e === "object" && e !== null ? String((e as { name?: unknown }).name ?? "") : "";
  return name === "NotAllowedError" || name === "AbortError" ? "cancelled" : "platform_failed";
}

class Step extends Error {
  constructor(readonly reason: "rejected" | "unavailable", message: string) {
    super(message);
  }
}

/**
 * The whole login: start → options → platform assertion → verify → complete → token.
 * Never throws; every outcome is a value.
 */
export async function nativePasskeyLogin(input: NativePasskeyLoginInput): Promise<NativePasskeyResult> {
  const f = input.fetch ?? fetch;
  const base = input.baseUrl.replace(/\/+$/, "");

  const call = async (method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        method,
        headers: body ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Step("unavailable", `BID did not answer ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* a body that is not JSON is judged by its status below */
    }
    if (res.status >= 500) throw new Step("unavailable", `BID answered ${res.status} on ${path}`);
    if (!res.ok) {
      const err = typeof json.error === "string" ? json.error : `http_${res.status}`;
      throw new Step("rejected", `BID refused ${path}: ${err}`);
    }
    return json;
  };

  try {
    const { verifier, challenge } = await createPkcePair();

    const start = await call("POST", "/embedded/passkey/start", {
      client_id: input.clientId,
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
    });
    const flowId = start.flow_id;
    if (typeof flowId !== "string" || !flowId) throw new Step("rejected", "BID started no flow (no flow_id)");

    const raw = await call("GET", `/embedded/passkey/options?flow_id=${encodeURIComponent(flowId)}`);
    if (typeof raw.challenge !== "string" || typeof raw.rpId !== "string") throw new Step("rejected", "BID's options carry no challenge/rpId");
    const options = { ...raw, userVerification: "required" } as unknown as NativePasskeyOptions;

    let assertion: AuthenticationResponseJSON;
    try {
      assertion = await input.getAssertion(options);
    } catch (e) {
      const reason = e instanceof NativePasskeyPlatformError ? e.reason : platformReason(e);
      return { ok: false, reason, message: e instanceof Error ? e.message : String(e) };
    }

    await call("POST", "/embedded/passkey/verify", { flow_id: flowId, response: assertion });
    const done = await call("POST", "/embedded/passkey/complete", { flow_id: flowId });
    if (done.next !== "done" || typeof done.code !== "string") throw new Step("rejected", `BID did not finish the login (next: ${String(done.next)})`);

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: done.code,
      code_verifier: verifier,
      client_id: input.clientId,
      ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
    });
    let res: Response;
    try {
      res = await f(`${base}/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form.toString() });
    } catch (e) {
      throw new Step("unavailable", `BID did not answer /oauth2/token: ${e instanceof Error ? e.message : String(e)}`);
    }
    const tokens = (await res.json().catch(() => ({}))) as NativePasskeyTokens;
    if (res.status >= 500) throw new Step("unavailable", `BID answered ${res.status} on /oauth2/token`);
    if (!res.ok || typeof tokens.access_token !== "string") throw new Step("rejected", `BID refused the code: ${String((tokens as { error?: unknown }).error ?? res.status)}`);
    return { ok: true, tokens };
  } catch (e) {
    if (e instanceof Step) return { ok: false, reason: e.reason, message: e.message };
    return { ok: false, reason: "unavailable", message: e instanceof Error ? e.message : String(e) };
  }
}
