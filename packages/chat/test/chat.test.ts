import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  DEFAULT_BOT_NAME,
  botName,
  corePrompt,
  createChat,
  defineTool,
  type ChatFrame,
  type ChatTool,
  type ModelEvent,
  type ModelFn,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// fixtures — fd-sundhed's real role model, measured by them 2026-08-27:
//   owner 1 · admin 10 · leder 914 · user 13
// and the thing that makes a role list wrong: access_revoked_at sits BESIDE the
// role, and an admin whose access was revoked got in until a guard checked both.
// ---------------------------------------------------------------------------

interface Caller {
  role: "owner" | "admin" | "leder" | "user";
  accessRevokedAt?: string | null;
}

const OWNER: Caller = { role: "owner" };
const ADMIN: Caller = { role: "admin" };
const READONLY: Caller = { role: "user" };
const REVOKED_ADMIN: Caller = { role: "admin", accessRevokedAt: "2026-08-01" };

const GRANTS: Record<string, Caller["role"][]> = {
  "chat.use": ["owner", "admin", "leder"],
  "roster.read": ["owner", "admin", "leder"],
  "roster.write": ["owner", "admin"],
};

const can = (permission: string, caller: Caller) =>
  // BOTH halves, which is the point: role alone was not the gate at fd-sundhed.
  !caller.accessRevokedAt && (GRANTS[permission] ?? []).includes(caller.role);

const read = defineTool<{ db: string }>({
  name: "roster_lookup",
  description: "Look up one employee across roster, users and audit-log",
  permission: "roster.read",
  parameters: { type: "object", properties: { email: { type: "string" } } },
  run: (args) => ({ email: args.email, invited: true, delivered: false }),
});

const write = defineTool<{ db: string }>({
  name: "roster_invite",
  description: "Re-send an invitation",
  permission: "roster.write",
  mutates: true,
  parameters: { type: "object", properties: { email: { type: "string" } } },
  run: () => ({ sent: true }),
});

/** A fake model driven by a script — no key, no network, fully deterministic. */
function scriptedModel(...rounds: ModelEvent[][]): ModelFn {
  let i = 0;
  return async function* () {
    const round = rounds[i++] ?? [];
    for (const ev of round) yield ev;
  };
}

async function collect(stream: AsyncIterable<ChatFrame>): Promise<ChatFrame[]> {
  const out: ChatFrame[] = [];
  for await (const f of stream) out.push(f);
  return out;
}

const CTX = { db: "fd" };

// ---------------------------------------------------------------------------
// AC 0 + 1 — permission is required, and cms's line is unrepresentable
// ---------------------------------------------------------------------------

describe("a tool without a declared permission is DENIED, never allowed", () => {
  it("fails to type-check", () => {
    // @ts-expect-error — `permission` is required; removing it must not compile.
    const bad: ChatTool = { name: "x", description: "", parameters: {}, run: () => 1 };
    expect(bad).toBeTruthy(); // the assertion above is the compiler's
  });

  it("THROWS at runtime — the path a compiler cannot cover", () => {
    // A registry built from config, or a JS consumer. This is exactly where
    // cms's 60 permission-less tools came from.
    const built = { name: "roster_delete", description: "", parameters: {}, run: () => 1 };
    expect(() => defineTool(built as unknown as ChatTool)).toThrow(/declares no `permission`/);
  });

  it("names the reason, so it survives the commit that reads it", () => {
    const built = { name: "x", description: "", parameters: {}, run: () => 1 };
    expect(() => defineTool(built as unknown as ChatTool)).toThrow(/DENIED/);
  });

  it("cms's EXACT filter cannot be reproduced: there is no permission-less tool to pass", () => {
    // Their line was:  tools.filter(t => !t.permission || hasPermission(user, t))
    // `!t.permission ||` let 60 of 64 through. Here the object never becomes a
    // tool at all, so the truthiness test has nothing to be lenient about.
    const attempts = [
      { name: "a", description: "", parameters: {}, run: () => 1 },
      { name: "b", description: "", parameters: {}, permission: "", run: () => 1 },
      { name: "c", description: "", parameters: {}, permission: "   ", run: () => 1 },
    ];
    for (const a of attempts) {
      expect(() => defineTool(a as unknown as ChatTool)).toThrow();
    }
  });

  it("refuses to build a chat with tools and no `can` — no permissive default", () => {
    expect(() => createChat({ model: scriptedModel([]), tools: [read] })).toThrow(/no permissive default/);
  });
});

