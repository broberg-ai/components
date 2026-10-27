// components-F084.185 — the native (Capacitor) passkey login against a fake BID that
// implements bid #5234's four routes plus /oauth2/token, and VERIFIES PKCE for real:
// the token endpoint hashes the code_verifier and compares it with the challenge it
// was given at /start. A fake that accepted any verifier would pass a client that
// sends none.
import { describe, expect, it } from "vitest";
import { createPkcePair, nativePasskeyLogin, NativePasskeyPlatformError, type NativePasskeyOptions } from "../src/native";

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const s256 = async (v: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))));

const ASSERTION = { id: "cred-1", rawId: "cred-1", type: "public-key", response: { clientDataJSON: "x", authenticatorData: "y", signature: "z" } };

function fakeBid(opts: { verify?: (body: any) => Response | undefined; down?: string; start500?: boolean } = {}) {
  const flows = new Map<string, { clientId: string; challenge: string; verified: boolean; code?: string }>();
  const codes = new Map<string, string>(); // code -> flowId
  const calls: string[] = [];
  let n = 0;
  const f = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    calls.push(`${init.method ?? "GET"} ${u.pathname}`);
    if (opts.down && u.pathname === opts.down) throw new TypeError("fetch failed");
    const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : undefined;
    if (u.pathname === "/embedded/passkey/start") {
      if (opts.start500) return new Response("boom", { status: 503 });
      if (body.client_id !== "buzz-ios") return Response.json({ error: "unknown_client" }, { status: 400 });
      if (body.code_challenge_method !== "S256" || typeof body.code_challenge !== "string") return Response.json({ error: "pkce_required" }, { status: 400 });
      const id = `flow-${++n}`;
      flows.set(id, { clientId: body.client_id, challenge: body.code_challenge, verified: false });
      return Response.json({ flow_id: id });
    }
    if (u.pathname === "/embedded/passkey/options") {
      const fl = flows.get(u.searchParams.get("flow_id") ?? "");
      if (!fl) return Response.json({ error: "unknown_flow" }, { status: 404 });
      return Response.json({ challenge: "chal-" + u.searchParams.get("flow_id"), rpId: "id.broberg.ai", timeout: 60000 });
    }
    if (u.pathname === "/embedded/passkey/verify") {
      const custom = opts.verify?.(body);
      if (custom) return custom;
      const fl = flows.get(body.flow_id);
      if (!fl || body.response?.id !== "cred-1") return Response.json({ error: "invalid_assertion" }, { status: 400 });
      fl.verified = true;
      return Response.json({ ok: true });
    }
    if (u.pathname === "/embedded/passkey/complete") {
      const fl = flows.get(body.flow_id);
      if (!fl || !fl.verified) return Response.json({ error: "not_verified" }, { status: 400 });
      fl.code = `code-${body.flow_id}`;
      codes.set(fl.code, body.flow_id);
      return Response.json({ next: "done", code: fl.code });
    }
    if (u.pathname === "/oauth2/token") {
      const p = new URLSearchParams(String(init.body));
      const flowId = codes.get(p.get("code") ?? "");
      const fl = flowId ? flows.get(flowId) : undefined;
      if (!fl || p.get("client_id") !== fl.clientId) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const v = p.get("code_verifier");
      if (!v || (await s256(v)) !== fl.challenge) return Response.json({ error: "invalid_grant", error_description: "PKCE" }, { status: 400 });
      codes.delete(p.get("code")!); // single use
      return Response.json({ access_token: "at-" + flowId, id_token: "idt", token_type: "Bearer", expires_in: 3600 });
    }
    return new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const base = { baseUrl: "https://id.broberg.ai/", clientId: "buzz-ios" };

describe("components-F084.185 — native passkey login", () => {
  it("runs the whole flow start → options → assertion → verify → complete → token, with REAL PKCE", async () => {
    const bid = fakeBid();
    let seen: NativePasskeyOptions | undefined;
    const r = await nativePasskeyLogin({ ...base, fetch: bid.f, getAssertion: async (o) => ((seen = o), ASSERTION) });
    expect(r).toStrictEqual({ ok: true, tokens: { access_token: "at-flow-1", id_token: "idt", token_type: "Bearer", expires_in: 3600 } });
    expect(seen).toStrictEqual({ challenge: "chal-flow-1", rpId: "id.broberg.ai", timeout: 60000, userVerification: "required" });
    expect(bid.calls).toStrictEqual([
      "POST /embedded/passkey/start",
      "GET /embedded/passkey/options",
      "POST /embedded/passkey/verify",
      "POST /embedded/passkey/complete",
      "POST /oauth2/token",
    ]);
  });

  it("the user cancelling Face ID is `cancelled` — and BID is never asked to verify", async () => {
    const bid = fakeBid();
    const cancel = Object.assign(new Error("The operation either timed out or was not allowed"), { name: "NotAllowedError" });
    const r = await nativePasskeyLogin({ ...base, fetch: bid.f, getAssertion: async () => { throw cancel; } });
    expect(r.ok === false && r.reason).toBe("cancelled");
    expect(bid.calls).not.toContain("POST /embedded/passkey/verify");
  });

  it("buzzalert #5255: an UNCLASSIFIED platform error is `platform_failed` with its message — never «you cancelled»", async () => {
    const bid = fakeBid();
    const ios = Object.assign(new Error("The operation couldn't be completed. (com.apple.AuthenticationServices.AuthorizationError error 1004.)"), { name: "Error", code: 1004 });
    const r = await nativePasskeyLogin({ ...base, fetch: bid.f, getAssertion: async () => { throw ios; } });
    expect(r).toStrictEqual({ ok: false, reason: "platform_failed", message: ios.message });
    expect(bid.calls).not.toContain("POST /embedded/passkey/verify");
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const r2 = await nativePasskeyLogin({ ...base, fetch: fakeBid().f, getAssertion: async () => { throw abort; } });
    expect(r2.ok === false && r2.reason).toBe("cancelled");
    const explicit = await nativePasskeyLogin({ ...base, fetch: fakeBid().f, getAssertion: async () => { throw new NativePasskeyPlatformError("platform_failed", "x"); } });
    expect(explicit.ok === false && explicit.reason).toBe("platform_failed");
  });

  it("no passkey on the phone is `no_credential`, not cancelled", async () => {
    const r = await nativePasskeyLogin({ ...base, fetch: fakeBid().f, getAssertion: async () => { throw new NativePasskeyPlatformError("no_credential"); } });
    expect(r.ok === false && r.reason).toBe("no_credential");
  });

  it("BID refusing the assertion is `rejected`, and no token is requested", async () => {
    const bid = fakeBid({ verify: () => Response.json({ error: "invalid_assertion" }, { status: 400 }) });
    const r = await nativePasskeyLogin({ ...base, fetch: bid.f, getAssertion: async () => ASSERTION });
    expect(r.ok === false && r.reason).toBe("rejected");
    expect(r.ok === false && r.message).toContain("invalid_assertion");
    expect(bid.calls).not.toContain("POST /oauth2/token");
  });

  it("an unknown client is `rejected` at /start", async () => {
    const r = await nativePasskeyLogin({ ...base, clientId: "nobody", fetch: fakeBid().f, getAssertion: async () => ASSERTION });
    expect(r.ok === false && r.reason).toBe("rejected");
  });

  it("BID not answering is `unavailable` — a network failure AND a 5xx", async () => {
    const down = await nativePasskeyLogin({ ...base, fetch: fakeBid({ down: "/embedded/passkey/options" }).f, getAssertion: async () => ASSERTION });
    expect(down.ok === false && down.reason).toBe("unavailable");
    const five = await nativePasskeyLogin({ ...base, fetch: fakeBid({ start500: true }).f, getAssertion: async () => ASSERTION });
    expect(five.ok === false && five.reason).toBe("unavailable");
  });

  it("NEGATIVE CONTROL on the fake: a WRONG verifier is refused, so the PKCE test above can see a broken client", async () => {
    const bid = fakeBid();
    const start = await (await bid.f("https://id.broberg.ai/embedded/passkey/start", { method: "POST", body: JSON.stringify({ client_id: "buzz-ios", code_challenge: (await createPkcePair()).challenge, code_challenge_method: "S256" }) })).json();
    await bid.f("https://id.broberg.ai/embedded/passkey/verify", { method: "POST", body: JSON.stringify({ flow_id: start.flow_id, response: ASSERTION }) });
    const done = await (await bid.f("https://id.broberg.ai/embedded/passkey/complete", { method: "POST", body: JSON.stringify({ flow_id: start.flow_id }) })).json();
    const tok = await bid.f("https://id.broberg.ai/oauth2/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: done.code, code_verifier: "wrong", client_id: "buzz-ios" }).toString() });
    expect(tok.status).toBe(400);
  });

  it("createPkcePair: S256 of the verifier is the challenge, and two pairs differ", async () => {
    const a = await createPkcePair();
    const b = await createPkcePair();
    expect(await s256(a.verifier)).toBe(a.challenge);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("the /native entry imports nothing — it runs on a phone without the server client", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${process.cwd()}/src/native.ts`, "utf8");
    expect(src.match(/^import .* from /gm)).toBeNull();
  });
});
