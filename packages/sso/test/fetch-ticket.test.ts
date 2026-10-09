// F084.154 — fetchTicket. The platforms and BID are faked; the requests they
// receive are asserted strictly, because the shape IS the contract with BID.
import { describe, expect, it } from "vitest";
import { createTicketClient, NoWorkloadIdentityError, TicketExchangeError, TicketUnavailableError } from "../src/index";

const ISS = "https://id.broberg.ai";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ticketWithExp = (exp: number) => `${b64({ alg: "EdDSA", kid: "k" })}.${b64({ sub: "svc:x", exp })}.sig`;

type Call = { url: string; method: string; headers: Record<string, string>; body: string };
function fakeBid(opts: { status?: number; body?: unknown; throws?: boolean; exp?: () => number } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)), body: init.body ? String(init.body) : "" });
    if (url.startsWith("https://gh.example/")) return Response.json({ value: "gh-oidc-token" });
    if (opts.throws) throw new TypeError("fetch failed");
    if (opts.status && opts.status !== 200) return Response.json(opts.body ?? {}, { status: opts.status });
    return Response.json({ access_token: ticketWithExp(opts.exp ? opts.exp() : Math.floor(Date.now() / 1000) + 300), token_type: "Bearer", expires_in: 300 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("AC0 — finds the workload identity and exchanges it", () => {
  it("on Fly: asks the machine API for aud=issuer, then exchanges it (strict request shape)", async () => {
    const bid = fakeBid();
    const flyAud: string[] = [];
    const c = createTicketClient({ env: {}, onFly: () => true, flyOidc: async (aud) => (flyAud.push(aud), "fly-oidc-token"), fetchImpl: bid.fetchImpl });
    const t = await c.get({ audience: "discovery", scope: "discovery:read" });
    expect(t.split(".").length).toBe(3);
    expect(flyAud).toEqual([ISS]);
    expect(bid.calls.map((x) => [x.method, x.url])).toEqual([["POST", `${ISS}/oauth2/token`]]);
    expect(bid.calls[0].headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(bid.calls[0].body))).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "fly-oidc-token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      audience: "discovery",
      scope: "discovery:read",
    });
  });

  it("in GitHub Actions: requests the id token with audience=issuer and the runtime bearer", async () => {
    const bid = fakeBid();
    const c = createTicketClient({
      env: { ACTIONS_ID_TOKEN_REQUEST_URL: "https://gh.example/token?api-version=2.0", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "rt" },
      onFly: () => false,
      fetchImpl: bid.fetchImpl,
    });
    await c.get({ audience: "discovery" });
    expect(bid.calls[0].url).toBe(`https://gh.example/token?api-version=2.0&audience=${encodeURIComponent(ISS)}`);
    expect(bid.calls[0].headers.authorization).toBe("Bearer rt");
    const form = Object.fromEntries(new URLSearchParams(bid.calls[1].body));
    expect([form.subject_token, form.audience, "scope" in form]).toEqual(["gh-oidc-token", "discovery", false]);
  });

  it("Fly wins over GitHub when both are present", async () => {
    const bid = fakeBid();
    const c = createTicketClient({ env: { ACTIONS_ID_TOKEN_REQUEST_URL: "https://gh.example/t", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "rt" }, onFly: () => true, flyOidc: async () => "fly", fetchImpl: bid.fetchImpl });
    await c.get({ audience: "discovery" });
    expect(bid.calls.map((x) => x.url)).toEqual([`${ISS}/oauth2/token`]);
  });
});