// ---------------------------------------------------------------------------
// AC 2 + 3 — denied tools are invisible, and permission is per caller
// ---------------------------------------------------------------------------

describe("authorization is asked per caller, not per process", () => {
  const chat = createChat<{ db: string }, Caller>({
    model: scriptedModel([]),
    tools: [read, write],
    can,
  });

  it("one registry, three callers, three different tool lists", async () => {
    expect((await chat.toolsFor(OWNER)).map((t) => t.name)).toEqual(["roster_lookup", "roster_invite"]);
    expect((await chat.toolsFor(ADMIN)).map((t) => t.name)).toEqual(["roster_lookup", "roster_invite"]);
    expect((await chat.toolsFor(READONLY)).map((t) => t.name)).toEqual([]);
  });

  it("a read-only caller receives ZERO mutating tools", async () => {
    const mutating = (await chat.toolsFor(READONLY)).filter((t) => t.mutates);
    expect(mutating).toEqual([]);
  });

  it("a REVOKED admin gets nothing — role alone is not the gate", async () => {
    // fd-sundhed's own incident: PRIVILEGED_ROLES granted access on role, and an
    // admin with access_revoked_at set walked in. The core asks the consumer
    // precisely so this stays the consumer's rule to enforce.
    expect(await chat.toolsFor(REVOKED_ADMIN)).toEqual([]);
    expect(await chat.toolsFor(ADMIN)).not.toEqual([]);
  });

  it("a denied tool is never OFFERED to the model", async () => {
    let seen: string[] = [];
    const spyModel: ModelFn = async function* (req) {
      seen = req.tools.map((t) => t.name);
    };
    const c = createChat<{ db: string }, Caller>({ model: spyModel, tools: [read, write], can });
    await collect(c.run({ messages: [{ role: "user", content: "hi" }], caller: READONLY, ctx: CTX }));
    expect(seen).toEqual([]);
  });

  it("…and the spec the model sees carries no permission or run", async () => {
    let keys: string[] = [];
    const spyModel: ModelFn = async function* (req) {
      keys = Object.keys(req.tools[0] ?? {}).sort();
    };
    const c = createChat<{ db: string }, Caller>({ model: spyModel, tools: [read], can });
    await collect(c.run({ messages: [{ role: "user", content: "hi" }], caller: ADMIN, ctx: CTX }));
    expect(keys).toEqual(["description", "name", "parameters"]);
  });

  it("SECOND GATE: an unavailable name arriving anyway is refused, not run", async () => {
    let ran = false;
    const trap = defineTool<{ db: string }>({
      name: "roster_invite",
      description: "",
      permission: "roster.write",
      parameters: {},
      run: () => {
        ran = true;
        return 1;
      },
    });
    const c = createChat<{ db: string }, Caller>({
      // the model invents a call to a tool this caller may not use
      model: scriptedModel([{ type: "tool-call", id: "1", name: "roster_invite", args: {} }], []),
      tools: [trap],
      can,
    });
    const frames = await collect(c.run({ messages: [], caller: READONLY, ctx: CTX }));
    expect(ran).toBe(false);
    const err = frames.find((f) => f.type === "error");
    expect(err).toMatchObject({ scope: "tool", name: "roster_invite" });
    expect((err as { message: string }).message).toMatch(/no tool named/);
  });
});

// ---------------------------------------------------------------------------
// AC 4 — it streams, and a full tool round works
// ---------------------------------------------------------------------------

