import { describe, expect, it } from "vitest";
import { createChat, defineTool, type ChatFrame, type ChatMessage, type ModelFn, type ToolSpec } from "../src/index.js";
import {
  prepareHistory,
  estimateTokens,
  estimateToolTokens,
  assertHistoryConfig,
  resolveHistoryProfile,
  HISTORY_PROFILES,
  type HistoryConfig,
  type HistoryProfile,
} from "../src/history.js";

/**
 * F079.9 — history management.
 *
 * The defect, measured by cms: nothing truncates, so a RETRY RESENDS THE SAME
 * OVERSIZED PAYLOAD and the conversation is permanently unusable from the
 * moment it tips. So the first test is not "it got shorter".
 */

const turn = (i: number, len = 400): ChatMessage => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content: `${i}:`.padEnd(len, "x"),
});
const conversation = (n: number, len = 400) => Array.from({ length: n }, (_, i) => turn(i, len));

const window40: HistoryConfig = { strategy: "window", maxInputTokens: 400, keepRecent: 4 };
const compact40 = (summarise = async () => "they discussed the roster"): HistoryConfig => ({
  strategy: "compact",
  maxInputTokens: 400,
  keepRecent: 4,
  summarise,
});

// ---------------------------------------------------------------------------
// AC#1 — the one that has to hold
// ---------------------------------------------------------------------------

describe("an overflowing conversation stays USABLE", () => {
  it("THE NEXT TURN ON THE SAME CONVERSATION SUCCEEDS — not merely 'it got shorter'", async () => {
    let convo = conversation(40);
    expect(estimateTokens(convo)).toBeGreaterThan(window40.maxInputTokens);

    const first = await prepareHistory(convo, window40);
    expect(first.status).toBe("reduced");

    // The user asks something else. cms's defect is that THIS is where it dies:
    // nothing truncated, so the retry carries the same oversized payload.
    convo = [...convo, { role: "user", content: "and what about Britta?" }];
    const second = await prepareHistory(convo, window40);
    expect(second.status).toBe("reduced");
    expect(second.estimatedTokens).toBeLessThanOrEqual(window40.maxInputTokens);
    expect(second.messages.at(-1)!.content).toBe("and what about Britta?");

    // …and again, ten turns later.
    for (let i = 0; i < 10; i++) convo = [...convo, turn(i)];
    expect((await prepareHistory(convo, window40)).status).toBe("reduced");
  });

  it("NEVER MUTATES the conversation it was given — the user's record is untouched", async () => {
    const convo = conversation(40);
    const snapshot = JSON.stringify(convo);
    await prepareHistory(convo, window40);
    await prepareHistory(convo, compact40());
    expect(JSON.stringify(convo)).toBe(snapshot);
    expect(convo).toHaveLength(40);
  });

  it("COMPACTION CHANGES WHAT THE MODEL SEES, NEVER WHAT THE USER CAN READ", async () => {
    // cms's rule, from a real user they are not: someone uses their admin chat
    // as a working tool and may expect to re-read a session word for word.
    const convo = conversation(40);
    const outcome = await prepareHistory(convo, compact40());
    expect(outcome.status).toBe("reduced");
    if (outcome.status !== "reduced") return;
    expect(outcome.messages.length).toBeLessThan(convo.length);
    // the ORIGINAL is still complete and verbatim
    expect(convo).toHaveLength(40);
    expect(convo[0]!.content).toBe(turn(0).content);
    expect(convo[39]!.content).toBe(turn(39).content);
  });
});

// ---------------------------------------------------------------------------
// AC#2/#3 — the strategy is chosen, and there is no "none"
// ---------------------------------------------------------------------------

