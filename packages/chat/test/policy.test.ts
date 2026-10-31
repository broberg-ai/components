// components-F079.8 — rules that can FAIL: a policy over the outgoing stream,
// and residency decided on the route that ACTUALLY answered.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { createChat, collect, type ChatFrame, type ModelEvent, type ModelFn } from "../src/index.js";

const input = { messages: [{ role: "user" as const, content: "jeg har ondt i knæet" }], caller: { id: "u1" }, ctx: {} };

/** A fake model that yields the given events, once. */
const model = (events: ModelEvent[]): ModelFn =>
  async function* () {
    for (const e of events) yield e;
  };
async function frames(chat: ReturnType<typeof createChat>): Promise<ChatFrame[]> {
  const out: ChatFrame[] = [];
  for await (const f of chat.run(input)) out.push(f);
  return out;
}
const textOf = (fs: ChatFrame[]) => fs.filter((f): f is Extract<ChatFrame, { type: "text" }> => f.type === "text").map((f) => f.text).join("");
const tail = (fs: ChatFrame[]) => fs.slice(-2).map((f) => (f.type === "refused" ? `refused:${f.reason}` : f.type === "done" ? `done:${f.reason}` : f.type));

const EU = { type: "route" as const, provider: "mistral", model: "mistral-large-2512", region: "eu" };
const US = { type: "route" as const, provider: "openai", model: "gpt-x", region: "us" };

describe("AC0 — a rule is code: it sees every outgoing text frame and can allow / block / rewrite", () => {
  it("a rule that blocks: nothing of the answer reaches the caller, and the run ends refused:policy", async () => {
    const chat = createChat({ model: model([{ type: "text", text: "Det lyder som en menisklæsion." }]), policy: () => "block" });
    const fs = await frames(chat);
    expect(textOf(fs)).toBe("");
    expect(tail(fs)).toEqual(["refused:policy", "done:refused"]);
  });
  it("a rule that rewrites: the caller receives the rewrite, not the model's text", async () => {
    const chat = createChat({ model: model([{ type: "text", text: "Det er nok en forstuvning." }]), policy: () => ({ rewrite: "Skal jeg finde en tid til dig?" }) });
    const fs = await frames(chat);
    expect([textOf(fs), tail(fs)]).toEqual(["Skal jeg finde en tid til dig?", ["text", "done:complete"]]);
  });
  it("{ block: note } carries the rule's note on the refused frame", async () => {
    const chat = createChat({ model: model([{ type: "text", text: "x" }]), policy: () => ({ block: "named a condition" }) });
    const fs = await frames(chat);
    expect(fs.find((f) => f.type === "refused")).toEqual({ type: "refused", reason: "policy", note: "named a condition" });
  });
  it("NEGATIVE CONTROL: no policy → the same text goes out unchanged", async () => {
    const fs = await frames(createChat({ model: model([{ type: "text", text: "Det lyder som en menisklæsion." }]) }));
    expect([textOf(fs), tail(fs)]).toEqual(["Det lyder som en menisklæsion.", ["text", "done:complete"]]);
  });
  it("the rule is told who is asking and what was already sent", async () => {
    const seen: unknown[] = [];
    const chat = createChat({
      model: model([{ type: "text", text: "a" }, { type: "text", text: "b" }]),
      policy: (o) => (seen.push({ text: o.text, soFar: o.soFar, round: o.round, caller: o.caller }), "allow"),
    });
    await frames(chat);
    expect(seen).toEqual([
      { text: "a", soFar: "", round: 0, caller: { id: "u1" } },
      { text: "b", soFar: "a", round: 0, caller: { id: "u1" } },
    ]);
  });
});

describe("AC1 — the policy sees the STREAM, not the final answer", () => {
  it("blocks in the SECOND delta: the first went out, the offending one and everything after did not", async () => {
    const chat = createChat({
      model: model([
        { type: "text", text: "Tak for din besked. " },
        { type: "text", text: "Det er en korsbåndsskade. " },
        { type: "text", text: "Hvil benet." },
      ]),
      policy: ({ text }) => (/skade/.test(text) ? "block" : "allow"),
    });
    const fs = await frames(chat);
    expect(textOf(fs)).toBe("Tak for din besked. ");
    expect(tail(fs)).toEqual(["refused:policy", "done:refused"]);
  });
});

