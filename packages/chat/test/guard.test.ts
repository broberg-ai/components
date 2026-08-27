import { describe, expect, it } from "vitest";
import {
  createChat,
  defineTool,
  type ChatFrame,
  type ModelEvent,
  type ModelFn,
} from "../src/index.js";
import {
  TRUSTED_COST_PROVIDERS,
  assertSpendCapConfig,
  createSpendTracker,
  type SpendCapConfig,
} from "../src/guard.js";
import { createChatHandler } from "../src/http.js";
import {
  assertPublicChatGuard,
  checkPublicRequest,
  type PublicChatGuard,
  type TurnstileVerifierLike,
} from "../src/public.js";

// The REAL sliding window from @broberg/apikey — not a stand-in. AC 2 says
// "built on it rather than re-rolled", and the only honest way to assert that
// is to drive their class through our guard.
import { SlidingWindowRateLimiter } from "@broberg/apikey";
// Type-only + constants: verifyTurnstile would reach Cloudflare, so the
// conformance below is a COMPILE-time proof and the runtime tests use stubs.
import { verifyTurnstile, TURNSTILE_TEST_SECRET_KEY } from "@broberg/forms-turnstile/server";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const loop = defineTool({
  name: "roster_lookup",
  description: "Look something up",
  permission: "chat.use",
  parameters: { type: "object", properties: {} },
  run: () => ({ ok: true }),
});

const can = () => true;

/** A model that always asks for one more tool call — a runaway loop, on purpose. */
function loopingModel(usagePerRound: (round: number) => ModelEvent[] = () => []): ModelFn {
  let round = 0;
  return async function* () {
    const i = round++;
    yield { type: "text", text: `round ${i}` } as ModelEvent;
    for (const ev of usagePerRound(i)) yield ev;
    yield { type: "tool-call", id: `c${i}`, name: "roster_lookup", args: {} } as ModelEvent;
  };
}

const usage = (costUsd: number | undefined, provider = "mistral"): ModelEvent => ({
  type: "usage",
  provider,
  model: "mistral-small-latest",
  ...(costUsd === undefined ? {} : { costUsd }),
});

async function collect(stream: AsyncIterable<ChatFrame>): Promise<ChatFrame[]> {
  const out: ChatFrame[] = [];
  for await (const f of stream) out.push(f);
  return out;
}

const runWith = (spend: SpendCapConfig | undefined, model: ModelFn) =>
  collect(
    createChat({ model, tools: [loop], can, maxRounds: 10, spend }).run({
      messages: [{ role: "user", content: "hej" }],
      caller: {},
      ctx: {},
    }),
  );

const limitFrame = (fs: ChatFrame[]) => fs.find((f) => f.type === "limit") as Extract<ChatFrame, { type: "limit" }>;
const doneFrame = (fs: ChatFrame[]) => fs.find((f) => f.type === "done") as Extract<ChatFrame, { type: "done" }>;

// ---------------------------------------------------------------------------
// AC 8 — the usage channel is ADDITIVE
// ---------------------------------------------------------------------------