describe("the strategy is chosen, never assumed", () => {
  it("both strategies bring the SAME input under the limit — and produce DIFFERENT transcripts", async () => {
    // Identical output would mean the choice is decoration, and a hard-coded
    // strategy would pass this suite.
    const convo = conversation(40);
    const w = await prepareHistory(convo, window40);
    const c = await prepareHistory(convo, compact40());
    expect(w.status).toBe("reduced");
    expect(c.status).toBe("reduced");
    if (w.status !== "reduced" || c.status !== "reduced") return;
    expect(w.estimatedTokens).toBeLessThanOrEqual(400);
    expect(c.estimatedTokens).toBeLessThanOrEqual(400);
    expect(JSON.stringify(w.messages)).not.toBe(JSON.stringify(c.messages));
    expect(c.messages[0]!.content).toMatch(/^\[Summary of earlier turns\]/);
    expect(w.messages[0]!.content).not.toMatch(/Summary of earlier turns/);
  });

  it("refuses a config with no strategy, rather than defaulting to unbounded", () => {
    // @ts-expect-error — omitting it must not type-check either
    expect(() => assertHistoryConfig({ maxInputTokens: 400 })).toThrow(/strategy/);
    // @ts-expect-error — nor a made-up one
    expect(() => assertHistoryConfig({ strategy: "none", maxInputTokens: 400 })).toThrow(/strategy/);
  });

  it("refuses compaction with no summariser — this package makes no model calls", () => {
    expect(() => assertHistoryConfig({ strategy: "compact", maxInputTokens: 400 })).toThrow(/summarise/);
  });

  it("THE LIMIT IS DECLARED BY THE CONSUMER and is never derived from a registry", () => {
    expect(() => assertHistoryConfig({ strategy: "window", maxInputTokens: 0 })).toThrow(/maxInputTokens/);
    // @ts-expect-error
    expect(() => assertHistoryConfig({ strategy: "window" })).toThrow(/maxInputTokens/);
    // cms measured, ai-sdk confirmed: a model object carries exactly
    // [id, alias, provider, available, status, note, source] — no context
    // window at all, and the number that looks like one is an OUTPUT limit.
    const src = ["history", "index"].map((f) => readFile(`../src/${f}.ts`)).join("\n");
    expect(src).not.toMatch(/resolveModel|listModels|contextWindow|maxTokens\s*[:.]/);
  });
});

function readFile(rel: string): string {
  // eslint-disable-next-line
  return require("node:fs").readFileSync(new URL(rel, import.meta.url), "utf8");
}

// ---------------------------------------------------------------------------
// AC#12 — a failure keeps its own state all the way up
// ---------------------------------------------------------------------------

describe("a failure never looks like a success", () => {
  it("'compaction failed' and 'nothing to compact' are two different states", async () => {
    const threw = await prepareHistory(conversation(40), compact40(async () => {
      throw new Error("the summariser is down");
    }));
    const nothing = await prepareHistory(conversation(2, 4000), compact40());

    expect(threw.status).toBe("failed");
    expect(nothing.status).toBe("failed");
    if (threw.status !== "failed" || nothing.status !== "failed") return;
    expect(threw.reason).toBe("compaction_failed");
    expect(nothing.reason).toBe("cannot_reduce");
    expect(threw.note).not.toBe(nothing.note);
  });

  it("a FAILED compaction returns the transcript UNCHANGED — never half-shortened", async () => {
    const convo = conversation(40);
    const outcome = await prepareHistory(convo, compact40(async () => {
      throw new Error("down");
    }));
    if (outcome.status !== "failed") throw new Error("expected failure");
    expect(outcome.messages).toHaveLength(40);
    expect(outcome.messages).toEqual(convo);
  });

  it("a summariser returning nothing usable is a FAILURE, not an empty summary", async () => {
    for (const bad of ["", "   ", undefined as unknown as string]) {
      const outcome = await prepareHistory(conversation(40), compact40(async () => bad));
      expect(outcome.status).toBe("failed");
      if (outcome.status === "failed") expect(outcome.reason).toBe("compaction_failed");
    }
  });
});

// ---------------------------------------------------------------------------
// AC#7/#8 — warned before, and nothing dropped silently
// ---------------------------------------------------------------------------

