import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createChat, defineTool, type ChatFrame, type ModelEvent, type ModelFn } from "../src/index.js";
import { createChatHandler, type ChatHandlerOptions } from "../src/http.js";
import { createChatRoute } from "../src/next.js";
import { chatHandler } from "../src/hono.js";
import { readChatStream } from "../src/client.js";
import { redactSecrets } from "../../secret-scan/src/index.js";

/**
 * F079.3 — the HTTP half.
 *
 * The whole file is driven over BOTH adapters from one table (see MOUNTS), so a
 * behaviour that holds in Next and not in Hono is a red test rather than a
 * production discovery. "Fix one half of a pair" is a measured fleet defect.
 */

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

type Caller = { id: string; grants: string[] };

const OWNER: Caller = { id: "owner", grants: ["roster.read", "roster.write"] };

function scripted(...events: ModelEvent[][]): ModelFn {
  let round = 0;
  return async function* () {
    const batch = events[Math.min(round++, events.length - 1)] ?? [];
    for (const ev of batch) yield ev;
  };
}

const say = (text: string): ModelEvent[] => [{ type: "text", text }];

function chatWith(model: ModelFn, tools: Parameters<typeof createChat>[0]["tools"] = []) {
  return createChat<unknown, Caller>({
    model,
    tools: tools as never,
    can: async (permission, caller) => caller.grants.includes(permission),
  });
}

