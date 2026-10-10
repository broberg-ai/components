/**
 * F084.154 — fetch a Broberg ID ticket WITHOUT a key (broberg-id-F087.10/.11).
 *
 * The sending half of F084.153: a workload proves who it is with the identity its
 * platform already gives it, and BID exchanges that for a short-lived ticket
 * (RFC 8693 token exchange). No secret is stored anywhere.
 *
 *   Fly.io          POST unix:/.fly/api  /v1/tokens/oidc  {aud: issuer}
 *   GitHub Actions  GET  $ACTIONS_ID_TOKEN_REQUEST_URL&audience=issuer
 *                   (needs `permissions: id-token: write` in the workflow)
 *   then            POST {issuer}/oauth2/token  grant_type=…token-exchange
 *
 * Reference implementation: broberg-id/.github/workflows/ticket-probe.yml.
 * The ticket itself is never logged or put in an error message.
 */
import { existsSync } from "node:fs";
import { request } from "node:http";
import { createDpopKey, createDpopProof, type DpopKey } from "./dpop.js";

export const DEFAULT_ISSUER = "https://id.broberg.ai";
const FLY_SOCKET = "/.fly/api";

/** No platform identity to exchange: not on Fly, not in a GitHub Actions job with id-token: write. */
export class NoWorkloadIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoWorkloadIdentityError";
  }
}

/**
 * BID refused the exchange. `code` is BID's own error name (the part of
 * error_description before the colon, e.g. `no_rule_for_audience`), `status` the
 * HTTP status. A 4xx is PERMANENT for this request — fix the rule, do not retry.
 */
export class TicketExchangeError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "TicketExchangeError";
  }
}

/** BID or the platform could not be reached, or answered 5xx. TRANSIENT — retry later. */
export class TicketUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketUnavailableError";
  }
}

export interface TicketClientOptions {
  issuer?: string;
  /** Renew this many seconds before exp. Default 30. */
  renewBeforeSec?: number;
  /** Injectable for tests. */
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Ask Fly's machine API for an OIDC token. Default: POST over the /.fly/api unix socket. */
  flyOidc?: (aud: string) => Promise<string>;
  /** Whether the Fly socket is present. Default: checks /.fly/api. */
  onFly?: () => boolean;
  /**
   * F084.157 — ask BID for DPoP-BOUND tickets. One ES256 key per client
   * (non-extractable, never stored); every call then needs a proof, which
   * `authHeaders` makes. Default false: bearer tickets, exactly as before.
   */
  dpop?: boolean;
}

/** Headers for one call to a receiver. With `dpop`, `authorization` is `DPoP <ticket>` and `dpop` is the proof. */
export interface TicketAuthHeaders {
  authorization: string;
  dpop?: string;
}

export interface TicketClient {
  /** A ticket for `audience` (BID's short name, e.g. "discovery"), from cache while it is fresh. */
  get(opts: { audience: string; scope?: string }): Promise<string>;
  /**
   * F084.157 — the headers for ONE request to a receiver: a ticket plus, with
   * `dpop`, a fresh proof bound to this method and URL (use it once). Without
   * `dpop`: `{ authorization: "Bearer <ticket>" }`.
   */
  authHeaders(opts: { audience: string; scope?: string; method: string; url: string }): Promise<TicketAuthHeaders>;
}

function flyOidcOverSocket(aud: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ aud });
    const req = request(
      { socketPath: FLY_SOCKET, path: "/v1/tokens/oidc", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) resolve(data.trim());
          else reject(new TicketUnavailableError(`Fly OIDC answered ${res.statusCode}`));
        });
      },
    );
    req.on("error", (e) => reject(new TicketUnavailableError(`Fly OIDC socket: ${e.message}`)));
    req.end(body);
  });
}

