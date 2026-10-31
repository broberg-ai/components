// F079.14 — collect(): one run into a finished result, raw.
import { describe, expect, it } from "vitest";
import { ChatModelError, collect, createChat, type Chat, type ChatFrame, type ModelEvent, type ModelFn } from "../src/index.js";

const scripted = (...rounds: ModelEvent[][]): ModelFn => {
  let i = 0;
  return async function* () { for (const ev of rounds[i++] ?? []) yield ev; };
};
const INPUT = { messages: [{ role: "user" as const, content: "hej" }], caller: {}, ctx: {} };
const fake = (frames: ChatFrame[]): Chat => ({
  toolsFor: async () => [],
  spendCapped: false,
  run: async function* () { for (const f of frames) yield f; },
});

describe("collect — the raw structure (F079.14)", () => {
  it("NEGATIVE CONTROL: a normal run does not throw and returns reason \"complete\"", async () => {
    const chat = createChat({ model: scripted([{ type: "text", text: "Hej " }, { type: "text", text: "der." }]) });
    const r = await collect(chat, INPUT);
    expect(r.text).toBe("Hej der.");
    expect(r.done).toBe("complete");
    expect(r.frames.at(-1)).toStrictEqual({ type: "done", reason: "complete" });
  });

  it("THE ENGINE'S OWN SEQUENCE: a model that fails → error(scope:model) then done:complete → collect THROWS", async () => {
    const failing: ModelFn = async function* () { throw new Error("HTTP 500"); };
    const chat = createChat({ model: failing });
    // the exact frames the engine emits, so this test cannot pass on a sequence it never produces
    const frames: ChatFrame[] = [];
    for await (const f of chat.run(INPUT)) frames.push(f);
    expect(frames.map((f) => f.type)).toStrictEqual(["error", "done"]);
    expect(frames[1]).toStrictEqual({ type: "done", reason: "complete" });
    const err = await collect(chat, INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(ChatModelError);
    expect(err.message).toContain("HTTP 500");
    expect(err.frames.map((f: ChatFrame) => f.type)).toStrictEqual(["error", "done"]);
  });

  it("done is the REASON, never a boolean — four values, four assertions", async () => {
    for (const reason of ["complete", "max-rounds", "too-large", "limited"] as const) {
      const r = await collect(fake([{ type: "text", text: "x" }, { type: "done", reason }]), INPUT);
      expect(r.done).toBe(reason);
    }
  });

  it("does NOT interpret: tool results come back as raw frames, no sources, no verdict", async () => {
    const tr: ChatFrame = { type: "tool-result", id: "t1", name: "search", result: { hits: [{ url: "https://x" }] } };
    const r = await collect(fake([{ type: "tool-call", id: "t1", name: "search", args: {} }, tr, { type: "text", text: "svar" }, { type: "done", reason: "complete" }]), INPUT);
    expect(r.toolResults).toStrictEqual([tr]);
    expect(Object.keys(r).sort()).toStrictEqual(["done", "frames", "text", "toolResults"]);
  });

  it("a scope:\"tool\" error does NOT throw — the model answered around it; it stays in frames", async () => {
    const e: ChatFrame = { type: "error", scope: "tool", name: "search", message: "timeout" };
    const r = await collect(fake([e, { type: "text", text: "uden søgning" }, { type: "done", reason: "complete" }]), INPUT);
    expect(r.frames).toContainEqual(e);
    expect(r.text).toBe("uden søgning");
  });

  it("a stream that ends with NO done frame throws — cut, not finished", async () => {
    await expect(collect(fake([{ type: "text", text: "halv" }]), INPUT)).rejects.toThrow(/without a done frame/);
  });
});
