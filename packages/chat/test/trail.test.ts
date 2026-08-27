import { describe, expect, it } from "vitest";
import { createChat, type ChatFrame, type ModelEvent, type ModelFn } from "../src/index.js";
import { trailRetriever, type TrailResult } from "../src/trail.js";

/**
 * F079.2 — the Trail retriever.
 *
 * The response fixture below is not invented. sanne probed the DEPLOYED engine
 * from inside production while answering us and reported the real keys — two of
 * which (`images`, `userNote`) their own TypeScript type did not declare and
 * had been silently discarding. A type is not a contract test; this is one.
 */

const TOKEN = "trail_" + "s3cr3ttoken0123456789";
const KB = "fd-sundhed-admin";
const BASE = "https://engine.trailmem.com";

/** Measured by sanne, 2026-08-27: 5 top-level keys, 8 chunk keys. */
const MEASURED_RESPONSE = {
  chunks: [
    {
      documentId: "doc-1",
      seqId: 4,
      title: "Deltid og vikarer",
      neuronPath: "/ordning/adgang",
      content: "En medarbejder på deltid er omfattet af ordningen.",
      headerBreadcrumb: "Ordningen › Adgang",
      rank: 0.81,
      userNote: "bekræftet af FDAA",
    },
    {
      documentId: "doc-2",
      seqId: 1,
      title: "Antal behandlinger",
      neuronPath: "/ordning/behandlinger",
      content: "Der er fem behandlinger i et forløb.",
      headerBreadcrumb: "Ordningen › Behandlinger",
      rank: 0.62,
      userNote: null,
    },
  ],
  formattedContext: "## Deltid og vikarer\nEn medarbejder på deltid er omfattet.",
  totalChars: 1566,
  hitCount: 2,
  images: [],
};

const TOP_LEVEL_KEYS = ["chunks", "formattedContext", "totalChars", "hitCount", "images"];
const CHUNK_KEYS = ["documentId", "seqId", "title", "neuronPath", "content", "headerBreadcrumb", "rank", "userNote"];

function fakeFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as unknown as typeof globalThis.fetch;
  return { fn, calls };
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function retriever(fetchFn: typeof globalThis.fetch, over: Record<string, unknown> = {}) {
  return trailRetriever({
    baseUrl: BASE,
    kbId: KB,
    token: TOKEN,
    permission: "knowledge.read",
    fetch: fetchFn,
    ...over,
  });
}

async function lookup(fetchFn: typeof globalThis.fetch, args: Record<string, unknown> = { query: "må en vikar bruge det?" }, over = {}) {
  return (await retriever(fetchFn, over).run(args, undefined)) as TrailResult;
}

// ---------------------------------------------------------------------------
// the wire shape — measured, and pinned so it cannot drift again
// ---------------------------------------------------------------------------

describe("the request is the one sanne measured against the live engine", () => {
  it("POSTs to /api/v1/knowledge-bases/<kb>/retrieve with a bearer token", async () => {
    const { fn, calls } = fakeFetch(() => ok(MEASURED_RESPONSE));
    await lookup(fn);
    expect(calls[0]!.url).toBe(`${BASE}/api/v1/knowledge-bases/${KB}/retrieve`);
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      query: "må en vikar bruge det?",
      audience: "tool",
      maxChars: 4000,
      topK: 8,
    });
  });

  it("CONTRACT: reads a response carrying every measured key, and keeps title + path", async () => {
    // The fixture really does carry what was measured — otherwise this test
    // proves nothing about the live shape.
    expect(Object.keys(MEASURED_RESPONSE).sort()).toEqual([...TOP_LEVEL_KEYS].sort());
    expect(Object.keys(MEASURED_RESPONSE.chunks[0]!).sort()).toEqual([...CHUNK_KEYS].sort());

    const { fn } = fakeFetch(() => ok(MEASURED_RESPONSE));
    const result = await lookup(fn);
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.passages).toHaveLength(2);
    expect(result.passages[0]).toEqual({
      title: "Deltid og vikarer",
      path: "/ordning/adgang",
      breadcrumb: "Ordningen › Adgang",
      content: "En medarbejder på deltid er omfattet af ordningen.",
    });
  });

  it("an UNKNOWN extra key does not break it — sanne's type missed two that were live", async () => {
    const { fn } = fakeFetch(() => ok({ ...MEASURED_RESPONSE, somethingAddedLater: { a: 1 } }));
    expect((await lookup(fn)).status).toBe("hit");
  });

  it("falls back to formattedContext when chunks is absent, rather than reporting an empty KB", async () => {
    const { fn } = fakeFetch(() => ok({ formattedContext: "noget viden", totalChars: 12, hitCount: 1 }));
    const result = await lookup(fn);
    expect(result.status).toBe("hit");
    if (result.status === "hit") expect(result.passages[0]!.content).toBe("noget viden");
  });
});