describe("AC1 — cached until shortly before exp", () => {
  it("a second call inside the lifetime makes no network call; after renewal time it fetches again", async () => {
    let nowMs = 1_800_000_000_000;
    const bid = fakeBid({ exp: () => Math.floor(nowMs / 1000) + 300 });
    let fly = 0;
    const c = createTicketClient({ env: {}, onFly: () => true, flyOidc: async () => (fly++, "fly"), fetchImpl: bid.fetchImpl, now: () => nowMs });
    const a = await c.get({ audience: "discovery", scope: "discovery:read" });
    nowMs += 200_000; // 200 s: still > 30 s before exp
    expect(await c.get({ audience: "discovery", scope: "discovery:read" })).toBe(a);
    expect([fly, bid.calls.length]).toEqual([1, 1]);
    nowMs += 75_000; // 275 s: inside the 30 s renewal window
    await c.get({ audience: "discovery", scope: "discovery:read" });
    expect([fly, bid.calls.length]).toEqual([2, 2]);
  });

  it("a different scope is a different ticket; concurrent calls share one exchange", async () => {
    const bid = fakeBid();
    const c = createTicketClient({ env: {}, onFly: () => true, flyOidc: async () => "fly", fetchImpl: bid.fetchImpl });
    await Promise.all([c.get({ audience: "discovery" }), c.get({ audience: "discovery" }), c.get({ audience: "discovery", scope: "discovery:read" })]);
    expect(bid.calls.length).toBe(2);
  });
});

describe("AC2 — typed errors", () => {
  it("no Fly, no GitHub → NoWorkloadIdentityError, and nothing is sent", async () => {
    const bid = fakeBid();
    const c = createTicketClient({ env: {}, onFly: () => false, fetchImpl: bid.fetchImpl });
    await expect(c.get({ audience: "discovery" })).rejects.toBeInstanceOf(NoWorkloadIdentityError);
    expect(bid.calls).toEqual([]);
  });

  it("BID refuses → TicketExchangeError with BID's error name and the status", async () => {
    const bid = fakeBid({ status: 400, body: { error: "invalid_target", error_description: "no_rule_for_audience: svc:x has no rule for discovery" } });
    const c = createTicketClient({ env: {}, onFly: () => true, flyOidc: async () => "fly", fetchImpl: bid.fetchImpl });
    const e = await c.get({ audience: "discovery" }).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(TicketExchangeError);
    expect([(e as TicketExchangeError).code, (e as TicketExchangeError).status]).toEqual(["no_rule_for_audience", 400]);
  });

  it("a refusal without a coloned description falls back to the OAuth error code", async () => {
    const bid = fakeBid({ status: 401, body: { error: "invalid_client" } });
    const c = createTicketClient({ env: {}, onFly: () => true, flyOidc: async () => "fly", fetchImpl: bid.fetchImpl });
    const e = await c.get({ audience: "discovery" }).then(() => null, (x: unknown) => x);
    expect([(e as TicketExchangeError).code, (e as TicketExchangeError).status]).toEqual(["invalid_client", 401]);
  });

  it("BID down or 5xx → TicketUnavailableError (transient), and a failure is not cached", async () => {
    const down = fakeBid({ throws: true });
    const c1 = createTicketClient({ env: {}, onFly: () => true, flyOidc: async () => "fly", fetchImpl: down.fetchImpl });
    await expect(c1.get({ audience: "discovery" })).rejects.toBeInstanceOf(TicketUnavailableError);
    const five = fakeBid({ status: 503 });
    const c2 = createTicketClient({ env: {}, onFly: () => true, flyOidc: async () => "fly", fetchImpl: five.fetchImpl });
    await expect(c2.get({ audience: "discovery" })).rejects.toBeInstanceOf(TicketUnavailableError);
    await expect(c2.get({ audience: "discovery" })).rejects.toBeInstanceOf(TicketUnavailableError);
    expect(five.calls.length).toBe(2);
  });

  it("the ticket never appears in an error message", async () => {
    const bid = fakeBid({ status: 400, body: { error_description: "scope_not_allowed: nope" } });
    const c = createTicketClient({ env: {}, onFly: () => true, flyOidc: async () => "SECRET-FLY-TOKEN", fetchImpl: bid.fetchImpl });
    const e = (await c.get({ audience: "discovery" }).then(() => null, (x: unknown) => x)) as Error;
    expect(e.message.includes("SECRET-FLY-TOKEN")).toBe(false);
  });
});