describe("the loop streams typed frames", () => {
  const chat = createChat<{ db: string }, Caller>({
    model: scriptedModel(
      [
        { type: "text", text: "Lad mig se efter. " },
        { type: "tool-call", id: "c1", name: "roster_lookup", args: { email: "a@b.dk" } },
      ],
      [{ type: "text", text: "Invitationen blev sendt, men ikke leveret." }],
    ),
    tools: [read, write],
    can,
  });

  it("runs text → tool call → tool result → text → done", async () => {
    const frames = await collect(
      chat.run({ messages: [{ role: "user", content: "hvorfor?" }], caller: ADMIN, ctx: CTX }),
    );
    expect(frames.map((f) => f.type)).toEqual(["text", "tool-call", "tool-result", "text", "done"]);
    expect(frames.at(-1)).toEqual({ type: "done", reason: "complete" });
    expect(frames[2]).toMatchObject({ type: "tool-result", name: "roster_lookup" });
  });

  it("frames arrive BEFORE the run finishes — not batched at the end", async () => {
    // The whole reason the core streams: trail measured 13.1s average response.
    // A core that yields everything at the end could not be extended into a
    // streaming one, it would have to be rewritten.
    let finished = false;
    const slow = createChat<{ db: string }, Caller>({
      model: async function* () {
        yield { type: "text", text: "a" } as ModelEvent;
        yield { type: "text", text: "b" } as ModelEvent;
        finished = true;
      },
      tools: [],
    });
    const it_ = slow.run({ messages: [], caller: ADMIN, ctx: CTX })[Symbol.asyncIterator]();
    const first = await it_.next();
    expect(first.value).toEqual({ type: "text", text: "a" });
    expect(finished).toBe(false); // proof it is not a buffered array
  });

  it("stops at max-rounds with a DISTINCT reason, not a silent 'complete'", async () => {
    const looper = createChat<{ db: string }, Caller>({
      model: async function* () {
        yield { type: "tool-call", id: "x", name: "roster_lookup", args: {} } as ModelEvent;
      },
      tools: [read],
      can,
      maxRounds: 2,
    });
    const frames = await collect(looper.run({ messages: [], caller: ADMIN, ctx: CTX }));
    expect(frames.at(-1)).toEqual({ type: "done", reason: "max-rounds" });
    // A caller that cannot tell these apart reports a truncated answer as finished.
    expect(frames.at(-1)).not.toEqual({ type: "done", reason: "complete" });
  });
});

// ---------------------------------------------------------------------------
// AC 5 — "I cannot look that up" is not "no"
// ---------------------------------------------------------------------------

describe("a missing tool must not become a negative fact", () => {
  it("the core prompt instructs the honest answer", () => {
    // Christian asked Eir whether Sanne sells anything. Eir said NO, confidently,
    // because the shop tool was missing. The model was not confused — it was
    // blind and sounded certain, and a missing capability became a false
    // statement about a business.
    const p = corePrompt("Aidan");
    expect(p).toMatch(/cannot look it up/i);
    expect(p).toMatch(/different answers/i);
    expect(p).toMatch(/never turn a missing tool into a negative fact/i);
  });

  it("the core never answers on a missing tool's behalf", async () => {
    // With no tools at all, nothing is fabricated: the model's own words come
    // through and the core adds no content of its own.
    const c = createChat({ model: scriptedModel([{ type: "text", text: "Det kan jeg ikke slå op." }]) });
    const frames = await collect(c.run({ messages: [], caller: ADMIN, ctx: CTX }));
    const text = frames.filter((f) => f.type === "text").map((f) => (f as { text: string }).text).join("");
    expect(text).toBe("Det kan jeg ikke slå op.");
  });
});

// ---------------------------------------------------------------------------
// AC 6 — a broken tool degrades the answer, never the conversation
// ---------------------------------------------------------------------------

