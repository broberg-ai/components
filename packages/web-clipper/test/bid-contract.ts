// F099.24 — a fake BID that follows F084.166 contract v1 (broberg-ai/broberg-id@f9e148d «KONTRAKT v1»).
import type { IdentityApi, KeyValueStorage } from "../src/auth";

export const ISS = "https://id.broberg.ai";
export const REDIRECT = "https://abcdefghijklmnop.chromiumapp.org/";
const jwt = (payload: object) => `x.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.y`;
export const identity: IdentityApi = { getRedirectURL: () => REDIRECT, launchWebAuthFlow: async () => { throw new Error("no window in the embedded login"); } };
export function memory(): KeyValueStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
}
export async function s256(v: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  let s = ""; for (const x of d) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** BID per contract v1: the mail code is 481072, the app code 123456, the SMS code 777777; 5 wrong codes lock the flow. */
export function contractBid(o: { secondFactor?: ("totp" | "sms")[]; embedded?: boolean } = {}) {
  const flows = new Map<string, { email: string; challenge: string; wrong: number; stage: "code" | "second"; smsSent: boolean }>();
  const codes = new Map<string, string>(); // authorization code → challenge
  const passkeys = new Map<string, { challenge: string; confirmed: boolean }>();
  const log: { path: string; body: Record<string, unknown>; credentials?: RequestCredentials }[] = [];
  let n = 0;
  const err = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const issue = (challenge: string) => { const c = `ac-${++n}`; codes.set(c, challenge); return Response.json({ next: "done", code: c }); };
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/.well-known/openid-configuration") return Response.json({ issuer: ISS, authorization_endpoint: `${ISS}/oauth2/authorize`, token_endpoint: `${ISS}/oauth2/token` });
    if (url.pathname === "/oauth2/token") {
      const p = new URLSearchParams(String(init?.body));
      log.push({ path: url.pathname, body: Object.fromEntries(p), credentials: init?.credentials });
      const challenge = codes.get(p.get("code") ?? "");
      if (!challenge || (await s256(p.get("code_verifier") ?? "")) !== challenge || p.get("redirect_uri") !== REDIRECT) return err(400, { error: "invalid_grant" });
      codes.delete(p.get("code")!);
      return Response.json({ access_token: "at-emb", refresh_token: "rt-emb", expires_in: 3600, id_token: jwt({ sub: "user-42" }) });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    log.push({ path: url.pathname, body, credentials: init?.credentials });
    if (o.embedded === false) return err(403, { error: "client_not_embedded" });
    if (url.pathname === "/embedded/start") {
      if (typeof body.email !== "string" || body.code_challenge_method !== "S256") return err(400, { error: "invalid_request" });
      const id = `flow-${++n}`;
      flows.set(id, { email: body.email, challenge: String(body.code_challenge), wrong: 0, stage: "code", smsSent: false });
      return Response.json({ flow_id: id, expires_in: 600 });
    }
    // F099.25 — contract v2 (broberg-ai/broberg-id@3c8e6bc «KONTRAKT v2»): the frame confirms the key at BID; complete swaps it for a code.
    if (url.pathname === "/embedded/passkey/start") {
      if (body.code_challenge_method !== "S256" || typeof body.code_challenge !== "string") return err(400, { error: "invalid_request" });
      const id = `pk-${++n}`;
      passkeys.set(id, { challenge: body.code_challenge, confirmed: false });
      return Response.json({ flow_id: id, frame_url: `${ISS}/embedded/passkey/frame?flow=${id}`, expires_in: 600 });
    }
    if (url.pathname === "/embedded/passkey/complete") {
      const p = passkeys.get(String(body.flow_id));
      if (!p) return err(400, { error: "expired" });
      if (!p.confirmed) return err(400, { error: "invalid_request" });
      passkeys.delete(String(body.flow_id));
      return issue(p.challenge);
    }
    const f = flows.get(String(body.flow_id));
    if (!f) return err(400, { error: "expired" });
    const wrong = () => { f.wrong++; return f.wrong >= 5 ? err(429, { error: "locked", retry_after: 900 }) : err(400, { error: "invalid_code", attempts_left: 5 - f.wrong }); };
    if (url.pathname === "/embedded/verify") {
      if (body.code !== "481072") return wrong();
      if (o.secondFactor?.length) { f.stage = "second"; f.wrong = 0; return Response.json({ next: "second_factor", methods: o.secondFactor }); }
      return issue(f.challenge);
    }
    if (url.pathname === "/embedded/second-factor/sms") { f.smsSent = true; return Response.json({ sent: true }); }
    if (url.pathname === "/embedded/second-factor") {
      const ok = (body.method === "totp" && body.code === "123456") || (body.method === "sms" && f.smsSent && body.code === "777777");
      return ok ? issue(f.challenge) : wrong();
    }
    return err(404, {});
  }) as typeof fetch;
  /** What BID's frame does when the user's Face ID succeeds: the key is confirmed at BID for this flow. */
  const confirmPasskey = (flowId: string) => { const p = passkeys.get(flowId); if (p) p.confirmed = true; };
  return { fetchImpl, log, flows, passkeys, confirmPasskey };
}
