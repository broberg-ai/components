// F024.8 — "you are a bot" and "we could not ask" must not be one answer.
//
// The browser half of this package learned this in F024.7 ("never solved" and
// "never loaded" looked identical). The server half kept the same defect, and it
// reached production: fd-sundhed's public contact form — the route for 16,830
// municipal employees from 1 September — renders our `false` as "Vi kunne ikke
// bekræfte at du er et menneske. Prøv igen." A real person gets told she is not
// human because Cloudflare hiccuped, and "try again" cannot help her.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  verifyTurnstile,
  validateTurnstile,
  applySpamGauntlet,
  _resetRateLimiter,
} from "../src/server";

afterEach(() => {
  vi.unstubAllGlobals();
  _resetRateLimiter();
});

/** Answer siteverify with a given status + raw body. */
function reply(status: number, body: string) {
  const fn = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** A fetch that never answers, but DOES honour the abort signal — so the test
 *  proves the signal is wired through, not merely that we catch a named error. */
function neverAnswers() {
  const fn = vi.fn(
    (_url: any, init: any) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("verifyTurnstile — three outcomes, and they are structurally distinct", () => {
  it("Cloudflare says yes → { ok: true }", async () => {
    reply(200, JSON.stringify({ success: true }));
    expect(await verifyTurnstile("t", "s")).toEqual({ ok: true });
  });

  it("Cloudflare says no → rejected, carrying its error codes", async () => {
    reply(200, JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }));
    expect(await verifyTurnstile("t", "s")).toEqual({
      ok: false,
      reason: "rejected",
      errorCodes: ["invalid-input-response"],
    });
  });

  it("THE CASE THAT REACHED PRODUCTION: answered, parsed, and said neither yes nor no → unavailable", async () => {
    // Before F024.8 this returned false and became "you failed the bot check".
    // Absence of a verdict is not a verdict.
    reply(200, JSON.stringify({ messages: ["hello"] }));
    const r = await verifyTurnstile("t", "s");
    expect(r).toMatchObject({ ok: false, reason: "unavailable" });
    expect(r).not.toMatchObject({ reason: "rejected" });
  });

  it.each([
    ["a 200 with an HTML body", 200, "<html>challenge</html>", "not JSON"],
    ["a 500", 500, "upstream error", "answered 500"],
    ["a 403", 403, "{}", "answered 403"],
  ])("%s → unavailable, and the detail names the cause", async (_label, status, body, expected) => {
    reply(status, body);
    const r = await verifyTurnstile("t", "s");
    expect(r).toMatchObject({ ok: false, reason: "unavailable" });
    expect((r as any).detail).toContain(expected);
  });

  it("a network failure → unavailable, never a throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const r = await verifyTurnstile("t", "s");
    expect(r).toMatchObject({ ok: false, reason: "unavailable" });
    expect((r as any).detail).toContain("ECONNRESET");
  });

  it("A TIMEOUT IS WIRED, not merely caught — the stub honours the abort signal", async () => {
    // Deterministic: no sleeping toward a window. The stub only ever settles
    // BECAUSE the signal fires, so if we stopped passing one this would hang
    // rather than pass.
    const fn = neverAnswers();
    const r = await verifyTurnstile("t", "s", { timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, reason: "unavailable" });
    expect((r as any).detail).toContain("20ms");
    expect(fn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("NEVER THROWS — every failure shape comes back as a value", async () => {
    const shapes: Array<() => void> = [
      () => reply(200, "not json"),
      () => reply(500, "{}"),
      () => reply(200, JSON.stringify({})),
      () => vi.stubGlobal("fetch", vi.fn(async () => { throw "a string, not an Error"; })),
    ];
    for (const setup of shapes) {
      vi.unstubAllGlobals();
      setup();
      await expect(verifyTurnstile("t", "s")).resolves.toBeDefined();
    }
  });

  it("the two failures are told apart by a FIELD, not by parsing prose", async () => {
    reply(200, JSON.stringify({ success: false, "error-codes": [] }));
    const rejected = await verifyTurnstile("t", "s");
    vi.unstubAllGlobals();
    reply(503, "down");
    const unavailable = await verifyTurnstile("t", "s");
    // Structural discrimination — stronger than a substring check, which cannot
    // see a message that says the right thing AND the opposite thing (F076.2).
    expect((rejected as any).reason).toBe("rejected");
    expect((unavailable as any).reason).toBe("unavailable");
    expect((rejected as any).reason).not.toBe((unavailable as any).reason);
  });
});

describe("validateTurnstile — PINNED, so upgrading does not change anyone's behaviour", () => {
  // Replace, prove, THEN remove. This function is lossy and deprecated, but it
  // is live in at least one production route, so its exact behaviour — INCLUDING
  // the parts that are wrong — is held still until callers migrate.
  it("true when Cloudflare says yes", async () => {
    reply(200, JSON.stringify({ success: true }));
    expect(await validateTurnstile("t", "s")).toBe(true);
  });

  it("false when Cloudflare says no", async () => {
    reply(200, JSON.stringify({ success: false }));
    expect(await validateTurnstile("t", "s")).toBe(false);
  });

  it("still false — not a throw — when Cloudflare answers without `success`", async () => {
    reply(200, JSON.stringify({ messages: [] }));
    expect(await validateTurnstile("t", "s")).toBe(false);
  });

  it("still THROWS on a non-JSON body, exactly as before", async () => {
    reply(200, "<html>error</html>");
    await expect(validateTurnstile("t", "s")).rejects.toThrow();
  });
});

describe("applySpamGauntlet — the policy belongs to the caller", () => {
  const turnstile = { token: "t", secret: "s" };

  it("a rejected token blocks with reason 'turnstile'", async () => {
    reply(200, JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }));
    expect(await applySpamGauntlet({ turnstile })).toEqual({ blocked: true, reason: "turnstile" });
  });

  it("a valid token passes", async () => {
    reply(200, JSON.stringify({ success: true }));
    expect(await applySpamGauntlet({ turnstile })).toEqual({ blocked: false });
  });

  it("DEFAULT is fail-closed: an unreachable Cloudflare throws, so an unguarded route 500s", async () => {
    // Preserves what this package already did for the dominant outage shape, so
    // an upgrade never silently converts somebody's 500 into a 400 that accuses
    // a human. fd-sundhed measured their route as exactly this shape.
    reply(503, "down");
    await expect(applySpamGauntlet({ turnstile })).rejects.toThrow(/NOT a failed bot check/);
  });

  it("the thrown message forbids the wrong response in as many words", async () => {
    reply(200, JSON.stringify({}));
    await expect(applySpamGauntlet({ turnstile })).rejects.toThrow(
      /do not tell the user she failed one/,
    );
  });

  it("onUnavailable:'block' returns a DISTINCT reason, never 'turnstile'", async () => {
    reply(503, "down");
    const r = await applySpamGauntlet({ turnstile: { ...turnstile, onUnavailable: "block" } });
    expect(r).toEqual({ blocked: true, reason: "turnstile-unavailable" });
    expect(r.reason).not.toBe("turnstile");
  });

  it("a rejected token is STILL 'turnstile' under onUnavailable:'block' — the split is real", async () => {
    // Without this, "block always returns turnstile-unavailable" would satisfy
    // the test above and collapse the two facts again in the opposite direction.
    reply(200, JSON.stringify({ success: false }));
    const r = await applySpamGauntlet({ turnstile: { ...turnstile, onUnavailable: "block" } });
    expect(r).toEqual({ blocked: true, reason: "turnstile" });
  });

  it("the earlier layers still short-circuit before any network call", async () => {
    const fn = reply(200, JSON.stringify({ success: true }));
    const r = await applySpamGauntlet({
      honeypot: { body: { _hp_email: "bot@example.com" } },
      turnstile,
    });
    expect(r).toEqual({ blocked: true, reason: "honeypot" });
    expect(fn).not.toHaveBeenCalled();
  });
});