describe("the caller is told, while there is still room to act", () => {
  it("warns BEFORE the limit, not after", async () => {
    const near = conversation(7, 200); // 375 tokens — under the limit, over 80% of it
    const outcome = await prepareHistory(near, { strategy: "window", maxInputTokens: 450 });
    expect(outcome.status).toBe("unchanged");
    if (outcome.status !== "unchanged") return;
    expect(outcome.warning).toBeTruthy();
    expect(outcome.estimatedTokens).toBeLessThanOrEqual(450);
  });

  it("NEGATIVE CONTROL: a small conversation is not warned about", async () => {
    const outcome = await prepareHistory(conversation(2, 40), { strategy: "window", maxInputTokens: 5000 });
    if (outcome.status !== "unchanged") throw new Error("expected unchanged");
    expect(outcome.warning).toBeUndefined();
  });

  it("reports HOW MANY messages left the payload", async () => {
    const outcome = await prepareHistory(conversation(40), window40);
    if (outcome.status !== "reduced") throw new Error("expected reduced");
    expect(outcome.dropped).toBeGreaterThan(0);
    expect(outcome.dropped).toBe(40 - outcome.messages.length);
  });
});

// ---------------------------------------------------------------------------
// transcript integrity
// ---------------------------------------------------------------------------

describe("what is sent is still a coherent transcript", () => {
  it("never leaves a `tool` message at the front, answering a call the model cannot see", async () => {
    // The tail is arranged so the kept slice STARTS on the tool message. A
    // fixture where it happens to fall elsewhere passes without the guard —
    // measured: an earlier version of this test did exactly that.
    const convo: ChatMessage[] = [
      ...conversation(20),
      { role: "assistant", content: "calling".padEnd(400, "x") },
      { role: "tool", toolCallId: "1", content: "result".padEnd(400, "x") },
      { role: "assistant", content: "done".padEnd(400, "x") },
      { role: "user", content: "thanks".padEnd(400, "x") },
    ];
    // control: without trimming, this slice really does begin with `tool`
    expect(convo.slice(convo.length - 3)[0]!.role).toBe("tool");

    for (const cfg of [
      { strategy: "window", maxInputTokens: 400, keepRecent: 3 } as HistoryConfig,
      { ...compact40(), keepRecent: 3 },
    ]) {
      const outcome = await prepareHistory(convo, cfg);
      if (outcome.status !== "reduced") throw new Error("expected reduced");
      const first = outcome.messages[0]!;
      // for compaction the first is the summary; the message AFTER it is the
      // one that would have been orphaned
      const candidate = first.content.startsWith("[Summary of earlier turns]") ? outcome.messages[1]! : first;
      expect(candidate.role, `a tool result was left answering a call the model cannot see (${cfg.strategy})`).not.toBe("tool");
    }
  });

  it("the CALLER's array is untouched by a run through the loop", async () => {
    // run() copies before it does anything. The run MUST include a tool round:
    // the loop only appends while resolving tool calls, so a text-only fixture
    // passes with or without the copy — measured, this test was green against
    // the mutation until the tool round was added.
    const mine = conversation(40);
    let round = 0;
    const chat = createChat<undefined, { ok: true }>({
      model: async function* () {
        if (round++ === 0) {
          yield { type: "text", text: "looking" };
          yield { type: "tool-call", id: "1", name: "peek", args: {} };
        } else {
          yield { type: "text", text: "done" };
        }
      },
      tools: [
        defineTool<undefined>({
          name: "peek",
          description: "d",
          permission: "read",
          parameters: { type: "object", properties: {} },
          run: () => "a result",
        }),
      ],
      can: () => true,
      history: window40,
    });
    const seen: ChatFrame[] = [];
    for await (const f of chat.run({ messages: mine, caller: { ok: true }, ctx: undefined })) seen.push(f);
    expect(seen.some((f) => f.type === "tool-result"), "the fixture never exercised the appending path").toBe(true);
    expect(mine).toHaveLength(40);
    expect(mine[0]!.content).toBe(turn(0).content);
    expect(mine[39]!.content).toBe(turn(39).content);
  });
});