function post(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://example.test/api/admin/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

/** THE ONE TABLE. Both stacks, one set of cases. */
const MOUNTS: Array<{ name: string; mount: (o: ChatHandlerOptions<unknown, Caller>) => (req: Request) => Promise<Response> }> = [
  { name: "next", mount: (o) => createChatRoute(o) },
  {
    name: "hono",
    mount: (o) => {
      const handler = chatHandler(o);
      return (req: Request) => handler({ req: { raw: req } });
    },
  },
];

async function collect(res: Response): Promise<ChatFrame[]> {
  const out: ChatFrame[] = [];
  for await (const frame of readChatStream(res)) out.push(frame);
  return out;
}

// ---------------------------------------------------------------------------
// AC1 — the adapter still carries no version pin
// ---------------------------------------------------------------------------

describe("the adapters add no dependency they could silently outgrow", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  it("declares no runtime dependencies at all", () => {
    expect(pkg.dependencies ?? null).toBeNull();
    expect(pkg.peerDependencies ?? null).toBeNull();
  });

  it("no BUILT adapter imports @broberg or a provider SDK", () => {
    // F061.2: @broberg/logger promised it "cannot leak a secret" while pinned
    // to a secret-scan four minors stale, because a caret on 0.x locks the
    // MINOR. A subpath that imported ai-sdk would re-enter that trap.
    for (const entry of ["http", "next", "hono", "client"]) {
      const js = readFileSync(new URL(`../dist/${entry}.js`, import.meta.url), "utf8");
      const imports = [...js.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]!);
      const external = imports.filter((s) => !s.startsWith("."));
      expect(external, `${entry}.js imports ${external.join(", ")}`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// AC2 + AC3 — who the caller is, and what happens when there isn't one
// ---------------------------------------------------------------------------

describe.each(MOUNTS)("$name · the caller is resolved on the server", ({ mount }) => {
  it("refuses to build without getCaller — there is no anonymous default", () => {
    expect(() =>
      // @ts-expect-error — omitting getCaller must not type-check either
      mount({ chat: chatWith(scripted(say("hi"))) }),
    ).toThrow(/getCaller/);
  });

  it("a caller forged in the request BODY is ignored", async () => {
    let seen: Caller | null = null;
    const handle = mount({
      chat: chatWith(scripted(say("ok"))),
      getCaller: () => {
        seen = OWNER;
        return OWNER;
      },
    });
    const res = await handle(
      post({
        messages: [{ role: "user", content: "hej" }],
        // everything below is attacker-supplied and must never be read
        caller: { id: "root", grants: ["roster.write"] },
        role: "owner",
        permissions: ["*"],
      }),
    );
    expect(res.status).toBe(200);
    expect(seen).toEqual(OWNER);
  });

  it("a role smuggled onto a MESSAGE is dropped, not carried", async () => {
    let got: unknown;
    const model: ModelFn = async function* (req) {
      got = req.messages;
      yield { type: "text", text: "ok" };
    };
    const handle = mount({ chat: chatWith(model), getCaller: () => OWNER });
    await collect(await handle(post({ messages: [{ role: "user", content: "hej", grants: ["roster.write"] }] })));
    expect(got).toEqual([{ role: "user", content: "hej" }]);
  });

  it("getCaller returning null is a 401 and the MODEL IS NEVER TOUCHED", async () => {
    let calls = 0;
    const model: ModelFn = async function* () {
      calls++;
      yield { type: "text", text: "should not happen" };
    };
    const handle = mount({ chat: chatWith(model), getCaller: () => null });
    const res = await handle(post({ messages: [{ role: "user", content: "hej" }] }));
    expect(res.status).toBe(401);
    // An empty tool list is NOT a substitute for refusing: an unauthenticated
    // request that still reaches the model is still an LLM bill.
    expect(calls).toBe(0);
  });

  it("rejects a non-POST, invalid JSON and a missing transcript — each distinctly", async () => {
    const handle = mount({ chat: chatWith(scripted(say("x"))), getCaller: () => OWNER });
    expect((await handle(new Request("https://example.test/c", { method: "GET" }))).status).toBe(405);
    expect(
      (await handle(new Request("https://example.test/c", { method: "POST", body: "{" }))).status,
    ).toBe(400);
    expect((await handle(post({ messages: "nope" }))).status).toBe(400);
    expect((await handle(post({ messages: [{ role: "wizard", content: "x" }] }))).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// AC4 — streaming asserted as a property, not as "events came out"
// ---------------------------------------------------------------------------

describe.each(MOUNTS)("$name · the answer streams", ({ mount }) => {
  it("the FIRST event arrives before the run has finished", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let finished = false;

    const model: ModelFn = async function* () {
      yield { type: "text", text: "first" };
      await gate;
      yield { type: "text", text: "second" };
      finished = true;
    };

    const handle = mount({ chat: chatWith(model), getCaller: () => OWNER });
    const res = await handle(post({ messages: [{ role: "user", content: "hej" }] }));
    const reader = res.body!.getReader();

    // Raced against a timer ON PURPOSE. A batched implementation does not fail
    // this test by producing wrong bytes — it produces NOTHING until the model
    // is done, which without the race is a five-second hang that takes the rest
    // of the suite down with it. A guard whose failure mode is a dead worker
    // tells you far less than one that says which claim broke.
    const first = await Promise.race([
      reader.read().then((r) => new TextDecoder().decode(r.value)),
      new Promise<string>((r) => setTimeout(() => r("__NOTHING_ARRIVED__"), 1000)),
    ]);

    // THE ASSERTION THAT MATTERS. A batched implementation would produce the
    // exact same bytes at the end, and every other check would still pass.
    expect(first, "nothing reached the browser until the whole answer existed").toContain("first");
    expect(finished, "the whole answer was produced before anything was sent").toBe(false);

    release();
    await reader.cancel().catch(() => {});
  });

  it("declares itself unbufferable — the headers a proxy needs", async () => {
    const handle = mount({ chat: chatWith(scripted(say("x"))), getCaller: () => OWNER });
    const res = await handle(post({ messages: [{ role: "user", content: "hej" }] }));
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("cache-control")).toMatch(/no-transform/);
    expect(res.headers.get("x-accel-buffering")).toBe("no");
  });
});

// ---------------------------------------------------------------------------
// AC5 — a closed tab stops the work, with the control that proves it
// ---------------------------------------------------------------------------

describe.each(MOUNTS)("$name · an aborted request stops the work", ({ mount }) => {
  function endlessModel() {
    const state = { closed: false, produced: 0 };
    const model: ModelFn = async function* () {
      try {
        for (;;) {
          state.produced++;
          yield { type: "text", text: `chunk ${state.produced}` };
        }
      } finally {
        state.closed = true; // the generator was told to stop
      }
    };
    return { model, state };
  }

  it("aborting closes the stream AND unwinds the model", async () => {
    const { model, state } = endlessModel();
    const controller = new AbortController();
    const handle = mount({ chat: chatWith(model), getCaller: () => OWNER });
    const res = await handle(post({ messages: [{ role: "user", content: "hej" }] }, { signal: controller.signal }));
    const reader = res.body!.getReader();

    await reader.read();
    await reader.read();
    const producedAtAbort = state.produced;
    controller.abort();

    const next = await reader.read();
    expect(next.done, "the stream kept producing after the tab closed").toBe(true);
    expect(state.closed, "the model generator was never unwound").toBe(true);
    expect(state.produced).toBeLessThanOrEqual(producedAtAbort + 1);
  });

  it("NEGATIVE CONTROL: without the abort, the same fixture keeps going", async () => {
    // Without this, the test above would pass on a stream that stops for any
    // reason at all — and would prove the fixture rather than the guard.
    const { model, state } = endlessModel();
    const handle = mount({ chat: chatWith(model), getCaller: () => OWNER });
    const res = await handle(post({ messages: [{ role: "user", content: "hej" }] }));
    const reader = res.body!.getReader();
    for (let i = 0; i < 5; i++) expect((await reader.read()).done).toBe(false);
    expect(state.closed).toBe(false);
    expect(state.produced).toBeGreaterThanOrEqual(5);
    await reader.cancel();
  });
});

// ---------------------------------------------------------------------------
// AC6 — errors are data, never a dead stream
// ---------------------------------------------------------------------------

describe.each(MOUNTS)("$name · a failure reaches the browser as data", ({ mount }) => {
  const boom = defineTool<unknown>({
    name: "roster_lookup",
    description: "look someone up",
    permission: "roster.read",
    parameters: { type: "object", properties: {} },
    run: () => {
      throw new Error("the roster service is down");
    },
  });

  it("a throwing TOOL: error frame, then done, and the status is still 200", async () => {
    const handle = mount({
      chat: chatWith(scripted([{ type: "tool-call", id: "1", name: "roster_lookup", args: {} }], say("sorry")), [boom]),
      getCaller: () => OWNER,
    });
    const res = await handle(post({ messages: [{ role: "user", content: "hej" }] }));
    expect(res.status).toBe(200);
    const frames = await collect(res);
    expect(frames.some((f) => f.type === "error" && f.message.includes("roster service is down"))).toBe(true);
    expect(frames.at(-1)).toEqual({ type: "done", reason: "complete" });
  });

  it("a throwing MODEL also ends in done, not a half-open stream", async () => {
    const model: ModelFn = async function* () {
      yield { type: "text", text: "partial" };
      throw new Error("upstream 503");
    };
    const handle = mount({ chat: chatWith(model), getCaller: () => OWNER });
    const frames = await collect(await handle(post({ messages: [{ role: "user", content: "hej" }] })));
    // A stream that simply stops is indistinguishable from a slow answer — the
    // exact failure @broberg/seti-client/sse exists for.
    expect(frames.at(-1)?.type).toBe("done");
    expect(frames.some((f) => f.type === "error")).toBe(true);
  });

  it("a non-2xx THROWS in the client rather than reading as an empty answer", async () => {
    const handle = mount({ chat: chatWith(scripted(say("x"))), getCaller: () => null });
    const res = await handle(post({ messages: [{ role: "user", content: "hej" }] }));
    await expect(collect(res)).rejects.toThrow(/401/);
  });
});

// ---------------------------------------------------------------------------
// AC7 — the round trip, on the shapes that break naive SSE parsers
// ---------------------------------------------------------------------------

describe.each(MOUNTS)("$name · what was sent is what arrives", ({ mount }) => {
  it("core frames → SSE bytes → client frames, by STRICT deep equality", async () => {
    const nasty = [
      { type: "text", text: "line one\nline two" }, // multi-line
      { type: "text", text: "before\n\nafter" }, // a BLANK LINE — the SSE record separator itself
      { type: "text", text: 'quotes " and \\ backslash, data: not-a-field' },
      { type: "text", text: "æøå 🇩🇰 — non-ASCII across a decoder boundary" },
    ] as const;

    const handle = mount({
      chat: chatWith(scripted(nasty.map((f) => ({ type: "text", text: f.text }) as ModelEvent))),
      getCaller: () => OWNER,
    });
    const frames = await collect(await handle(post({ messages: [{ role: "user", content: "hej" }] })));

    expect(frames).toEqual([...nasty.map((f) => ({ type: "text", text: f.text })), { type: "done", reason: "complete" }]);
  });

  it("survives chunk boundaries that split an event in half", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(`data: ${JSON.stringify({ type: "text", text: "split me" })}\n\ndata: ${JSON.stringify({ type: "done", reason: "complete" })}\n\n`);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    });
    const out: ChatFrame[] = [];
    for await (const f of readChatStream(stream)) out.push(f);
    expect(out).toEqual([
      { type: "text", text: "split me" },
      { type: "done", reason: "complete" },
    ]);
  });

  it("ignores keep-alive comments and fields it does not own", async () => {
    const raw = `: keep-alive\n\nid: 7\nevent: message\ndata: ${JSON.stringify({ type: "text", text: "ok" })}\n\n`;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(raw));
        c.close();
      },
    });
    const out: ChatFrame[] = [];
    for await (const f of readChatStream(stream)) out.push(f);
    expect(out).toEqual([{ type: "text", text: "ok" }]);
  });
});

// ---------------------------------------------------------------------------
// AC8 — the two adapters really are the same code
// ---------------------------------------------------------------------------

describe("Next and Hono cannot drift", () => {
  it("both mounts produce byte-identical output for the same input", async () => {
    const opts = () => ({ chat: chatWith(scripted(say("same"))), getCaller: () => OWNER });
    const bodies: string[] = [];
    for (const { mount } of MOUNTS) {
      const res = await mount(opts() as ChatHandlerOptions<unknown, Caller>)(
        post({ messages: [{ role: "user", content: "hej" }] }),
      );
      bodies.push(await res.text());
    }
    expect(bodies[0]).toBe(bodies[1]);
  });

  it("the shared table actually covers both — a guard against a silently empty MOUNTS", () => {
    expect(MOUNTS.map((m) => m.name)).toEqual(["next", "hono"]);
  });
});

// ---------------------------------------------------------------------------
// AC9 — what the adapter itself puts on the wire
// ---------------------------------------------------------------------------

describe("the adapter adds nothing to the wire that it should not", () => {
  const CTX_MARKER = "CTX-MARKER-do-not-serialise";
  const PERMISSION = "roster.read.PERMISSION-MARKER-9f3";
  const STACK_MARKER = "chat.test.ts";

  const tool = defineTool<{ marker: string }>({
    name: "roster_lookup",
    description: "look someone up",
    permission: PERMISSION,
    parameters: { type: "object", properties: {} },
    run: () => {
      throw new Error("lookup failed");
    },
  });

  it("no ctx, no permission string and no stack trace appear in the SSE bytes", async () => {
    const chat = createChat<{ marker: string }, Caller>({
      model: scripted([{ type: "tool-call", id: "1", name: "roster_lookup", args: {} }], say("sorry")),
      tools: [tool],
      can: async (p, c) => c.grants.includes(p),
    });
    const handle = createChatHandler<{ marker: string }, Caller>({
      chat,
      getCaller: () => ({ id: "owner", grants: [PERMISSION] }),
      getCtx: () => ({ marker: CTX_MARKER }),
    });
    const body = await (await handle(post({ messages: [{ role: "user", content: "hej" }] }))).text();

    expect(body).toContain("lookup failed"); // the tool's own message IS passed through
    expect(body).not.toContain(CTX_MARKER);
    expect(body).not.toContain(PERMISSION);
    expect(body).not.toContain(STACK_MARKER);
    expect(body).not.toMatch(/\n\s+at /); // no stack frames
  });

  it("DOCUMENTED BOUNDARY: a tool RESULT is passed through verbatim, secrets and all", async () => {
    // Not an oversight and not something to silently fix here. The result is
    // the CONSUMER's data on their own admin surface, and quietly rewriting it
    // would be a worse surprise than passing it on. Redaction is opt-in and
    // belongs to F079.6 — this test exists so nobody can believe otherwise.
    const leaky = defineTool<unknown>({
      name: "config_read",
      description: "read a config row",
      permission: "roster.read",
      parameters: { type: "object", properties: {} },
      // Split exactly the way @broberg/secret-scan's OWN fixtures are, so the
      // pre-commit gate does not have to be talked out of doing its job. A
      // synthetic credential that must LOOK real is the one case for it.
      run: () => ({ stripe: "whsec_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Qr" }),
    });
    const chat = createChat<unknown, Caller>({
      model: scripted([{ type: "tool-call", id: "1", name: "config_read", args: {} }], say("done")),
      tools: [leaky],
      can: async (p, c) => c.grants.includes(p),
    });
    const body = await (
      await createChatHandler<unknown, Caller>({ chat, getCaller: () => OWNER })(
        post({ messages: [{ role: "user", content: "hej" }] }),
      )
    ).text();

    const { findings } = redactSecrets(body);
    expect(findings.length, "the boundary moved — a tool result is no longer passed through").toBeGreaterThan(0);
  });

  it("the adapter's OWN 4xx bodies carry nothing but a code", async () => {
    const handle = createChatHandler<unknown, Caller>({
      chat: chatWith(scripted(say("x"))),
      getCaller: () => null,
    });
    const res = await handle(post({ messages: [{ role: "user", content: "hej" }] }));
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });
});
