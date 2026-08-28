import { describe, expect, it } from "vitest";
import { createChat, defineTool, type ChatMessage, type ModelFn } from "../src/index.js";
import { assertProviderTranscript, createStrictModel, InvalidTranscriptError } from "../src/testing.js";

/**
 * F079.11 — reported by cms from a LIVE PRODUCTION OUTAGE, not from reading code.
 *
 * For ~40 minutes every question requiring a tool ended in an error at the user:
 * the tool ran, the result came back, and the round that would have turned it
 * into a sentence was rejected by Mistral with
 *   "Unexpected role 'tool' after role 'user'"  (code 3230)
 *
 * All 181 tests were green throughout, and NONE of them could have caught it —
 * every one ran against a permissive stub. The whole point of this file is that
 * the double now refuses what a provider refuses.
 */

const user = (content: string): ChatMessage => ({ role: "user", content });
const tool = (id: string, content = "r"): ChatMessage => ({ role: "tool", toolCallId: id, content });
const assistant = (content: string, ...ids: string[]): ChatMessage => ({
  role: "assistant",
  content,
  ...(ids.length ? { toolCalls: ids.map((id) => ({ id, name: `t_${id}`, args: {} })) } : {}),
});

const search = defineTool<undefined>({
  name: "site_summary",
  description: "d",
  permission: "read",
  parameters: { type: "object", properties: {} },
  run: () => ({ posts: 48, pages: 22 }),
});

// ---------------------------------------------------------------------------
// the exact outage, reproduced then fixed
// ---------------------------------------------------------------------------

