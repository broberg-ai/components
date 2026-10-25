// F084.179 — exchangeUserToken: a USER's BID login exchanged for a ticket to one receiver
// (BID F087.37, broberg-ai/broberg-id@7b714cc src/token-exchange.ts). BID is faked; the request
// it receives is asserted strictly, because the shape IS the contract.
import { describe, expect, it } from "vitest";
import { createDpopKey, exchangeUserToken, TicketExchangeError, TicketUnavailableError } from "../src/index";

const ISS = "https://id.broberg.ai";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const EXP = 2_000_000_000;
const TICKET = `${b64({ alg: "EdDSA" })}.${b64({ sub: "u-1", principal_type: "user", exp: EXP })}.sig`;

type Call = { url: string; headers: Record<string, string>; form: Record<string, string> };
function fakeBid(answer: () => Response | Promise<Response> = () => Response.json({ access_token: TICKET, token_type: "Bearer", expires_in: 300 })) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, headers: { ...(init.headers as Record<string, string>) }, form: Object.fromEntries(new URLSearchParams(String(init.body))) });
    return answer();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("F084.179 — exchangeUserToken", () => {
  it("a confidential app: client_id + client_secret in the BODY (client_secret_post — what BID registers), NO Basic header; the user token as access_token type, resource + scope → {token, exp}", async () => {
    // F084.184 — BID enforces the registered method. Basic here was 400 invalid_client
    // «client_unauthenticated» at buzzalert-admin (bid #4792).
    const bid = fakeBid();
    const r = await exchangeUserToken({ clientId: "jam", clientSecret: "s:e%c", subjectToken: "user-at", resource: "https://cardmem.com", scope: "cardmem:mockups:read", fetchImpl: bid.fetchImpl });
    expect(r).toStrictEqual({ token: TICKET, exp: EXP });
    expect(bid.calls.map((c) => c.url)).toStrictEqual([`${ISS}/oauth2/token`]);
    expect(bid.calls[0]!.headers.authorization).toBeUndefined();
    expect(bid.calls[0]!.form).toStrictEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "user-at",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      resource: "https://cardmem.com",
      scope: "cardmem:mockups:read",
      client_id: "jam",
      client_secret: "s:e%c",
    });
    expect(bid.calls[0]!.headers.dpop).toBeUndefined();
  });

  it("a public app (no secret): client_id in the body, no authorization header; audience instead of resource", async () => {
    const bid = fakeBid();
    await exchangeUserToken({ clientId: "trail-clipper", subjectToken: "user-at", audience: "trail" , fetchImpl: bid.fetchImpl });
    expect(bid.calls[0]!.headers.authorization).toBeUndefined();
    expect(bid.calls[0]!.form).toStrictEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "user-at",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      audience: "trail",
      client_id: "trail-clipper",
    });
  });

  it("with dpopKey: a proof bound to POST on the token endpoint, no ath", async () => {
    const bid = fakeBid();
    await exchangeUserToken({ clientId: "jam", subjectToken: "user-at", resource: "https://cardmem.com", dpopKey: await createDpopKey(), fetchImpl: bid.fetchImpl });
    const proof = bid.calls[0]!.headers.dpop!;
    const p = JSON.parse(Buffer.from(proof.split(".")[1]!, "base64url").toString());
    expect([p.htm, p.htu, "ath" in p]).toStrictEqual(["POST", `${ISS}/oauth2/token`, false]);
  });

  it.each([
    ["subject_token_inactive", 400, "invalid_grant"],
    ["client_mismatch", 400, "invalid_client"],
    ["no_rule_for_audience", 400, "invalid_target"],
  ])("a refusal (%s) is TicketExchangeError with BID's code and status — and never carries the user's token", async (code, status, error) => {
    const bid = fakeBid(() => Response.json({ error, error_description: `${code}: detail` }, { status }));
    const e = await exchangeUserToken({ clientId: "jam", subjectToken: "SECRET-USER-TOKEN", resource: "https://cardmem.com", fetchImpl: bid.fetchImpl }).catch((x) => x);
    expect(e).toBeInstanceOf(TicketExchangeError);
    expect([e.code, e.status]).toStrictEqual([code, status]);
    expect(String(e.message)).not.toContain("SECRET-USER-TOKEN");
  });

  it("a 5xx or no answer is TicketUnavailableError (transient)", async () => {
    await expect(exchangeUserToken({ clientId: "jam", subjectToken: "t", resource: "https://x", fetchImpl: fakeBid(() => new Response("", { status: 503 })).fetchImpl })).rejects.toBeInstanceOf(TicketUnavailableError);
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(exchangeUserToken({ clientId: "jam", subjectToken: "t", resource: "https://x", fetchImpl: down })).rejects.toBeInstanceOf(TicketUnavailableError);
  });

  it("NEGATIVE CONTROL: no resource and no audience refuses BEFORE anything is sent", async () => {
    const bid = fakeBid();
    const e = await exchangeUserToken({ clientId: "jam", subjectToken: "t", fetchImpl: bid.fetchImpl }).catch((x) => x);
    expect(e).toBeInstanceOf(TicketExchangeError);
    expect(e.code).toBe("malformed_request");
    expect(bid.calls).toStrictEqual([]);
  });
});