// ---------------------------------------------------------------------------
// driven through the loop — the frames a consumer actually sees
// ---------------------------------------------------------------------------

describe("through the conversation loop", () => {
  const model: ModelFn = async function* () {
    yield { type: "text", text: "ok" };
  };
  async function frames(messages: ChatMessage[], history?: HistoryConfig): Promise<ChatFrame[]> {
    const chat = createChat<undefined, undefined>({ model, history });
    const out: ChatFrame[] = [];
    for await (const f of chat.run({ messages, caller: undefined, ctx: undefined })) out.push(f);
    return out;
  }

  it("a reduction arrives as a TYPED frame, not as prose to pattern-match", async () => {
    const out = await frames(conversation(40), window40);
    const h = out.find((f) => f.type === "history");
    expect(h).toBeTruthy();
    expect(h).toMatchObject({ type: "history", action: "reduced" });
    if (h?.type === "history") expect(h.dropped).toBeGreaterThan(0);
    expect(out.at(-1)).toEqual({ type: "done", reason: "complete" });
  });

  it("an unshrinkable turn STOPS with its own reason — it does not send a payload we know is too large", async () => {
    // This is cms's death: the provider 400s and a retry sends the same thing.
    let modelCalls = 0;
    const spy: ModelFn = async function* () {
      modelCalls++;
      yield { type: "text", text: "should not happen" };
    };
    const chat = createChat<undefined, undefined>({
      model: spy,
      history: { strategy: "window", maxInputTokens: 10, keepRecent: 1 },
    });
    const out: ChatFrame[] = [];
    for await (const f of chat.run({ messages: conversation(1, 4000), caller: undefined, ctx: undefined })) out.push(f);
    expect(modelCalls).toBe(0);
    expect(out.at(-1)).toEqual({ type: "done", reason: "too-large" });
    expect(out.some((f) => f.type === "history" && f.action === "failed")).toBe(true);
  });

  it("NEGATIVE CONTROL: with no history config the loop sends everything, unchanged", async () => {
    let seen = 0;
    const spy: ModelFn = async function* (req) {
      seen = req.messages.length;
      yield { type: "text", text: "ok" };
    };
    const chat = createChat<undefined, undefined>({ model: spy });
    for await (const _ of chat.run({ messages: conversation(40), caller: undefined, ctx: undefined })) void _;
    expect(seen).toBe(40); // today's fleet-wide behaviour, and why this story exists
  });
});

// ---------------------------------------------------------------------------
// F079.10 — the estimate could not see the tool schemas
//
// Reported by cms the day they went to production on 0.3.0. Their 64 tools cost
// ~28,266 characters (~8,300 tokens) on EVERY call, and none of it was counted.
// The failure runs in the GREEN direction: the guard reports room while the
// provider is already over.
//
// MUTATION, named so the next reader knows which way it fails: delete
// `+ overhead` from the sums in prepareHistory and the tests below go
// green-and-wrong — they are the only thing standing between a consumer and a
// dead conversation they did everything right to avoid.
// ---------------------------------------------------------------------------

const bigTool = (name: string, schemaChars: number): ToolSpec => ({
  name,
  description: "d",
  parameters: { type: "object", properties: { q: { type: "string", description: "x".repeat(schemaChars) } } },
});