/** Seconds since the epoch at which a JWT expires, or null if it cannot be read. */
function jwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function createTicketClient(options: TicketClientOptions = {}): TicketClient {
  const issuer = (options.issuer ?? DEFAULT_ISSUER).replace(/\/+$/, "");
  const renewBeforeSec = options.renewBeforeSec ?? 30;
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const flyOidc = options.flyOidc ?? flyOidcOverSocket;
  const onFly = options.onFly ?? (() => !!env.FLY_APP_NAME && existsSync(FLY_SOCKET));

  const cache = new Map<string, { token: string; exp: number }>();
  const inFlight = new Map<string, Promise<string>>();
  let dpopKey: Promise<DpopKey> | null = null;
  const ownKey = () => (dpopKey ??= createDpopKey());

  async function platformToken(): Promise<string> {
    if (onFly()) return flyOidc(issuer);
    const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (url && bearer) {
      let res: Response;
      try {
        res = await fetchImpl(`${url}&audience=${encodeURIComponent(issuer)}`, { headers: { authorization: `Bearer ${bearer}` } });
      } catch (e) {
        throw new TicketUnavailableError(`GitHub OIDC endpoint unreachable: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!res.ok) throw new TicketUnavailableError(`GitHub OIDC endpoint answered ${res.status}`);
      const { value } = (await res.json()) as { value?: string };
      if (!value) throw new TicketUnavailableError("GitHub OIDC endpoint returned no token");
      return value;
    }
    throw new NoWorkloadIdentityError(
      "No workload identity to exchange for a ticket: not on a Fly machine (FLY_APP_NAME + /.fly/api) and not in a GitHub Actions job " +
        "(ACTIONS_ID_TOKEN_REQUEST_URL/_TOKEN — add `permissions: id-token: write`). A Mac session keeps using its session key.",
    );
  }

  async function exchange(audience: string, scope: string | undefined): Promise<{ token: string; exp: number }> {
    const subject = await platformToken();
    const form = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: subject,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      audience,
    });
    if (scope) form.set("scope", scope);
    let res: Response;
    try {
      const tokenUrl = `${issuer}/oauth2/token`;
      const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
      if (options.dpop) headers.dpop = await createDpopProof(await ownKey(), { method: "POST", url: tokenUrl, now });
      res = await fetchImpl(tokenUrl, { method: "POST", headers, body: form });
    } catch (e) {
      throw new TicketUnavailableError(`${issuer} unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    let body: { access_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* a non-JSON answer is handled by the status checks below */
    }
    if (res.status >= 500) throw new TicketUnavailableError(`${issuer} answered ${res.status}`);
    if (!res.ok || !body.access_token) {
      const desc = body.error_description ?? "";
      const code = desc.includes(":") ? desc.slice(0, desc.indexOf(":")).trim() : body.error ?? "exchange_refused";
      throw new TicketExchangeError(`Broberg ID refused the ticket for ${audience}: ${desc || body.error || res.status}`, code, res.status);
    }
    const nowSec = Math.floor(now() / 1000);
    const exp = jwtExp(body.access_token) ?? nowSec + (body.expires_in ?? 300);
    return { token: body.access_token, exp };
  }

  const client: TicketClient = {
    async authHeaders({ audience, scope, method, url }) {
      const ticket = await client.get({ audience, scope });
      if (!options.dpop) return { authorization: `Bearer ${ticket}` };
      return { authorization: `DPoP ${ticket}`, dpop: await createDpopProof(await ownKey(), { method, url, ticket, now }) };
    },
    async get({ audience, scope }) {
      const key = `${audience} ${scope ?? ""}`;
      const hit = cache.get(key);
      if (hit && hit.exp - renewBeforeSec > now() / 1000) return hit.token;
      const pending = inFlight.get(key);
      if (pending) return pending;
      const p = exchange(audience, scope)
        .then((t) => {
          cache.set(key, t);
          return t.token;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, p);
      return p;
    },
  };
  return client;
}

let shared: TicketClient | null = null;
/** A ticket from the process-wide client (one cache per process). */
export function fetchTicket(opts: { audience: string; scope?: string }): Promise<string> {
  shared ??= createTicketClient();
  return shared.get(opts);
}