// ---------------------------------------------------------------------------
// THREE OUTCOMES, NEVER TWO
// ---------------------------------------------------------------------------

describe("found · nothing found · COULD NOT ASK are three different values", () => {
  it("hitCount 0 is `empty`, and says the KB was searched", async () => {
    const { fn } = fakeFetch(() => ok({ chunks: [], formattedContext: "", totalChars: 0, hitCount: 0, images: [] }));
    const result = await lookup(fn);
    expect(result.status).toBe("empty");
    if (result.status === "empty") expect(result.note).toMatch(/searched/i);
  });

  it.each([
    ["a timeout", () => { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; }, "timeout"],
    ["a refused connection", () => { throw new TypeError("fetch failed"); }, "network"],
    ["a 404 on an unknown KB", () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 }), "http_error"],
    ["a 500", () => new Response("upstream exploded", { status: 500 }), "http_error"],
    ["a body that is not JSON", () => new Response("<html>gateway</html>", { status: 200 }), "bad_response"],
    ["a body that is not a Trail response", () => ok({ hello: "world" }), "bad_response"],
  ])("%s is `unavailable` (%#) with reason %s", async (_label, handler, reason) => {
    const { fn } = fakeFetch(handler as never);
    const result = await lookup(fn);
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.reason).toBe(reason);
  });

  it("401 and 403 get their OWN reason — the key is not always the problem", async () => {
    // MEASURED by trail on a live call tonight, and they fell into it while
    // answering us: the SAME key returns 200 on app.trailmem.com and 401
    // "Invalid or revoked API key" on engine.trailmem.com. The message blames
    // the key. Folded into a generic http_error, a consumer rotates a
    // credential that was never wrong.
    for (const status of [401, 403]) {
      const result = await lookup(fakeFetch(() => new Response('{"error":"Invalid or revoked API key"}', { status })).fn);
      expect(result.status).toBe("unavailable");
      if (result.status === "unavailable") expect(result.reason).toBe("unauthorized");
    }
    // and it is still distinct from an ordinary server failure
    const five = await lookup(fakeFetch(() => new Response("boom", { status: 500 })).fn);
    if (five.status === "unavailable") expect(five.reason).toBe("http_error");
  });

  it("`unavailable` carries NO passages field at all — errors never ride the content channel", async () => {
    const { fn } = fakeFetch(() => new Response("nope", { status: 503 }));
    const result = await lookup(fn);
    expect(result).not.toHaveProperty("passages");
    // and never the provider's own body, which a model would read as knowledge
    expect(JSON.stringify(result)).not.toContain("nope");
  });

  it("THE SANNE DEFECT: `unavailable` forbids answering from general knowledge; `empty` does not", async () => {
    // sanne's tool distinguishes four outcomes and their PROMPT merges them
    // again — one branch for "returns nothing OR fails", telling the model to
    // answer from its own general training knowledge and never to say it
    // cannot answer. So when Trail is down, a zone-therapy clinic answers
    // HEALTH questions from generic training knowledge in the practitioner's
    // voice. A prompt cannot merge two states it receives as different VALUES.
    const down = await lookup(fakeFetch(() => { throw new TypeError("fetch failed"); }).fn);
    const none = await lookup(fakeFetch(() => ok({ hitCount: 0, chunks: [] })).fn);

    expect(down.status).toBe("unavailable");
    expect(none.status).toBe("empty");
    if (down.status !== "unavailable" || none.status !== "empty") return;

    expect(down.note).toMatch(/could NOT BE REACHED/i);
    expect(down.note).toMatch(/do NOT answer from your own general knowledge/i);
    expect(down.note).toMatch(/not.*treat this as the knowledge base having no answer/i);
    expect(down.note).not.toBe(none.note);
    // and the empty one must not become a negative fact either
    expect(none.note).toMatch(/NOT the same as the answer being no/i);
  });

  it("a blank query never becomes a lookup at all", async () => {
    const { fn, calls } = fakeFetch(() => ok(MEASURED_RESPONSE));
    expect((await lookup(fn, { query: "   " })).status).toBe("empty");
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isolation: the knowledge base is configuration, never an argument
// ---------------------------------------------------------------------------

describe("a model cannot choose the knowledge base", () => {
  it("the schema the model sees has no kb, tenant or token field", () => {
    const tool = retriever(fakeFetch(() => ok(MEASURED_RESPONSE)).fn);
    const props = (tool.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(["query"]);
    expect(JSON.stringify(tool.parameters)).not.toMatch(/\b(kb|kbId|tenant|token|baseUrl)\b/);
  });

  it("a kb smuggled into the model's ARGUMENTS is ignored, not merged", async () => {
    const { fn, calls } = fakeFetch(() => ok(MEASURED_RESPONSE));
    await lookup(fn, { query: "hej", kbId: "en-anden-lejer", kb: "en-anden-lejer", tenant: "x" });
    expect(calls[0]!.url).toContain(`/knowledge-bases/${KB}/`);
    expect(calls[0]!.url).not.toContain("en-anden-lejer");
    expect(String(calls[0]!.init.body)).not.toContain("en-anden-lejer");
  });

  it("sends X-Trail-Tenant on the app route, and omits it when there is no tenant", async () => {
    // The app route (app.trailmem.com) is an admin proxy: it takes an APP key
    // plus this header, resolves the tenant and forwards with the tenant's own
    // bearer. Without the header the request cannot be resolved at all.
    const withTenant = fakeFetch(() => ok(MEASURED_RESPONSE));
    await lookup(withTenant.fn, { query: "q" }, { tenant: "fd-sundhed" });
    expect((withTenant.calls[0]!.init.headers as Record<string, string>)["x-trail-tenant"]).toBe("fd-sundhed");

    const without = fakeFetch(() => ok(MEASURED_RESPONSE));
    await lookup(without.fn);
    expect((without.calls[0]!.init.headers as Record<string, string>)["x-trail-tenant"]).toBeUndefined();
  });

  it("the tenant is CONFIGURATION too — the model cannot supply one", async () => {
    // An app key can be scoped to several tenants and X-Trail-Tenant chooses
    // between them, so a model-supplied tenant would be a model-supplied
    // TENANT SWITCH. trail's per-KB partner scope (their F205.1) is not built,
    // which makes this lock the real barrier rather than theirs.
    const { fn, calls } = fakeFetch(() => ok(MEASURED_RESPONSE));
    await lookup(fn, { query: "q", tenant: "en-anden-lejer" }, { tenant: "fd-sundhed" });
    expect((calls[0]!.init.headers as Record<string, string>)["x-trail-tenant"]).toBe("fd-sundhed");
    expect(String(calls[0]!.init.body)).not.toContain("en-anden-lejer");
  });

  it("refuses to build without a knowledge base", () => {
    expect(() => trailRetriever({ baseUrl: BASE, kbId: "", token: TOKEN, permission: "k.read" })).toThrow(/kbId/);
  });
});

// ---------------------------------------------------------------------------
// freshness — stated even though Trail does not report it
// ---------------------------------------------------------------------------

describe("freshness is explicit, including when it is unknown", () => {
  it.each([
    ["a hit", () => ok(MEASURED_RESPONSE)],
    ["an empty result", () => ok({ hitCount: 0, chunks: [] })],
  ])("%s says IN WORDS that no update date is known", async (_l, handler) => {
    // MEASURED by sanne across all 5 top-level and all 8 chunk keys: Trail
    // reports no updatedAt/createdAt/version anywhere. So the field is present
    // and says so — a missing date must never be read as "current".
    const result = await lookup(fakeFetch(handler as never).fn);
    const freshness = (result as { freshness?: { known: boolean; note: string } }).freshness;
    expect(freshness?.known).toBe(false);
    expect(freshness?.note).toMatch(/may be out of date/i);
  });
});

// ---------------------------------------------------------------------------
// the ceiling, and what it dropped
// ---------------------------------------------------------------------------

describe("our own ceiling, on top of Trail's", () => {
  const many = {
    hitCount: 12,
    chunks: Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, content: "x".repeat(200), neuronPath: `/p/${i}` })),
  };

  it("caps the number of passages and REPORTS what it dropped", async () => {
    const result = await lookup(fakeFetch(() => ok(many)).fn, { query: "q" }, { maxPassages: 3 });
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.passages).toHaveLength(3);
    expect(result.truncated).toEqual({ droppedPassages: 9, reason: "max_passages" });
  });

  it("caps total size too — Trail's own maxChars is not our only defence", async () => {
    // sanne pass Trail's formattedContext through untouched and cap nothing,
    // so the day Trail stops honouring maxChars they have no ceiling at all.
    const result = await lookup(fakeFetch(() => ok(many)).fn, { query: "q" }, { maxTotalChars: 500 });
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.passages.length).toBeLessThan(12);
    expect(result.truncated?.reason).toBe("max_chars");
  });

  it("NEGATIVE CONTROL: a result inside both limits reports NO truncation", async () => {
    const result = await lookup(fakeFetch(() => ok(MEASURED_RESPONSE)).fn);
    if (result.status === "hit") expect(result.truncated).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// the whole loop, and the token
// ---------------------------------------------------------------------------

describe("driven through the core", () => {
  const model = (events: ModelEvent[][]): ModelFn => {
    let round = 0;
    return async function* () {
      for (const ev of events[Math.min(round++, events.length - 1)] ?? []) yield ev;
    };
  };

  async function runWith(fetchFn: typeof globalThis.fetch): Promise<ChatFrame[]> {
    const chat = createChat<undefined, { grants: string[] }>({
      model: model([
        [{ type: "tool-call", id: "1", name: "knowledge_lookup", args: { query: "må en vikar bruge det?" } }],
        [{ type: "text", text: "…" }],
      ]),
      tools: [retriever(fetchFn)],
      can: async (p, caller) => caller.grants.includes(p),
    });
    const frames: ChatFrame[] = [];
    for await (const f of chat.run({ messages: [{ role: "user", content: "hej" }], caller: { grants: ["knowledge.read"] }, ctx: undefined })) {
      frames.push(f);
    }
    return frames;
  }

  it("an unreachable Trail reaches the MODEL as 'could not look it up', not as an empty answer", async () => {
    const frames = await runWith(fakeFetch(() => { throw new TypeError("fetch failed"); }).fn);
    const result = frames.find((f) => f.type === "tool-result");
    expect(result).toBeTruthy();
    const payload = (result as { result: TrailResult }).result;
    expect(payload.status).toBe("unavailable");
    expect(frames.at(-1)).toEqual({ type: "done", reason: "complete" });
  });

  it("THE TOKEN IS ON NO FRAME — including the error path, the likeliest leak", async () => {
    for (const fetchFn of [
      fakeFetch(() => ok(MEASURED_RESPONSE)).fn,
      fakeFetch(() => { throw new TypeError("fetch failed"); }).fn,
      fakeFetch(() => new Response("boom", { status: 500 })).fn,
    ]) {
      const frames = await runWith(fetchFn);
      expect(JSON.stringify(frames)).not.toContain(TOKEN);
      expect(JSON.stringify(frames)).not.toContain("trail_");
    }
  });

  it("a caller without the permission is never offered the knowledge tool", async () => {
    const chat = createChat<undefined, { grants: string[] }>({
      model: model([[{ type: "text", text: "…" }]]),
      tools: [retriever(fakeFetch(() => ok(MEASURED_RESPONSE)).fn)],
      can: async (p, caller) => caller.grants.includes(p),
    });
    expect(await chat.toolsFor({ grants: [] })).toEqual([]);
    expect(await chat.toolsFor({ grants: ["knowledge.read"] })).toHaveLength(1);
  });
});