describe("the ceiling is compared against what is actually SENT", () => {
  it("a conversation that fits ALONE does not fit once the tool schemas are counted", async () => {
    const convo = conversation(3);
    const tools = [bigTool("search", 600)];

    // The control, one line above the finding: without tools this same
    // conversation is comfortably under the limit. If it were not, the second
    // assertion would pass for a reason that has nothing to do with tools.
    const withoutTools = await prepareHistory(convo, window40);
    expect(withoutTools.status, "the fixture must fit on its own, or it proves nothing").toBe("unchanged");

    const withTools = await prepareHistory(convo, window40, undefined, tools);
    expect(withTools.status).toBe("reduced");
    expect(withTools.estimatedTokens).toBeLessThanOrEqual(window40.maxInputTokens);
  });

  it("the reported token count INCLUDES the overhead — it is what goes on the wire, not what we kept", async () => {
    const convo = conversation(1, 100);
    const tools = [bigTool("search", 800)];
    const bare = await prepareHistory(convo, { ...window40, maxInputTokens: 100_000 });
    const withTools = await prepareHistory(convo, { ...window40, maxInputTokens: 100_000 }, undefined, tools);
    expect(withTools.estimatedTokens).toBeGreaterThan(bare.estimatedTokens);
    expect(withTools.estimatedTokens - bare.estimatedTokens).toBe(estimateToolTokens(tools));
  });

  it("every tool a caller may use is counted — the cost grows with the tool list", () => {
    const one = estimateToolTokens([bigTool("a", 500)]);
    const three = estimateToolTokens([bigTool("a", 500), bigTool("b", 500), bigTool("c", 500)]);
    expect(three).toBeGreaterThan(one * 2);
    expect(estimateToolTokens([])).toBe(0); // NEGATIVE CONTROL: no tools, no charge
  });

  it("counts the schemas with the CONSUMER's estimator, not ours — one rate over the whole payload", async () => {
    // cms measured 3.41 chars/token on their Danish prose against our ~4. A
    // consumer who injects that rate must have it applied to the schemas too,
    // or the half we count for them is the half that does not overflow.
    const danish = (messages: ChatMessage[], system?: string) => {
      let chars = system ? system.length : 0;
      for (const m of messages) chars += m.content.length;
      return Math.ceil(chars / 3.41);
    };
    const tools = [bigTool("search", 1000)];
    const ours = estimateToolTokens(tools);
    const theirs = estimateToolTokens(tools, danish);
    expect(theirs).toBeGreaterThan(ours);

    const outcome = await prepareHistory(conversation(1, 100), { ...window40, estimate: danish, maxInputTokens: 100_000 }, undefined, tools);
    expect(outcome.estimatedTokens).toBe(danish(conversation(1, 100)) + theirs);
  });

  it("THROUGH THE LOOP: createChat passes the caller's tools itself — there is nothing to remember", async () => {
    // The wiring is the part that would otherwise be deferred: prepareHistory
    // can be right and the loop can still never hand it the tools.
    //
    // Asserted as a DIFFERENCE rather than an absolute size, deliberately. An
    // absolute threshold depends on the length of our own system prompt, so it
    // would go red the day somebody edits corePrompt — a test that fails for a
    // reason it is not about is a test people learn to ignore.
    const heavy = defineTool<undefined>({
      name: "search",
      description: "d",
      permission: "read",
      parameters: { type: "object", properties: { q: { type: "string", description: "x".repeat(4000) } } },
      run: () => "r",
    });
    async function sentToModel(tools: (typeof heavy)[]) {
      let seen = -1;
      const spy: ModelFn = async function* (req) {
        seen = req.messages.length;
        yield { type: "text", text: "ok" };
      };
      const chat = createChat<undefined, { ok: true }>({
        model: spy,
        tools,
        ...(tools.length ? { can: () => true } : {}),
        history: { strategy: "window", maxInputTokens: 4_000, keepRecent: 40 },
      });
      for await (const _ of chat.run({ messages: conversation(40), caller: { ok: true }, ctx: undefined })) void _;
      return seen;
    }

    const withoutTools = await sentToModel([]);
    const withTools = await sentToModel([heavy]);
    expect(withoutTools, "the fixture never reached the model at all").toBeGreaterThan(0);
    expect(withTools).toBeGreaterThan(0);
    expect(withTools, "the tool schemas were not counted — this is the defect").toBeLessThan(withoutTools);
  });

  it("a caller DENIED a tool is not charged for it", async () => {
    const heavy = defineTool<undefined>({
      name: "search",
      description: "d",
      permission: "admin",
      parameters: { type: "object", properties: { q: { type: "string", description: "x".repeat(4000) } } },
      run: () => "r",
    });
    async function sentToModel(admin: boolean) {
      let seen = -1;
      const spy: ModelFn = async function* (req) {
        seen = req.messages.length;
        yield { type: "text", text: "ok" };
      };
      const chat = createChat<undefined, { admin: boolean }>({
        model: spy,
        tools: [heavy],
        can: (perm, caller) => caller.admin && perm === "admin",
        history: { strategy: "window", maxInputTokens: 4_000, keepRecent: 40 },
      });
      for await (const _ of chat.run({ messages: conversation(40), caller: { admin }, ctx: undefined })) void _;
      return seen;
    }
    const asAdmin = await sentToModel(true);
    const asReader = await sentToModel(false);
    expect(asAdmin).toBeGreaterThan(0);
    expect(asReader, "the denied caller paid for a tool they were never offered").toBeGreaterThan(asAdmin);
  });
});