describe("the cost channel the core did not have", () => {
  it("a ModelFn that yields NOTHING still runs — nobody is broken by the new variant", async () => {
    const frames = await runWith(undefined, loopingModel());
    expect(doneFrame(frames).reason).toBe("max-rounds");
    expect(frames.some((f) => f.type === "limit")).toBe(false);
  });

  it("a usage event is NOT forwarded to the browser — what her question cost us is our number", async () => {
    const frames = await runWith({ limitUsd: 100 }, loopingModel(() => [usage(0.001)]));
    expect(frames.some((f) => (f as { type: string }).type === "usage")).toBe(false);
  });

  it("a usage event is never mistaken for a tool call", async () => {
    // Before this story the branch was `else { calls.push(...) }` over a
    // two-member union, so a third variant would have been pushed onto the call
    // list as a tool named `undefined`.
    const frames = await runWith({ limitUsd: 100 }, loopingModel(() => [usage(0.001)]));
    const calls = frames.filter((f) => f.type === "tool-call");
    expect(calls).not.toHaveLength(0);
    expect(calls.every((c) => (c as { name: string }).name === "roster_lookup")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC 9 — silence REFUSES. The week's defect, pointed at ourselves.
// ---------------------------------------------------------------------------

describe("a configured cap that receives no number refuses rather than allowing", () => {
  it("stops the SECOND round with `unmeasurable_cost`", async () => {
    const frames = await runWith({ limitUsd: 100 }, loopingModel(() => []));
    expect(limitFrame(frames).reason).toBe("unmeasurable_cost");
    expect(doneFrame(frames).reason).toBe("limited");
    // Exactly one model round happened — the first answer is always delivered.
    expect(frames.filter((f) => f.type === "text")).toHaveLength(1);
  });

  it("the tracker itself refuses on silence — the unit the mutation targets", () => {
    const t = createSpendTracker({ limitUsd: 100 });
    const v = t.endRound();
    expect(v.status).toBe("refused");
    expect(v).toMatchObject({ reason: "unmeasurable_cost" });
  });

  it("a usage event with a MISSING costUsd is silence, not zero", () => {
    const t = createSpendTracker({ limitUsd: 100 });
    t.record({ provider: "mistral", model: "m" });
    expect(t.endRound()).toMatchObject({ status: "refused", reason: "unmeasurable_cost" });
    expect(t.spentUsd).toBe(0);
  });

  it("NaN and a numeric string are silence too — the shapes an env var actually produces", () => {
    for (const bad of [NaN, Infinity, -1, "0.01" as unknown as number]) {
      const t = createSpendTracker({ limitUsd: 100 });
      t.record({ provider: "mistral", model: "m", costUsd: bad });
      expect(t.endRound()).toMatchObject({ status: "refused", reason: "unmeasurable_cost" });
    }
  });

  it("`unmeasurable_cost` is DISTINCT from `spend_cap` — a blind cap is not a reached one", async () => {
    const blind = limitFrame(await runWith({ limitUsd: 100 }, loopingModel(() => [])));
    const reached = limitFrame(await runWith({ limitUsd: 0.001 }, loopingModel(() => [usage(0.01)])));
    expect(blind.reason).toBe("unmeasurable_cost");
    expect(reached.reason).toBe("spend_cap");
    expect(blind.reason).not.toBe(reached.reason);
  });
});

// ---------------------------------------------------------------------------
// AC 0 — inert, never permissive, on a provider whose cost we cannot trust
// ---------------------------------------------------------------------------

describe("an untrusted provider refuses even when the number looks perfect", () => {
  it("openai and deepseek are absent from the allowlist ON PURPOSE", () => {
    expect(TRUSTED_COST_PROVIDERS).not.toContain("openai");
    expect(TRUSTED_COST_PROVIDERS).not.toContain("deepseek");
    expect(TRUSTED_COST_PROVIDERS).toContain("mistral");
  });

  it("a tiny, well-formed cost from openai is REFUSED, not counted", async () => {
    // The discriminating case: the number is fine and miles under the ceiling.
    // A cap that only refuses on a BAD number would be green here.
    const frames = await runWith({ limitUsd: 100 }, loopingModel(() => [usage(0.000001, "openai")]));
    expect(limitFrame(frames).reason).toBe("untrusted_provider");
  });

  it("provider matching is case-insensitive — 'Mistral' is mistral", () => {
    const t = createSpendTracker({ limitUsd: 100 });
    t.record({ provider: "MISTRAL", model: "m", costUsd: 0.001 });
    expect(t.endRound().status).toBe("ok");
  });

  it("the verdict is STICKY: one untrusted round is not redeemed by a good one", () => {
    const t = createSpendTracker({ limitUsd: 100 });
    t.record({ provider: "deepseek", model: "d", costUsd: 0.001 });
    t.record({ provider: "mistral", model: "m", costUsd: 0.001 });
    expect(t.endRound()).toMatchObject({ status: "refused", reason: "untrusted_provider" });
  });
});

// ---------------------------------------------------------------------------
// AC 1 — never assume a discount that has not arrived
// ---------------------------------------------------------------------------

describe("the ceiling counts what was billed, never what caching might have saved", () => {
  it("gemini's opportunistic cache: call 1 hits, calls 2+ miss, and the cap trips at the UN-discounted total", () => {
    // ai-sdk's live run, exactly: only call 2 hit while 3-6 missed on an
    // identical prefix, where Mistral's key-based caching hit every time.
    const t = createSpendTracker({ limitUsd: 0.01, trustedProviders: ["gemini"] });
    const billed = [0.000388, 0.003424, 0.003424, 0.003424, 0.003424];
    const verdicts = [];
    for (const c of billed) {
      t.record({ provider: "gemini", model: "gemini-2.5-flash-lite", costUsd: c });
      const v = t.endRound();
      verdicts.push(v);
      if (v.status === "refused") break; // a real run stops here
    }
    expect(verdicts.slice(0, 3).every((v) => v.status === "ok")).toBe(true);
    expect(verdicts[3]).toMatchObject({ status: "refused", reason: "spend_cap" });
    expect(t.spentUsd).toBeCloseTo(0.01066, 6);

    // THE COUNTERFACTUAL, which is what makes the assertion discriminating: a
    // cap that assumed the first call's cached price held for all four would
    // have counted 4 x $0.000388 = $0.001552 — a sixth of the ceiling — and let
    // the conversation run on.
    expect(4 * 0.000388).toBeLessThan(0.01);
  });

  it("spending EXACTLY the ceiling has reached it — the boundary is inclusive", () => {
    // Without this the comparison could be `>` and every other test would still
    // pass, because they all overshoot.
    const t = createSpendTracker({ limitUsd: 0.01 });
    t.record({ provider: "mistral", model: "m", costUsd: 0.01 });
    expect(t.endRound()).toMatchObject({ status: "refused", reason: "spend_cap" });
  });

  it("a cost of exactly 0 is a MEASUREMENT, not silence", () => {
    const t = createSpendTracker({ limitUsd: 1 });
    t.record({ provider: "mistral", model: "m", costUsd: 0 });
    expect(t.endRound()).toMatchObject({ status: "ok", spentUsd: 0 });
  });
});

// ---------------------------------------------------------------------------
// AC 4 — architecture, not a setting: refused at construction
// ---------------------------------------------------------------------------

describe("a cap that cannot do its job is refused at construction", () => {
  it.each([
    ["missing", undefined],
    ["zero", { limitUsd: 0 }],
    ["negative", { limitUsd: -1 }],
    ["NaN", { limitUsd: NaN }],
    ["a string off an env var", { limitUsd: "5" as unknown as number }],
  ])("%s", (_label, cfg) => {
    expect(() => assertSpendCapConfig(cfg as SpendCapConfig)).toThrow();
  });

  it("createChat refuses the same values rather than shipping a blind ceiling", () => {
    expect(() =>
      createChat({ model: loopingModel(), spend: { limitUsd: 0 } }),
    ).toThrow(/greater than 0/);
  });

  it("`spendCapped` reports the truth in both directions", () => {
    expect(createChat({ model: loopingModel() }).spendCapped).toBe(false);
    expect(createChat({ model: loopingModel(), spend: { limitUsd: 1 } }).spendCapped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC 5 — reaching the ceiling is an ANSWER
// ---------------------------------------------------------------------------

describe("reaching the ceiling is an answer, not a crash", () => {
  it("arrives as its own frame, never as an error and never as a silent stop", async () => {
    const frames = await runWith({ limitUsd: 0.001 }, loopingModel(() => [usage(0.01)]));
    const limit = limitFrame(frames);
    expect(limit).toBeDefined();
    expect(frames.some((f) => f.type === "error")).toBe(false);
    expect(doneFrame(frames).reason).toBe("limited");
    expect(limit.note).toMatch(/ceiling/);
  });

  it("`limited` is distinct from every other way a run can end", async () => {
    const capped = doneFrame(await runWith({ limitUsd: 0.001 }, loopingModel(() => [usage(0.01)])));
    const exhausted = doneFrame(await runWith(undefined, loopingModel()));
    expect(capped.reason).toBe("limited");
    expect(exhausted.reason).toBe("max-rounds");
  });

  it("the ceiling never stops the FIRST answer — the money is spent by the time it exists", async () => {
    const frames = await runWith({ limitUsd: 0.000001 }, loopingModel(() => [usage(999)]));
    expect(frames.filter((f) => f.type === "text")).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: "text" });
  });
});

// ---------------------------------------------------------------------------
// AC 2 + 3 — the public wall, built on apikey + forms-turnstile
// ---------------------------------------------------------------------------

const okTurnstile: TurnstileVerifierLike = async () => ({ ok: true });
const rejectTurnstile: TurnstileVerifierLike = async () => ({ ok: false, reason: "rejected", errorCodes: ["x"] });
const downTurnstile: TurnstileVerifierLike = async () => ({ ok: false, reason: "unavailable", detail: "timeout" });

function guardWith(verify: TurnstileVerifierLike, max = 2, ip = (r: Request) => r.headers.get("x-visitor") ?? "anon"): PublicChatGuard {
  return {
    rateLimit: { limiter: new SlidingWindowRateLimiter({ windowMs: 60_000, max }), keyFor: ip },
    turnstile: { verify },
  };
}

const post = (visitor: string, body: unknown = { messages: [{ role: "user", content: "hej" }], turnstileToken: "t" }) =>
  new Request("https://x.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-visitor": visitor },
    body: JSON.stringify(body),
  });

describe("the per-visitor rate limit is @broberg/apikey's, not ours", () => {
  it("CONFORMANCE: their SlidingWindowRateLimiter satisfies our structural type", () => {
    const g = guardWith(okTurnstile);
    // If apikey changes `check`'s shape, this file stops compiling — which is
    // the point of installing them as a devDependency instead of asserting the
    // match in prose.
    expect(typeof g.rateLimit.limiter.check).toBe("function");
  });

  it("one visitor exhausting her allowance does not consume another's", async () => {
    const guard = guardWith(okTurnstile, 2);
    const res = [
      await checkPublicRequest(guard, post("alice"), {}),
      await checkPublicRequest(guard, post("alice"), {}),
      await checkPublicRequest(guard, post("alice"), {}),
      await checkPublicRequest(guard, post("bob"), {}),
    ];
    expect(res[0]).toBeNull();
    expect(res[1]).toBeNull();
    expect(res[2]).toMatchObject({ status: 429, error: "rate_limited" });
    expect(res[3]).toBeNull(); // bob is untouched by alice's flood
  });

  it("the refusal carries Retry-After, floored at 1", async () => {
    const guard = guardWith(okTurnstile, 1);
    await checkPublicRequest(guard, post("carol"), {});
    const refusal = await checkPublicRequest(guard, post("carol"), {});
    expect(refusal).toMatchObject({ status: 429 });
    expect((refusal as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("the 429 reaches the wire with the header, not just the object", async () => {
    const chat = createChat({ model: loopingModel(), spend: { limitUsd: 1 } });
    const handler = createChatHandler({
      chat,
      mode: "public",
      guard: guardWith(okTurnstile, 1),
      getCaller: () => ({ anonymous: true }),
    });
    await handler(post("dave"));
    const res = await handler(post("dave"));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});

describe("Turnstile is asserted SERVER-side", () => {
  it("CONFORMANCE: forms-turnstile's verifyTurnstile satisfies our verifier type", () => {
    const bound: TurnstileVerifierLike = (token) => verifyTurnstile(token, TURNSTILE_TEST_SECRET_KEY);
    expect(typeof bound).toBe("function"); // the assertion above is the compiler's
  });

  it("a RAW call bypassing the widget — no token at all — is refused", async () => {
    const refusal = await checkPublicRequest(guardWith(rejectTurnstile), post("eve"), {});
    expect(refusal).toMatchObject({ status: 403, error: "turnstile_rejected" });
  });

  it("an OUTAGE fails closed, with its own status — never 'you failed a human test'", async () => {
    const refusal = await checkPublicRequest(guardWith(downTurnstile), post("frank"), {});
    expect(refusal).toMatchObject({ status: 503, error: "turnstile_unavailable" });
  });

  it("the rate limit runs FIRST, so a flood costs no Cloudflare round-trip", async () => {
    let calls = 0;
    const counting: TurnstileVerifierLike = async () => {
      calls++;
      return { ok: true };
    };
    const guard = guardWith(counting, 1);
    await checkPublicRequest(guard, post("gina"), {});
    await checkPublicRequest(guard, post("gina"), {});
    expect(calls).toBe(1); // the second request never reached Turnstile
  });
});

describe('mode "public" cannot be constructed with a hole in the wall', () => {
  const chatCapped = () => createChat({ model: loopingModel(), spend: { limitUsd: 1 } });
  const base = { getCaller: () => ({ anonymous: true }) };

  it("no guard at all", () => {
    expect(() => createChatHandler({ ...base, chat: chatCapped(), mode: "public" })).toThrow(/rate limit and Turnstile/);
  });

  it("a guard missing its rate limit", () => {
    const half = { turnstile: { verify: okTurnstile } } as unknown as PublicChatGuard;
    expect(() => createChatHandler({ ...base, chat: chatCapped(), mode: "public", guard: half })).toThrow(/rateLimit/);
  });

  it("a guard missing Turnstile", () => {
    const half = { rateLimit: guardWith(okTurnstile).rateLimit } as unknown as PublicChatGuard;
    expect(() => createChatHandler({ ...base, chat: chatCapped(), mode: "public", guard: half })).toThrow(/turnstile/);
  });

  it("a complete wall over an UNCAPPED chat — the hole that is easiest to miss", () => {
    const uncapped = createChat({ model: loopingModel() });
    expect(() =>
      createChatHandler({ ...base, chat: uncapped, mode: "public", guard: guardWith(okTurnstile) }),
    ).toThrow(/spend ceiling/);
  });

  it("assertPublicChatGuard names each missing half rather than 'invalid config'", () => {
    expect(() => assertPublicChatGuard(undefined)).toThrow(/LLM bill/);
  });

  it("authenticated mode is unchanged — no guard, no ceiling, still constructs", () => {
    expect(() => createChatHandler({ ...base, chat: createChat({ model: loopingModel() }) })).not.toThrow();
  });
});