describe("a throwing tool does not kill the conversation", () => {
  const boom = defineTool<{ db: string }>({
    name: "roster_lookup",
    description: "",
    permission: "roster.read",
    parameters: {},
    run: () => {
      throw new Error("upstream 503");
    },
  });

  it("emits an error frame and still reaches done", async () => {
    const c = createChat<{ db: string }, Caller>({
      model: scriptedModel(
        [{ type: "tool-call", id: "1", name: "roster_lookup", args: {} }],
        [{ type: "text", text: "Det kunne jeg ikke hente." }],
      ),
      tools: [boom],
      can,
    });
    const frames = await collect(c.run({ messages: [], caller: ADMIN, ctx: CTX }));
    expect(frames.map((f) => f.type)).toEqual(["tool-call", "error", "text", "done"]);
    expect(frames[1]).toMatchObject({ scope: "tool", name: "roster_lookup", message: "upstream 503" });
    expect(frames.at(-1)).toEqual({ type: "done", reason: "complete" });
  });

  it("a REJECTING tool is caught too, not left as an unhandled rejection", async () => {
    const rejecting = defineTool<{ db: string }>({
      name: "roster_lookup",
      description: "",
      permission: "roster.read",
      parameters: {},
      run: async () => {
        throw new Error("timeout");
      },
    });
    const c = createChat<{ db: string }, Caller>({
      model: scriptedModel([{ type: "tool-call", id: "1", name: "roster_lookup", args: {} }], []),
      tools: [rejecting],
      can,
    });
    const frames = await collect(c.run({ messages: [], caller: ADMIN, ctx: CTX }));
    expect(frames.find((f) => f.type === "error")).toMatchObject({ message: "timeout" });
    expect(frames.at(-1)?.type).toBe("done");
  });

  it("a model that throws ends the stream cleanly instead of exploding at the caller", async () => {
    const c = createChat({
      model: async function* () {
        throw new Error("provider quota");
      },
    });
    const frames = await collect(c.run({ messages: [], caller: ADMIN, ctx: CTX }));
    expect(frames[0]).toMatchObject({ type: "error", scope: "model", message: "provider quota" });
    expect(frames.at(-1)?.type).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// AC 7 — the bot is Aidan, from ONE place
// ---------------------------------------------------------------------------

describe("the bot's name has a single source", () => {
  it("defaults to Aidan", () => {
    expect(DEFAULT_BOT_NAME).toBe("Aidan");
    expect(botName({})).toBe("Aidan");
  });

  it("one env variable overrides it for a whole site", () => {
    expect(botName({ CHAT_BOT_NAME: "Eir" })).toBe("Eir");
    expect(corePrompt(botName({ CHAT_BOT_NAME: "Eir" }))).toMatch(/You are Eir\./);
  });

  it("an empty or blank override falls back rather than naming the bot nothing", () => {
    expect(botName({ CHAT_BOT_NAME: "" })).toBe("Aidan");
    expect(botName({ CHAT_BOT_NAME: "   " })).toBe("Aidan");
  });

  it("the override reaches what the MODEL is told, not just the export", async () => {
    let system = "";
    const c = createChat({
      model: async function* (req) {
        system = req.system;
      },
      name: "Eir",
    });
    await collect(c.run({ messages: [], caller: ADMIN, ctx: CTX }));
    expect(system).toMatch(/You are Eir\./);
  });

  it("the literal 'Aidan' appears in exactly ONE source file", () => {
    // Christian's rule: one value, one place, trickling down. A name repeated
    // across files is a name that drifts the first time one copy is edited.
    const files = readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".ts"));
    const hits = files.filter((f) =>
      readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8").includes('"Aidan"'),
    );
    expect(hits).toEqual(["index.ts"]);
  });
});

// ---------------------------------------------------------------------------
// AC 8 — zero dependencies
// ---------------------------------------------------------------------------

describe("the core carries nothing it can silently outgrow", () => {
  it("declares no runtime dependencies at all", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  it("imports no @broberg package and no provider SDK", () => {
    // F061.2: @broberg/logger promised it "cannot leak a secret" while pinned to
    // a secret-scan four minors stale. A package cannot know its promise has
    // become untrue because of something underneath it — so this one has nothing
    // underneath it.
    const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    for (const forbidden of ["@broberg/", "@anthropic", "openai", "@mistralai", "ai-sdk"]) {
      expect(src.includes(`from "${forbidden}`)).toBe(false);
      expect(src.includes(`require("${forbidden}`)).toBe(false);
    }
  });
});