describe("compaction is sized against the same payload", () => {
  it("COMPACT counts it too — measured, this was the one mutation that stayed green", async () => {
    // The compact step-down had its own `+ overhead`, and nothing exercised it:
    // deleting it left all 180 tests passing. A consumer on `compact` with a
    // real tool set would have been under-counted in exactly the way this
    // story exists to fix, and the suite would have agreed with the code.
    const cfg = (): HistoryConfig => ({ strategy: "compact", maxInputTokens: 400, keepRecent: 6, summarise: async () => "s" });
    const convo = conversation(20);
    const tools = [bigTool("search", 600)];

    const bare = await prepareHistory(convo, cfg());
    const withTools = await prepareHistory(convo, cfg(), undefined, tools);
    expect(bare.status).toBe("reduced");
    expect(withTools.status).toBe("reduced");
    if (bare.status === "reduced" && withTools.status === "reduced") {
      expect(withTools.dropped, "the summary + recent turns were sized without the tool schemas").toBeGreaterThan(bare.dropped);
    }
  });
});

describe("'the tools alone do not fit' is its own state", () => {
  it("reports overhead_exceeds_limit — never cannot_reduce, which would point at the wrong fix", async () => {
    const outcome = await prepareHistory(conversation(1, 40), window40, undefined, [bigTool("search", 4000)]);
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.reason).toBe("overhead_exceeds_limit");
      expect(outcome.note).toContain("fewer tools");
      expect(outcome.messages).toHaveLength(1); // unchanged, as every failure is
    }
  });

  it("NEGATIVE CONTROL: one oversized message with small tools is still cannot_reduce", async () => {
    const outcome = await prepareHistory(conversation(1, 4000), window40, undefined, [bigTool("t", 10)]);
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.reason).toBe("cannot_reduce");
  });
});

describe("a fixed overhead that is not a number is refused, never counted as zero", () => {
  // AC#2, the REFUSAL half. The other half — "or must compute it itself" — is
  // the branch createChat takes: it owns the tools, so it cannot be missing
  // them, and the loop test above is what proves it.
  it("refuses a string off an env var, NaN, and a negative", () => {
    for (const bad of ["8300", Number.NaN, -1]) {
      expect(() => assertHistoryConfig({ ...window40, fixedOverheadTokens: bad as number })).toThrow(/fixedOverheadTokens/);
    }
  });

  it("the SAME config with a real number is accepted", () => {
    expect(() => assertHistoryConfig({ ...window40, fixedOverheadTokens: 8300 })).not.toThrow();
    expect(() => assertHistoryConfig({ ...window40, fixedOverheadTokens: 0 })).not.toThrow();
  });

  it("and it is actually ADDED, not merely validated", async () => {
    const convo = conversation(3);
    expect((await prepareHistory(convo, window40)).status).toBe("unchanged");
    expect((await prepareHistory(convo, { ...window40, fixedOverheadTokens: 150 })).status).toBe("reduced");
  });
});

// ---------------------------------------------------------------------------
// F079.10 part 2 — the config asked in a unit nobody decides in
// ---------------------------------------------------------------------------