describe("a tool result must answer an assistant turn that asked for it", () => {
  it("THE OUTAGE: a model that calls a tool WITHOUT speaking first still produces a valid transcript", async () => {
    // This is the shape that broke production. Before the fix the second round
    // sent ["user","tool"] — no assistant turn at all, because `text` was empty.
    const sent: ChatMessage[][] = [];
    let round = 0;
    const model: ModelFn = async function* (req) {
      sent.push(req.messages.map((m) => ({ ...m })));
      if (round++ === 0) yield { type: "tool-call", id: "c1", name: "site_summary", args: {} };
      else yield { type: "text", text: "Der er 136 dokumenter i alt på sitet." };
    };
    const chat = createChat<undefined, { ok: true }>({ model, tools: [search], can: () => true });
    for await (const _ of chat.run({ messages: [user("hvor mange dokumenter?")], caller: { ok: true }, ctx: undefined })) void _;

    expect(sent).toHaveLength(2);
    expect(sent[1]!.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    // …and the assistant turn OWNS the call, which is what makes it repairable.
    expect(sent[1]![1]!.toolCalls).toEqual([{ id: "c1", name: "site_summary", args: {} }]);
    expect(sent[1]![2]!.toolCallId).toBe("c1");
    expect(() => assertProviderTranscript(sent[1]!)).not.toThrow();
  });

  it("the empty assistant turn is still EMPTY — we invent no speech the model did not make", async () => {
    let round = 0;
    let second: ChatMessage[] = [];
    const model: ModelFn = async function* (req) {
      second = req.messages;
      if (round++ === 0) yield { type: "tool-call", id: "c1", name: "site_summary", args: {} };
      else yield { type: "text", text: "ok" };
    };
    const chat = createChat<undefined, { ok: true }>({ model, tools: [search], can: () => true });
    for await (const _ of chat.run({ messages: [user("q")], caller: { ok: true }, ctx: undefined })) void _;
    expect(second[1]!.content).toBe("");
  });

  it("text AND a call in the same round: both survive on one assistant turn", async () => {
    let round = 0;
    let second: ChatMessage[] = [];
    const model: ModelFn = async function* (req) {
      second = req.messages;
      if (round++ === 0) {
        yield { type: "text", text: "lad mig se efter" };
        yield { type: "tool-call", id: "c1", name: "site_summary", args: { q: 1 } };
      } else yield { type: "text", text: "ok" };
    };
    const chat = createChat<undefined, { ok: true }>({ model, tools: [search], can: () => true });
    for await (const _ of chat.run({ messages: [user("q")], caller: { ok: true }, ctx: undefined })) void _;
    expect(second[1]).toMatchObject({ role: "assistant", content: "lad mig se efter", toolCalls: [{ id: "c1", name: "site_summary", args: { q: 1 } }] });
  });

  it("a REFUSED tool still leaves a valid transcript — the model is told, and the pairing holds", async () => {
    // The tool the model named does not exist for this caller. run() pushes an
    // error as the tool message; it must still answer a declared call.
    let round = 0;
    let second: ChatMessage[] = [];
    const model: ModelFn = async function* (req) {
      second = req.messages;
      if (round++ === 0) yield { type: "tool-call", id: "c9", name: "delete_everything", args: {} };
      else yield { type: "text", text: "det kan jeg ikke" };
    };
    const chat = createChat<undefined, { ok: true }>({ model, tools: [search], can: () => true });
    for await (const _ of chat.run({ messages: [user("slet alt")], caller: { ok: true }, ctx: undefined })) void _;
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(() => assertProviderTranscript(second)).not.toThrow();
  });

  it("a THROWING tool leaves a valid transcript too", async () => {
    const broken = defineTool<undefined>({
      name: "broken",
      description: "d",
      permission: "read",
      parameters: { type: "object", properties: {} },
      run: () => {
        throw new Error("upstream 500");
      },
    });
    let round = 0;
    let second: ChatMessage[] = [];
    const model: ModelFn = async function* (req) {
      second = req.messages;
      if (round++ === 0) yield { type: "tool-call", id: "c1", name: "broken", args: {} };
      else yield { type: "text", text: "beklager" };
    };
    const chat = createChat<undefined, { ok: true }>({ model, tools: [broken], can: () => true });
    for await (const _ of chat.run({ messages: [user("q")], caller: { ok: true }, ctx: undefined })) void _;
    expect(() => assertProviderTranscript(second)).not.toThrow();
  });

  it("SEVERAL calls in one round are each answered before the next turn", async () => {
    let round = 0;
    let second: ChatMessage[] = [];
    const model: ModelFn = async function* (req) {
      second = req.messages;
      if (round++ === 0) {
        yield { type: "tool-call", id: "a", name: "site_summary", args: {} };
        yield { type: "tool-call", id: "b", name: "site_summary", args: {} };
      } else yield { type: "text", text: "ok" };
    };
    const chat = createChat<undefined, { ok: true }>({ model, tools: [search], can: () => true });
    for await (const _ of chat.run({ messages: [user("q")], caller: { ok: true }, ctx: undefined })) void _;
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool"]);
    expect(() => assertProviderTranscript(second)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// the double itself — it has to be able to FAIL, or it proves nothing
// ---------------------------------------------------------------------------

describe("the strict double refuses what a provider refuses", () => {
  it("REPRODUCES THE OUTAGE VERBATIM: tool straight after user", () => {
    expect(() => assertProviderTranscript([user("q"), tool("c1")])).toThrow(InvalidTranscriptError);
    expect(() => assertProviderTranscript([user("q"), tool("c1")])).toThrow(/unexpected role 'tool' after role 'user'/i);
  });

  it("an assistant turn with NO toolCalls does not license a tool message either", () => {
    // The pre-fix code pushed exactly this when the model spoke and called in
    // the same round: content, and no record of the call.
    expect(() => assertProviderTranscript([user("q"), assistant("lad mig se"), tool("c1")])).toThrow(InvalidTranscriptError);
  });

  it("AN UNKNOWN CALL ID IS REFUSED, NEVER REPAIRED — cms's rule", () => {
    // An invented pairing would be a second wrong answer, and the provider's own
    // error is more useful than our guess.
    expect(() => assertProviderTranscript([user("q"), assistant("", "c1"), tool("c2")])).toThrow(/answers no call/);
  });

  it("a tool message with no id is refused", () => {
    expect(() => assertProviderTranscript([user("q"), assistant("", "c1"), { role: "tool", content: "r" }])).toThrow(/no `toolCallId`/);
  });

  it("an unanswered call before the next turn is refused, in both directions", () => {
    expect(() => assertProviderTranscript([user("q"), assistant("", "c1"), assistant("done")])).toThrow(/still unanswered/);
    expect(() => assertProviderTranscript([user("q"), assistant("", "c1"), user("again")])).toThrow(/still unanswered/);
  });

  it("NEGATIVE CONTROLS: transcripts a provider accepts pass", () => {
    expect(() => assertProviderTranscript([])).not.toThrow();
    expect(() => assertProviderTranscript([user("q")])).not.toThrow();
    expect(() => assertProviderTranscript([user("q"), assistant("svar")])).not.toThrow();
    expect(() => assertProviderTranscript([user("q"), assistant("", "c1"), tool("c1"), assistant("svar")])).not.toThrow();
    expect(() => assertProviderTranscript([user("q"), assistant("", "a", "b"), tool("b"), tool("a"), assistant("svar")])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// the loop, driven through the strict double
// ---------------------------------------------------------------------------

describe("our own loop, run against a model that checks its input", () => {
  it("a two-round tool conversation is accepted at every step", async () => {
    const model = createStrictModel([
      [{ type: "tool-call", id: "c1", name: "site_summary", args: {} }],
      [{ type: "text", text: "Der er 136 dokumenter i alt på sitet." }],
    ]);
    const chat = createChat<undefined, { ok: true }>({ model, tools: [search], can: () => true });
    const out: string[] = [];
    for await (const f of chat.run({ messages: [user("hvor mange?")], caller: { ok: true }, ctx: undefined })) {
      if (f.type === "text") out.push(f.text);
      if (f.type === "error") throw new Error(`the strict model rejected our transcript: ${f.message}`);
    }
    expect(out.join("")).toContain("136 dokumenter");
  });

  it("THE PROOF THAT THIS DOUBLE IS WORTH ANYTHING: it rejects the pre-fix transcript", async () => {
    // Hand-built, because the fixed loop can no longer produce it. This is what
    // round 2 looked like in production, and what every stub accepted.
    const model = createStrictModel([[{ type: "text", text: "ok" }]]);
    await expect(async () => {
      for await (const _ of model({ system: "", messages: [user("q"), tool("c1")], tools: [] })) void _;
    }).rejects.toThrow(InvalidTranscriptError);

    // CONTROL, one line below: the SAME double accepts the post-fix transcript.
    // Without it, a double that rejected everything would pass the line above.
    const ok: string[] = [];
    for await (const ev of model({ system: "", messages: [user("q"), assistant("", "c1"), tool("c1")], tools: [] })) {
      if (ev.type === "text") ok.push(ev.text);
    }
    expect(ok).toEqual(["ok"]);
  });
});
