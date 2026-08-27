import { describe, expect, it } from "vitest";
import { createChat, defineTool, type ChatFrame, type ChatMessage, type ModelFn } from "../src/index.js";
import { prepareHistory, estimateTokens, assertHistoryConfig, type HistoryConfig } from "../src/history.js";

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