describe("named profiles resolve to numbers WE own", () => {
  it("every profile resolves to a config that passes our own validator", () => {
    for (const name of Object.keys(HISTORY_PROFILES) as HistoryProfile[]) {
      const spec = HISTORY_PROFILES[name];
      // long-authoring summarises, and a summary is a model call this package
      // does not make — so it resolves WITH the caller's summariser and refuses
      // without one. That refusal is the feature, not a gap in the profile.
      const overrides = spec.requiresSummarise ? { summarise: async () => "s" } : undefined;
      const config = resolveHistoryProfile(name, overrides);
      expect(() => assertHistoryConfig(config)).not.toThrow();
      expect(config.strategy).toBe(spec.strategy);
      expect(config.maxInputTokens).toBe(spec.maxInputTokens);
    }
  });

  it("'long-authoring' refuses without a summariser, and the error says what to do instead", () => {
    expect(() => resolveHistoryProfile("long-authoring")).toThrow(/summarise/);
    expect(() => resolveHistoryProfile("long-authoring")).toThrow(/"standard"/);
    expect(() => resolveHistoryProfile("long-authoring", { summarise: async () => "s" })).not.toThrow();
  });

  it("an unknown name THROWS naming the valid ones — it never falls back to a default", () => {
    // A fallback would be us making a silent decision about somebody's bill and
    // about which of their turns survive, on the strength of a typo.
    expect(() => resolveHistoryProfile("standrd" as HistoryProfile)).toThrow(/not a profile/);
    expect(() => resolveHistoryProfile("standrd" as HistoryProfile)).toThrow(/"visitor-qa"/);
  });

  it("overrides steer a profile without replacing it", () => {
    const config = resolveHistoryProfile("visitor-qa", { maxInputTokens: 999 });
    expect(config.maxInputTokens).toBe(999);
    expect(config.keepRecent).toBe(HISTORY_PROFILES["visitor-qa"].keepRecent); // the rest survives
  });

  it("createChat takes a profile NAME and behaves exactly as the object form", async () => {
    const model: ModelFn = async function* () {
      yield { type: "text", text: "ok" };
    };
    async function sent(history: "visitor-qa" | HistoryConfig) {
      let seen = 0;
      const spy: ModelFn = async function* (req) {
        seen = req.messages.length;
        yield* model({ system: "", messages: [], tools: [] });
      };
      const chat = createChat<undefined, undefined>({ model: spy, history });
      for await (const _ of chat.run({ messages: conversation(400), caller: undefined, ctx: undefined })) void _;
      return seen;
    }
    const spec = HISTORY_PROFILES["visitor-qa"];
    expect(await sent("visitor-qa")).toBe(await sent({ strategy: spec.strategy, maxInputTokens: spec.maxInputTokens, keepRecent: spec.keepRecent }));
    expect(await sent("visitor-qa")).toBeLessThan(400); // it really did bite
  });

  it("the raw object form still works unchanged — a profile never replaces the numbers", async () => {
    expect((await prepareHistory(conversation(40), window40)).status).toBe("reduced");
  });
});

// ---------------------------------------------------------------------------
// F079.12 — the frame carried English prose and no code, so our note reached a
// customer. cms measured it live, then passed `note` verbatim to an end user:
// an English sentence about a mechanism, mid-conversation, to a Danish customer.
// They were not careless — there was nothing else on the frame to act on.
// ---------------------------------------------------------------------------