describe("AC2 + AC3 — residency is decided on the route that ANSWERED", () => {
  const failover = (): ModelEvent[] => [
    EU,
    { type: "text", text: "Fra Paris. " },
    US, // the EU route failed, a fallback took over
    { type: "text", text: "Fra Virginia." },
    { type: "usage", provider: "openai", model: "gpt-x", region: "us" },
  ];
  it("EU → US failover mid-run, with { allow: ['eu'] }: aborts with a distinct frame, and NO text from the US route reaches the caller", async () => {
    const fs = await frames(createChat({ model: model(failover()), residency: { allow: ["eu"] } }));
    expect(textOf(fs)).toBe("Fra Paris. ");
    expect(fs.find((f) => f.type === "refused")).toMatchObject({ type: "refused", reason: "residency", region: "us", provider: "openai", model: "gpt-x" });
    expect(tail(fs)).toEqual(["refused:residency", "done:refused"]);
  });
  it("NEGATIVE CONTROL: the SAME failover with NO requirement runs unimpeded to done", async () => {
    const fs = await frames(createChat({ model: model(failover()) }));
    expect([textOf(fs), tail(fs)]).toEqual(["Fra Paris. Fra Virginia.", ["text", "done:complete"]]);
  });
  it("text before any route is attested is HELD, then released once usage attests an allowed region", async () => {
    const fs = await frames(createChat({
      model: model([{ type: "text", text: "Hej " }, { type: "text", text: "der." }, { type: "usage", provider: "mistral", model: "m", region: "eu" }]),
      residency: { allow: ["eu"] },
    }));
    expect([textOf(fs), tail(fs)]).toEqual(["Hej der.", ["text", "done:complete"]]);
  });
  it("held text from a route that turns out to be US never goes out", async () => {
    const fs = await frames(createChat({
      model: model([{ type: "text", text: "secret" }, { type: "usage", provider: "openai", model: "x", region: "us" }]),
      residency: { allow: ["eu"] },
    }));
    expect([textOf(fs), tail(fs)]).toEqual(["", ["refused:residency", "done:refused"]]);
  });
  it("a usage region that disagrees with the attested route (a silent switch) refuses", async () => {
    const fs = await frames(createChat({
      model: model([EU, { type: "text", text: "a" }, { type: "usage", provider: "openai", model: "x", region: "us" }]),
      residency: { allow: ["eu"] },
    }));
    expect(tail(fs)).toEqual(["refused:residency", "done:refused"]);
  });
});

describe("AC7 — unattested is not compliant: an unanswerable question reads as unanswered", () => {
  it("residency declared, the model never reports a region → refused:residency_unattested, nothing sent", async () => {
    const fs = await frames(createChat({ model: model([{ type: "text", text: "svar" }, { type: "usage", provider: "mistral", model: "m" }]), residency: { allow: ["eu"] } }));
    expect([textOf(fs), tail(fs)]).toEqual(["", ["refused:residency_unattested", "done:refused"]]);
  });
  it("…and with no usage at all", async () => {
    const fs = await frames(createChat({ model: model([{ type: "text", text: "svar" }]), residency: { allow: ["eu"] } }));
    expect(tail(fs)).toEqual(["refused:residency_unattested", "done:refused"]);
  });
  it("an empty or blank allow-list is refused at construction, not at the first answer", () => {
    expect(() => createChat({ model: model([]), residency: { allow: [] } })).toThrow(/non-empty/);
    expect(() => createChat({ model: model([]), residency: { allow: [" "] } })).toThrow(/non-empty/);
  });
});

describe("AC4 — FAIL CLOSED: a rule that throws or rejects blocks", () => {
  it.each([
    ["throws", () => { throw new Error("rule bug"); }],
    ["rejects", async () => { throw new Error("rule bug"); }],
    ["returns nonsense", () => "maybe" as never],
  ])("a rule that %s → refused:policy_error, nothing sent", async (_n, rule) => {
    const fs = await frames(createChat({ model: model([{ type: "text", text: "svar" }]), policy: rule as never }));
    expect([textOf(fs), tail(fs)]).toEqual(["", ["refused:policy_error", "done:refused"]]);
  });
});

describe("collect() reports a refusal as its own done reason", () => {
  it("done: 'refused', with the refused frame in frames", async () => {
    const r = await collect(createChat({ model: model([{ type: "text", text: "x" }]), policy: () => "block" }), input);
    expect([r.done, r.text, r.frames.some((f) => f.type === "refused")]).toEqual(["refused", "", true]);
  });
});

describe("AC5 + AC7 + AC9 — the package ships the mechanism, never a rule or a table", () => {
  const src = readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"))
    // comments may DISCUSS a rule; only code may not CONTAIN one
    .map((t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"))
    .join("\n");
  it("no clinical vocabulary in the code", () => {
    expect(src.match(/diagnos|sygdom|symptom|menisk|korsbånd|lidelse/gi)).toBeNull();
  });
  it("no provider→region table, and no residency from resolveModel", () => {
    expect(src.match(/(mistral|openai|anthropic|gemini|vertex|deepseek)["']?\s*[:=]\s*["'](eu|us|cn)["']/gi)).toBeNull();
    expect(src.includes("resolveModel")).toBe(false);
  });
});