describe("a consumer can act on the frame without reading our prose", () => {
  async function historyFrame(messages: ChatMessage[], history: HistoryConfig, tools: typeof heavyTool[] = []) {
    const model: ModelFn = async function* () {
      yield { type: "text", text: "ok" };
    };
    const chat = createChat<undefined, { ok: true }>({
      model,
      tools,
      ...(tools.length ? { can: () => true } : {}),
      history,
    });
    const out: ChatFrame[] = [];
    for await (const f of chat.run({ messages, caller: { ok: true }, ctx: undefined })) out.push(f);
    return out.find((f) => f.type === "history");
  }

  const heavyTool = defineTool<undefined>({
    name: "big",
    description: "d",
    permission: "read",
    parameters: { type: "object", properties: { q: { type: "string", description: "x".repeat(8000) } } },
    run: () => "r",
  });

  it("ALL THREE failure reasons survive to the frame — not just to the outcome object", async () => {
    const cannot = await historyFrame(conversation(1, 4000), { strategy: "window", maxInputTokens: 10, keepRecent: 1 });
    expect(cannot).toMatchObject({ type: "history", action: "failed", reason: "cannot_reduce" });

    const overhead = await historyFrame(conversation(2), { strategy: "window", maxInputTokens: 100, keepRecent: 4 }, [heavyTool]);
    expect(overhead).toMatchObject({ type: "history", action: "failed", reason: "overhead_exceeds_limit" });

    const broke = await historyFrame(conversation(40), {
      strategy: "compact",
      maxInputTokens: 400,
      keepRecent: 4,
      summarise: () => {
        throw new Error("summariser down");
      },
    });
    expect(broke).toMatchObject({ type: "history", action: "failed", reason: "compaction_failed" });
  });

  it("a REDUCED frame says WHICH strategy ran — 'we summarised' and 'we dropped' are different news", async () => {
    const dropped = await historyFrame(conversation(40), window40);
    expect(dropped).toMatchObject({ action: "reduced", strategy: "window" });
    const summarised = await historyFrame(conversation(40), compact40());
    expect(summarised).toMatchObject({ action: "reduced", strategy: "compact" });
  });

  it("THE INTENDED USE: write your own sentence, in your own language, never touching `note`", async () => {
    // This is the test cms could not have written against 0.5.2 — there was
    // nothing to switch on, so `note` was the only signal and it went to a user.
    const danish = (f: ChatFrame): string => {
      if (f.type !== "history") return "";
      if (f.action === "warned") return "Samtalen er ved at blive lang.";
      if (f.action === "reduced")
        return f.strategy === "compact"
          ? "Jeg har skrevet de ældste beskeder sammen for at gøre plads."
          : "De ældste beskeder er ikke længere med. Gentag gerne det vigtigste.";
      switch (f.reason) {
        case "overhead_exceeds_limit":
          return "Der er for mange værktøjer slået til. Kontakt din administrator.";
        case "cannot_reduce":
          return "Den sidste besked er for lang. Prøv at dele den op.";
        default:
          return "Jeg kunne ikke korte samtalen ned. Prøv igen.";
      }
    };

    const cases: Array<[ChatFrame | undefined, string]> = [
      [await historyFrame(conversation(40), window40), "De ældste beskeder er ikke længere med. Gentag gerne det vigtigste."],
      [await historyFrame(conversation(40), compact40()), "Jeg har skrevet de ældste beskeder sammen for at gøre plads."],
      [await historyFrame(conversation(1, 4000), { strategy: "window", maxInputTokens: 10, keepRecent: 1 }), "Den sidste besked er for lang. Prøv at dele den op."],
      [
        await historyFrame(conversation(2), { strategy: "window", maxInputTokens: 100, keepRecent: 4 }, [heavyTool]),
        "Der er for mange værktøjer slået til. Kontakt din administrator.",
      ],
    ];
    for (const [frame, expected] of cases) {
      expect(frame, "no history frame was produced — the fixture proves nothing").toBeTruthy();
      expect(danish(frame!)).toBe(expected);
    }

    // …and the four cases are genuinely DISTINGUISHABLE. Without this, a mapping
    // that returned one sentence for everything would pass every line above that
    // happened to expect that sentence.
    expect(new Set(cases.map(([, s]) => s)).size).toBe(4);
  });

  it("`note` is still there for the log — we removed nothing", async () => {
    const f = await historyFrame(conversation(40), window40);
    expect(f?.type === "history" && f.note.length).toBeGreaterThan(0);
  });
});
