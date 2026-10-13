// @vitest-environment happy-dom
// F099.9 — chat readers: the WHOLE conversation from the page's own data, the
// thread on screen only, and an honest «incomplete» when only the screen could be read.
// The data answers below are FIXTURES in the shape the sites send; a real
// logged-in browser is the consumer's measurement (Lens cannot sign in for us).
import { describe, expect, it } from "vitest";
import { chatgptReader, claudeReader, createChatgptReader, createClaudeReader, extractClip, htmlToMarkdown, chatReaders, articleExtractor } from "../src/extract";
import { chatgptTurns, MAX_FILE_BYTES } from "../src/chat";

type Route = (url: string, init?: RequestInit) => unknown | Response;
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => url.startsWith(k)); // most specific first
    if (!key) return new Response("not found", { status: 404 });
    const out = routes[key]!(url, init);
    return out instanceof Response ? out : Response.json(out);
  }) as typeof fetch;
  return { f, calls };
}
const docWith = (html: string, title = "Samtale") => {
  document.title = title;
  document.body.innerHTML = html;
  return document;
};

// ── ChatGPT ──────────────────────────────────────────────────────────────────
/** A long thread (n user/assistant pairs) plus everything that must NOT come along. */
function chatgptData(pairs: number) {
  const mapping: Record<string, unknown> = { root: { id: "root", message: null, parent: null, children: ["sys"] } };
  const msg = (role: string, parts: unknown[], extra: Record<string, unknown> = {}) => ({ author: { role }, content: { content_type: "text", parts }, ...extra });
  mapping.sys = { id: "sys", parent: "root", message: msg("system", [""], { metadata: { is_visually_hidden_from_conversation: true } }) };
  let prev = "sys";
  for (let i = 0; i < pairs; i++) {
    const u = `u${i}`, a = `a${i}`;
    mapping[u] = { id: u, parent: prev, message: msg("user", [`Spørgsmål ${i}`]) };
    if (i === 2) {
      // a tool round-trip inside an answer: a call, the tool's output, then the words
      mapping[`call${i}`] = { id: `call${i}`, parent: u, message: { author: { role: "assistant" }, recipient: "web.search", content: { content_type: "code", text: "search(...)" } } };
      mapping[`tool${i}`] = { id: `tool${i}`, parent: `call${i}`, message: { author: { role: "tool" }, content: { content_type: "text", parts: ["SKJULT SØGERESULTAT"] } } };
      mapping[a] = { id: a, parent: `tool${i}`, message: msg("assistant", [`Svar ${i}`], { recipient: "all" }) };
    } else {
      mapping[a] = { id: a, parent: u, message: msg("assistant", [`Svar ${i} med **fed** tekst`], { recipient: "all" }) };
    }
    prev = a;
  }
  // a regenerated answer the user is NOT looking at
  mapping.alt = { id: "alt", parent: "u1", message: msg("assistant", ["FRAVALGT GREN"], { recipient: "all" }) };
  return { title: "Lang samtale", current_node: prev, mapping };
}
const CHATGPT_URL = new URL("https://chatgpt.com/c/6acd402d-cfb0-83eb-ab10-a9a538082b14");
const chatgptRoutes = (data: unknown): Record<string, Route> => ({
  "https://chatgpt.com/api/auth/session": () => ({ accessToken: "tok-1" }),
  "https://chatgpt.com/backend-api/conversation/": () => data,
});
// What the screen holds of a long thread: the last few messages only.
const screenTail = `<div data-message-author-role="user"><p>Spørgsmål 29</p></div><div data-message-author-role="assistant"><p>Svar 29</p></div>`;

describe("F099.9 — ChatGPT: the whole conversation", () => {
  it("60 turns from the data while the screen holds 2 — in order, the thread on screen only", async () => {
    const { f, calls } = fakeFetch(chatgptRoutes(chatgptData(30)));
    const clip = await createChatgptReader({ fetch: f }).extract(docWith(screenTail), CHATGPT_URL);
    expect(clip.units).toHaveLength(60);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
    expect(clip.anchor).toBe("6acd402d-cfb0-83eb-ab10-a9a538082b14");
    expect(clip.title).toBe("Lang samtale");
    expect(clip.units.slice(0, 4).map((u) => [u.role, u.content])).toStrictEqual([["user", "Spørgsmål 0"], ["assistant", "Svar 0 med **fed** tekst"], ["user", "Spørgsmål 1"], ["assistant", "Svar 1 med **fed** tekst"]]);
    expect(clip.units.map((u) => u.position)).toStrictEqual([...Array(60).keys()]);
    const all = clip.units.map((u) => u.content).join("\n");
    expect(all).not.toContain("FRAVALGT GREN");
    expect(all).not.toContain("SKJULT SØGERESULTAT");
    expect(all).not.toContain("search(");
    // the token from the session goes on the conversation request, nowhere else
    expect((calls[1]!.init!.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });

  it("deterministic: the same data gives byte-identical units (a reload is not a false branch)", async () => {
    const a = await createChatgptReader({ fetch: fakeFetch(chatgptRoutes(chatgptData(5))).f }).extract(docWith(""), CHATGPT_URL);
    const b = await createChatgptReader({ fetch: fakeFetch(chatgptRoutes(chatgptData(5))).f }).extract(docWith(""), CHATGPT_URL);
    expect(JSON.stringify(a.units)).toBe(JSON.stringify(b.units));
  });

  it("data refused (signed out) → the screen, marked INCOMPLETE with the reason", async () => {
    const { f } = fakeFetch({ "https://chatgpt.com/api/auth/session": () => ({}) });
    const clip = await createChatgptReader({ fetch: f }).extract(docWith(screenTail), CHATGPT_URL);
    expect(clip.units.map((u) => u.content)).toStrictEqual(["Spørgsmål 29", "Svar 29"]);
    expect(clip.completeness?.complete).toBe(false);
    expect(clip.completeness?.source).toBe("dom");
    expect(clip.completeness?.reason).toContain("not signed in to ChatGPT");
  });

  it("NEGATIVE CONTROL: a changed data shape is never read as complete", async () => {
    const changed = { title: "x", messages: [{ role: "user", text: "ny form" }] }; // no mapping/current_node
    const clip = await createChatgptReader({ fetch: fakeFetch(chatgptRoutes(changed)).f }).extract(docWith(screenTail), CHATGPT_URL);
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom" });
    expect(clip.completeness?.reason).toContain("unexpected conversation shape");
  });

  it("a missing node in the tree is a shape error, not a shorter «complete» clip", () => {
    const d = chatgptData(3) as { mapping: Record<string, { parent: string }> };
    d.mapping.a1!.parent = "gone";
    expect(() => chatgptTurns(d)).toThrow(/node gone is missing/);
  });

  it("a shared link WITHOUT embedded data is read from the screen and says so", async () => {
    const clip = await createChatgptReader({ fetch: fakeFetch({}).f }).extract(docWith(screenTail), new URL("https://chatgpt.com/share/6acd402d-cfb0-83eb-ab10-a9a538082b14"));
    expect(clip.completeness?.complete).toBe(false);
    expect(clip.completeness?.reason).toContain("the shared page answered 404");
    expect(clip.shareUrl).toBe("https://chatgpt.com/share/6acd402d-cfb0-83eb-ab10-a9a538082b14");
  });

  it("nothing on screen and no data → NothingToClipError (the popup shows the error)", async () => {
    await expect(createChatgptReader({ fetch: fakeFetch({}).f }).extract(docWith(""), CHATGPT_URL)).rejects.toThrow(/nothing to clip/);
  });
});

// ── Claude ───────────────────────────────────────────────────────────────────
const CLAUDE_URL = new URL("https://claude.ai/chat/11111111-2222-3333-4444-555555555555");
function claudeData() {
  const m = (uuid: string, sender: string, parent: string, content: unknown[]) => ({ uuid, sender, parent_message_uuid: parent, content });
  return {
    name: "Claude-samtale",
    current_leaf_message_uuid: "a2",
    chat_messages: [
      m("u1", "human", "00000000-0000-4000-8000-000000000000", [{ type: "text", text: "Hej Claude" }]),
      m("a1", "assistant", "u1", [{ type: "thinking", thinking: "TANKER" }, { type: "text", text: "Hej!" }]),
      m("u2", "human", "a1", [{ type: "text", text: "Søg noget" }]),
      m("a2x", "assistant", "u2", [{ type: "text", text: "FRAVALGT GREN" }]),
      m("a2", "assistant", "u2", [{ type: "tool_use", name: "web_search" }, { type: "tool_result", content: "SKJULT" }, { type: "text", text: "Her er svaret" }]),
    ],
  };
}
const claudeRoutes = (data: unknown, orgs: unknown = [{ uuid: "org-a" }]): Record<string, Route> => ({
  "https://claude.ai/api/organizations/org-a/chat_conversations/": () => data,
  "https://claude.ai/api/organizations": () => orgs,
});

describe("F099.9 — Claude: the whole conversation", () => {
  it("the thread to the current message, words only — no thinking, no tools, no other branch", async () => {
    const clip = await createClaudeReader({ fetch: fakeFetch(claudeRoutes(claudeData())).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([["user", "Hej Claude"], ["assistant", "Hej!"], ["user", "Søg noget"], ["assistant", "Her er svaret"]]);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
    expect(clip.anchor).toBe("11111111-2222-3333-4444-555555555555");
    expect(clip.title).toBe("Claude-samtale");
  });

  it("the org the user is in comes from the list when the cookie names none; a wrong org is skipped", async () => {
    const { f, calls } = fakeFetch({ ...claudeRoutes(claudeData(), [{ uuid: "org-x" }, { uuid: "org-a" }]), "https://claude.ai/api/organizations/org-x/": () => new Response("forbidden", { status: 403 }) });
    const clip = await createClaudeReader({ fetch: f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness?.complete).toBe(true);
    expect(calls.some((c) => c.url.includes("/org-x/"))).toBe(true);
  });

  it("NEGATIVE CONTROL: a changed shape falls back to the screen, marked incomplete", async () => {
    const screen = `<div data-testid="user-message"><p>Synligt spørgsmål</p></div><div class="font-claude-response"><p>Synligt svar</p></div>`;
    const clip = await createClaudeReader({ fetch: fakeFetch(claudeRoutes({ conversation: "ny form" })).f }).extract(docWith(screen), CLAUDE_URL);
    expect(clip.units.map((u) => u.content)).toStrictEqual(["Synligt spørgsmål", "Synligt svar"]);
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom" });
  });
});

describe("F099.9 — wiring", () => {
  it("chatReaders win on their sites; every other page still gets the article extractor", async () => {
    const { pickExtractor } = await import("../src/extract");
    expect(pickExtractor(CHATGPT_URL, chatReaders).id).toBe("chatgpt");
    expect(pickExtractor(CLAUDE_URL, chatReaders).id).toBe("claude");
    expect(pickExtractor(new URL("https://chatgpt.com/"), chatReaders)).toBe(articleExtractor); // no conversation in the URL
    expect(pickExtractor(new URL("https://example.com/x"), chatReaders)).toBe(articleExtractor);
    expect([chatgptReader.id, claudeReader.id]).toStrictEqual(["chatgpt", "claude"]);
    expect(typeof extractClip).toBe("function");
  });

  it("htmlToMarkdown is the article extractor's conversion, and deterministic", () => {
    const html = "<h2>Titel</h2><ul><li>en</li><li>to</li></ul><pre><code>x = 1</code></pre><style>p{color:red}</style>";
    expect(htmlToMarkdown(html)).toBe("## Titel\n\n-   en\n-   to\n\n```\nx = 1\n```");
    expect(htmlToMarkdown(html)).toBe(htmlToMarkdown(html));
  });
});

// ── 0.5.1: shared ChatGPT links carry the whole conversation in the page ─────
/** Encode a value the way React Router's turbo-stream does: one flat array, keys and values as indices. */
function turboEncode(root: unknown): string {
  const arr: unknown[] = [];
  const seen = new Map<unknown, number>();
  const enc = (v: unknown): number => {
    if (v === null) return -5;
    if (v === undefined) return -7;
    if (typeof v !== "object" && seen.has(v)) return seen.get(v)!;
    const i = arr.length;
    arr.push(null);
    if (typeof v !== "object") { seen.set(v, i); arr[i] = v; return i; }
    if (Array.isArray(v)) { arr[i] = v.map(enc); return i; }
    const o: Record<string, number> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[`_${enc(k)}`] = enc(x);
    arr[i] = o;
    return i;
  };
  enc(root);
  return JSON.stringify(arr) + "\n";
}
function sharePage(data: unknown): string {
  const root = { loaderData: { root: { theme: "dark" }, "routes/share.$shareId.($action)": { sharedConversationId: "x", serverResponse: { type: "data", data } } }, actionData: null, errors: null };
  // A promise chunk FIRST: the reader must skip it, not choke on it.
  return `<div data-message-author-role="user"><p>kun det sidste</p></div>
<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify("P99:[{}]\n")});</script>
<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(turboEncode(root))});</script>`;
}
const SHARE_URL = new URL("https://chatgpt.com/share/6acd402d-cfb0-83eb-ab10-a9a538082b14");

describe("F099.9 / 0.5.1 — a shared ChatGPT link (jam 13/10: «delingslinks er HELT døde»)", () => {
  it("the whole conversation from the page's own data — no login, complete:true, the screen ignored", async () => {
    const { f, calls } = fakeFetch({});
    const clip = await createChatgptReader({ fetch: f }).extract(docWith(sharePage(chatgptData(20))), SHARE_URL);
    expect(clip.units).toHaveLength(40);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
    expect(clip.units[0]).toStrictEqual({ kind: "turn", role: "user", content: "Spørgsmål 0", position: 0 });
    expect(clip.units.map((u) => u.content).join("\n")).not.toMatch(/FRAVALGT|SKJULT|search\(/);
    expect(clip.anchor).toBe("6acd402d-cfb0-83eb-ab10-a9a538082b14");
    expect(clip.shareUrl).toBe(SHARE_URL.href);
    expect(calls).toStrictEqual([]); // nothing fetched: it is all in the page
  });

  it("decodeTurboStream round-trips nesting, shared values, null and undefined", async () => {
    const { decodeTurboStream } = await import("../src/chat");
    const v = { a: [1, "x", { b: null, c: undefined }], d: "x", e: true };
    expect(decodeTurboStream(turboEncode(v))).toStrictEqual(v);
  });

  it("NEGATIVE CONTROL: a page whose data is not a conversation is read from the screen, marked incomplete", async () => {
    const clip = await createChatgptReader({ fetch: fakeFetch({}).f }).extract(docWith(sharePage({ title: "x", messages: [] })), SHARE_URL);
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom" });
    expect(clip.units.map((u) => u.content)).toStrictEqual(["kun det sidste"]);
  });
});

describe("F099.9 / 0.5.2 — a shared link whose live page holds no data (a signed-in view drawn in the browser)", () => {
  it("fetches the signed-OUT copy of the same link (no cookies) and reads the whole conversation from it", async () => {
    const { f, calls } = fakeFetch({ [SHARE_URL.href]: () => new Response(sharePage(chatgptData(12)), { headers: { "content-type": "text/html" } }) });
    const clip = await createChatgptReader({ fetch: f }).extract(docWith("<main>tegnet i browseren</main>"), SHARE_URL);
    expect(clip.units).toHaveLength(24);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.credentials).toBe("omit");
  });
  it("NEGATIVE CONTROL: the fetched copy has no data either → the screen, marked incomplete", async () => {
    const { f } = fakeFetch({ [SHARE_URL.href]: () => new Response("<html>ingen data</html>") });
    const clip = await createChatgptReader({ fetch: f }).extract(docWith(screenTail), SHARE_URL);
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom" });
  });
});

// ── F099.10: Claude artifacts as FILES ───────────────────────────────────────
function claudeArtifactData(extra: unknown[] = []) {
  const m = (uuid: string, sender: string, parent: string, content: unknown[]) => ({ uuid, sender, parent_message_uuid: parent, content });
  const art = (input: Record<string, unknown>) => ({ type: "tool_use", name: "artifacts", input });
  return {
    name: "KAI",
    current_leaf_message_uuid: extra.length ? "a4" : "a3",
    chat_messages: [
      m("u1", "human", "00000000-0000-4000-8000-000000000000", [{ type: "text", text: "Lav en plan" }]),
      m("a1", "assistant", "u1", [{ type: "text", text: "Her er planen:" }, art({ id: "plan", command: "create", type: "text/markdown", title: "Markedsplan", content: "# Plan\n\n- trin 1" })]),
      m("u2", "human", "a1", [{ type: "text", text: "Tilføj trin 2" }]),
      // a turn that is ONLY an artifact change — 0.5.2 dropped these (74 of 79)
      m("a2", "assistant", "u2", [art({ id: "plan", command: "update", old_str: "- trin 1", new_str: "- trin 1\n- trin 2" })]),
      m("u3", "human", "a2", [{ type: "text", text: "Og noget kode" }]),
      m("a3", "assistant", "u3", [{ type: "tool_use", name: "create_file", input: { path: "/mnt/user-data/outputs/app.ts", file_text: "export const x = 1;\n" } }, { type: "text", text: "Filen er lavet." }]),
      ...extra,
    ],
  };
}

describe("F099.10 — Claude artifacts come along as files, and nothing is silently skipped", () => {
  it("every artifact operation is a file on its turn, AS OF that turn; artifact-only turns are kept", async () => {
    const clip = await createClaudeReader({ fetch: fakeFetch(claudeRoutes(claudeArtifactData())).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([
      ["user", "Lav en plan"],
      ["assistant", "Her er planen:\n\n[Artefakt: Markedsplan]"],
      ["user", "Tilføj trin 2"],
      ["assistant", "[Artefakt: Markedsplan]"],
      ["user", "Og noget kode"],
      ["assistant", "[Artefakt: app.ts]\n\nFilen er lavet."],
    ]);
    expect(clip.units[1]!.assets).toStrictEqual([{ type: "file", id: "plan", name: "Markedsplan", mime: "text/markdown", content: "# Plan\n\n- trin 1", version: 1 }]);
    expect(clip.units[3]!.assets).toStrictEqual([{ type: "file", id: "plan", name: "Markedsplan", mime: "text/markdown", content: "# Plan\n\n- trin 1\n- trin 2", version: 2 }]);
    expect(clip.units[5]!.assets).toStrictEqual([{ type: "file", id: "/mnt/user-data/outputs/app.ts", name: "app.ts", mime: "text/typescript", content: "export const x = 1;\n", version: 1 }]);
  });

  it("a change that cannot be applied → complete:false with the reason (never a silent «complete»)", async () => {
    const bad = { uuid: "a4", sender: "assistant", parent_message_uuid: "a3", content: [{ type: "tool_use", name: "artifacts", input: { id: "plan", command: "update", old_str: "FINDES IKKE", new_str: "x" } }] };
    const clip = await createClaudeReader({ fetch: fakeFetch(claudeRoutes(claudeArtifactData([bad]))).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness?.complete).toBe(false);
    expect(clip.completeness?.source).toBe("data");
    expect(clip.completeness?.reason).toContain("could not be applied");
  });

  it("an unknown kind of message part → complete:false, naming it", async () => {
    const odd = { uuid: "a4", sender: "assistant", parent_message_uuid: "a3", content: [{ type: "text", text: "se her" }, { type: "hologram", data: "?" }] };
    const clip = await createClaudeReader({ fetch: fakeFetch(claudeRoutes(claudeArtifactData([odd]))).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness).toMatchObject({ complete: false, source: "data" });
    expect(clip.completeness?.reason).toContain("«hologram»");
    // what WAS readable is still there (two assistant messages in a row are one turn)
    expect(clip.units.at(-1)!.content).toBe("[Artefakt: app.ts]\n\nFilen er lavet.\n\nse her");
  });
});

describe("F099.13 — a tool that may have made files is never skipped silently", () => {
  it("an unknown tool (a code tool) → complete:false, naming it; the turn's words stay", async () => {
    const code = { uuid: "a4", sender: "assistant", parent_message_uuid: "a3", content: [{ type: "tool_use", name: "render_video", input: { scene: 1 } }, { type: "tool_result", content: [] }, { type: "text", text: "Designmanualen er klar som DESIGN.md" }] };
    const clip = await createClaudeReader({ fetch: fakeFetch(claudeRoutes(claudeArtifactData([code]))).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness).toMatchObject({ complete: false, source: "data" });
    expect(clip.completeness?.reason).toContain("«render_video»");
    expect(clip.units.at(-1)!.content).toBe("[Artefakt: app.ts]\n\nFilen er lavet.\n\nDesignmanualen er klar som DESIGN.md");
  });

  it("NEGATIVE CONTROL: tools that only read or search (web_search, web_fetch, view) keep a clip complete", async () => {
    const reads = { uuid: "a4", sender: "assistant", parent_message_uuid: "a3", content: ["web_search", "web_fetch", "view"].map((name) => ({ type: "tool_use", name, input: {} })).concat([{ type: "text", text: "Fundet" } as never]) };
    const clip = await createClaudeReader({ fetch: fakeFetch(claudeRoutes(claudeArtifactData([reads]))).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
  });
});

describe("F099.13 / 0.7.2 — completeness says WHAT is missing (jam #3215)", () => {
  const msg = (content: unknown[]) => ({ uuid: "a4", sender: "assistant", parent_message_uuid: "a3", content });
  const read = async (extra: unknown[]) => (await createClaudeReader({ fetch: fakeFetch(claudeRoutes(claudeArtifactData(extra))).f }).extract(docWith(""), CLAUDE_URL)).completeness;

  it("turns whole, a file not → missing:\"files\" (unknown tool, and a change that cannot be applied)", async () => {
    expect((await read([msg([{ type: "tool_use", name: "render_video", input: {} }, { type: "text", text: "ok" }])]))?.missing).toBe("files");
    expect((await read([msg([{ type: "tool_use", name: "artifacts", input: { id: "plan", command: "update", old_str: "FINDES IKKE", new_str: "x" } }])]))?.missing).toBe("files");
  });

  it("a part that may hold words → missing:\"turns\", and it outranks a missing file", async () => {
    expect((await read([msg([{ type: "hologram" }])]))?.missing).toBe("turns");
    expect((await read([msg([{ type: "hologram" }, { type: "tool_use", name: "render_video", input: {} }])]))?.missing).toBe("turns");
  });

  it("read from the screen → missing:\"turns\"; NEGATIVE CONTROL: a complete clip carries no missing", async () => {
    const screen = await createClaudeReader({ fetch: fakeFetch({}).f }).extract(docWith('<div data-testid="user-message">Hej</div>'), CLAUDE_URL);
    expect(screen.completeness).toMatchObject({ complete: false, source: "dom", missing: "turns" });
    expect(await read([])).toStrictEqual({ complete: true, source: "data" });
  });
});

describe("F099.10 / 0.6.1 — what the person attached is not dropped", () => {
  it("a message that is only an attached file stays a turn (its text as a file); an uploaded image is named", async () => {
    const m = (uuid: string, sender: string, parent: string, content: unknown[], extra: Record<string, unknown> = {}) => ({ uuid, sender, parent_message_uuid: parent, content, ...extra });
    const data = {
      name: "Bilag", current_leaf_message_uuid: "a2",
      chat_messages: [
        m("u1", "human", "r", [{ type: "text", text: "Læs den her" }]),
        m("a1", "assistant", "u1", [{ type: "text", text: "Send den" }]),
        m("u2", "human", "a1", [], { attachments: [{ file_name: "brief.md", file_type: "text/markdown", extracted_content: "# Brief" }], files_v2: [{ file_uuid: "up-1", file_name: "skitse.png", file_kind: "image", preview_url: "/api/org-a/files/up-1/preview" }] }),
        m("a2", "assistant", "u2", [{ type: "text", text: "Tak" }]),
      ],
    };
    const routes = { ...claudeRoutes(data), "https://claude.ai/api/org-a/files/up-1/preview": () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }) };
    const clip = await createClaudeReader({ fetch: fakeFetch(routes).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([
      ["user", "Læs den her"], ["assistant", "Send den"], ["user", "[Bilag: brief.md]\n\n[Fil: skitse.png]"], ["assistant", "Tak"],
    ]);
    // F099.13: the upload itself comes along now (0.6.1 only named it)
    expect(clip.units[2]!.assets).toStrictEqual([
      { type: "file", name: "brief.md", mime: "text/markdown", content: "# Brief" },
      { type: "file", id: "up-1", name: "skitse.png", mime: "image/png", size: 4, encoding: "base64", content: "iVBORw==" },
    ]);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
  });
});

describe("F099.13 / 0.8.0 — the files themselves: Claude's Artifacts panel + uploads, ChatGPT's images + code files", () => {
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10]);
  const png = () => new Response(PNG, { headers: { "content-type": "image/png" } });
  const presented = (uuid: string, parent: string, files: { file_path: string; name: string; mime_type: string }[], text: string) => ({
    uuid, sender: "assistant", parent_message_uuid: parent,
    content: [
      { type: "tool_use", name: "bash_tool", input: { command: "make" } },
      { type: "tool_result", name: "bash_tool", content: [{ type: "text", text: "ok" }] },
      { type: "tool_use", name: "present_files", input: { filepaths: files.map((x) => x.file_path) } },
      { type: "tool_result", name: "present_files", is_error: false, content: files.map((x) => ({ type: "local_resource", artifact_publishable: true, ...x })) },
      { type: "text", text },
    ],
  });
  const kai = (extra: unknown[] = []) => ({
    name: "KAI", current_leaf_message_uuid: extra.length ? "a3" : "a2",
    chat_messages: [
      { uuid: "u1", sender: "human", parent_message_uuid: "r", content: [{ type: "text", text: "Lav logo og manual" }] },
      presented("a1", "u1", [{ file_path: "/mnt/user-data/outputs/kai-logo.png", name: "kai-logo.png", mime_type: "image/png" }, { file_path: "/mnt/user-data/outputs/DESIGN.md", name: "DESIGN.md", mime_type: "text/markdown" }], "Her er de."),
      { uuid: "u2", sender: "human", parent_message_uuid: "a1", content: [{ type: "text", text: "Ret manualen" }] },
      presented("a2", "u2", [{ file_path: "/mnt/user-data/outputs/DESIGN.md", name: "DESIGN.md", mime_type: "text/markdown" }], "Rettet."),
      ...extra,
    ],
  });
  const DL = "https://claude.ai/api/organizations/org-a/conversations/11111111-2222-3333-4444-555555555555/wiggle/download-file?path=";
  const claudeFiles = (data: unknown, over: Record<string, Route> = {}) => ({
    ...claudeRoutes(data),
    [DL + encodeURIComponent("/mnt/user-data/outputs/kai-logo.png")]: png,
    [DL + encodeURIComponent("/mnt/user-data/outputs/DESIGN.md")]: () => new Response("# Design v2", { headers: { "content-type": "text/markdown" } }),
    ...over,
  });

  it("Claude: every presented file is fetched with the page's session and carried — text as text, a PNG as base64; a file presented twice is fetched once, on its last turn", async () => {
    const { f, calls } = fakeFetch(claudeFiles(kai()));
    const clip = await createClaudeReader({ fetch: f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
    expect(clip.units.map((u) => u.content)).toStrictEqual([
      "Lav logo og manual", "[Fil: kai-logo.png]\n\n[Fil: DESIGN.md]\n\nHer er de.", "Ret manualen", "[Fil: DESIGN.md]\n\nRettet.",
    ]);
    expect(clip.units[1]!.assets).toStrictEqual([{ type: "file", id: "/mnt/user-data/outputs/kai-logo.png", name: "kai-logo.png", mime: "image/png", size: 6, encoding: "base64", content: "iVBORw0K" }]);
    expect(clip.units[3]!.assets).toStrictEqual([{ type: "file", id: "/mnt/user-data/outputs/DESIGN.md", name: "DESIGN.md", mime: "text/markdown", size: 11, content: "# Design v2" }]);
    const downloads = calls.filter((c) => c.url.startsWith(DL));
    expect(downloads.map((c) => c.url)).toStrictEqual([DL + encodeURIComponent("/mnt/user-data/outputs/kai-logo.png"), DL + encodeURIComponent("/mnt/user-data/outputs/DESIGN.md")]);
    expect(downloads.every((c) => c.init?.credentials === "include")).toBe(true);
  });

  it("Claude: a file that cannot be fetched → missing:\"files\" naming it; the turns stay whole", async () => {
    const clip = await createClaudeReader({ fetch: fakeFetch(claudeFiles(kai(), { [DL + encodeURIComponent("/mnt/user-data/outputs/kai-logo.png")]: () => new Response("no", { status: 404 }) })).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness).toMatchObject({ complete: false, source: "data", missing: "files" });
    expect(clip.completeness?.reason).toContain("«kai-logo.png» kunne ikke hentes (404)");
    expect(clip.units).toHaveLength(4);
    expect(clip.units[1]!.assets).toBeUndefined();
    expect(clip.units[3]!.assets).toHaveLength(1);
  });

  it("Claude: a file over the size limit is not carried — named, missing:\"files\"", async () => {
    const big = () => new Response(PNG, { headers: { "content-type": "video/mp4", "content-length": String(MAX_FILE_BYTES + 1) } });
    const clip = await createClaudeReader({ fetch: fakeFetch(claudeFiles(kai(), { [DL + encodeURIComponent("/mnt/user-data/outputs/kai-logo.png")]: big })).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness).toMatchObject({ complete: false, missing: "files" });
    expect(clip.completeness?.reason).toContain("«kai-logo.png» er 100 MB — over grænsen på 100 MB");
    expect(MAX_FILE_BYTES).toBe(100 * 1024 * 1024); // 0.8.3: raised from 25 MB (owner 13/10)
  });

  it("Claude: MCP tools and the code tool are not reported as missing files", async () => {
    const mcp = { uuid: "a3", sender: "assistant", parent_message_uuid: "a2", content: [{ type: "tool_use", name: "DNS Manager:simply_check", input: { domain: "kai.dk" } }, { type: "tool_use", name: "Claude Docs:create", input: {} }, { type: "text", text: "Ledig" }] };
    const clip = await createClaudeReader({ fetch: fakeFetch(claudeFiles(kai([mcp]))).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
  });

  const gptImageData = () => ({
    title: "Frugt", current_node: "t1",
    mapping: {
      root: { id: "root", parent: null, message: null },
      u1: { id: "u1", parent: "root", message: { id: "u1", author: { role: "user" }, content: { content_type: "text", parts: ["Tegn frugt og lav en CSV"] } } },
      c1: { id: "c1", parent: "u1", message: { id: "c1", author: { role: "assistant" }, recipient: "python", content: { content_type: "code", text: "df.to_csv()" } } },
      x1: { id: "x1", parent: "c1", message: { id: "x1", author: { role: "tool", name: "python" }, content: { content_type: "execution_output", text: "" } } },
      a1: { id: "a1", parent: "x1", message: { id: "a1", author: { role: "assistant" }, recipient: "all", content: { content_type: "text", parts: ["Her er [CSV'en](sandbox:/mnt/data/frugt_og_priser.csv)."] } } },
      t1: { id: "t1", parent: "a1", message: { id: "t1", author: { role: "tool", name: "t2uay3k.sj1i4kz" }, recipient: "t2uay3k.sj1i4kz", metadata: { image_gen_title: "Frugtkurv" }, content: { content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer", asset_pointer: "sediment://file_00000000bd88", width: 1024, height: 1024, size_bytes: 6, mime_type: "image/png", metadata: { generation: { serialization_title: "Image Generation metadata" } } }] } } },
    },
  });
  const gptFiles = (data: unknown): Record<string, Route> => ({
    ...chatgptRoutes(data),
    "https://chatgpt.com/backend-api/files/download/file_00000000bd88": () => ({ status: "success", download_url: "/backend-api/estuary/content?id=file_00000000bd88&sig=x" }),
    // measured 13/10 (jam, 0.8.0 → 403): the estuary address answers only with the login
    "https://chatgpt.com/backend-api/estuary/content": (_u, init) => ((init?.headers as Record<string, string> | undefined)?.authorization === "Bearer tok-1" ? png() : new Response("no", { status: 403 })),
    "https://chatgpt.com/backend-api/conversation/6acd402d-cfb0-83eb-ab10-a9a538082b14/interpreter/download?message_id=a1&sandbox_path=%2Fmnt%2Fdata%2Ffrugt_og_priser.csv": () => ({ download_url: "https://files.oaiusercontent.com/csv-1?sig=y" }),
    "https://files.oaiusercontent.com/img-1": png,
    "https://files.oaiusercontent.com/csv-1": () => new Response("frugt;pris\næble;3", { headers: { "content-type": "text/csv" } }),
  });

  it("ChatGPT: a generated image (on the image TOOL's message) and a code-tool file (sandbox link) come along, fetched via their download addresses with the bearer", async () => {
    const { f, calls } = fakeFetch(gptFiles(gptImageData()));
    const clip = await createChatgptReader({ fetch: f }).extract(docWith(""), CHATGPT_URL);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([
      ["user", "Tegn frugt og lav en CSV"],
      ["assistant", "Her er [CSV'en](sandbox:/mnt/data/frugt_og_priser.csv).\n\n[Billede: Frugtkurv.png]"],
    ]);
    expect(clip.units[1]!.assets).toStrictEqual([
      { type: "file", id: "/mnt/data/frugt_og_priser.csv", name: "frugt_og_priser.csv", mime: "text/csv", size: 18, content: "frugt;pris\næble;3" },
      { type: "file", id: "file_00000000bd88", name: "Frugtkurv.png", mime: "image/png", size: 6, encoding: "base64", content: "iVBORw0K" },
    ]);
    const meta = calls.filter((c) => c.url.includes("/files/download/") || c.url.includes("/interpreter/download") || c.url.includes("/estuary/content"));
    expect(meta).toHaveLength(3);
    expect(meta.every((c) => (c.init?.headers as Record<string, string>)?.authorization === "Bearer tok-1")).toBe(true);
    expect(calls.filter((c) => c.url.startsWith("https://files.oaiusercontent.com/")).every((c) => c.init?.credentials === "omit")).toBe(true);
  });

  it("NEGATIVE CONTROL: ChatGPT download refused → missing:\"files\"; a conversation with no files stays complete", async () => {
    const routes = { ...gptFiles(gptImageData()), "https://chatgpt.com/backend-api/files/download/file_00000000bd88": () => new Response("x", { status: 403 }) };
    const clip = await createChatgptReader({ fetch: fakeFetch(routes).f }).extract(docWith(""), CHATGPT_URL);
    expect(clip.completeness).toMatchObject({ complete: false, missing: "files" });
    expect(clip.completeness?.reason).toContain("«Frugtkurv.png» kunne ikke hentes (403)");
    // a network refusal (CORS) is named too, not a bare «Failed to fetch»
    const cors = { ...gptFiles(gptImageData()), "https://chatgpt.com/backend-api/estuary/content": () => { throw new TypeError("Failed to fetch"); } };
    const blocked = await createChatgptReader({ fetch: fakeFetch(cors).f }).extract(docWith(""), CHATGPT_URL);
    expect(blocked.completeness?.reason).toContain("«Frugtkurv.png» kunne ikke hentes (Failed to fetch)");
    const plain = await createChatgptReader({ fetch: fakeFetch(chatgptRoutes(chatgptData(3))).f }).extract(docWith(""), CHATGPT_URL);
    expect(plain.completeness).toStrictEqual({ complete: true, source: "data" });
  });
});

describe("F099.13 / 0.8.1 — jam's measurements on 0.8.0", () => {
  const DL = "https://claude.ai/api/organizations/org-a/conversations/11111111-2222-3333-4444-555555555555/wiggle/download-file?path=";
  it("Claude: present_files' INPUT is the full list — a file the result does not name is still fetched (KAI: 28 in the panel, ~15 came)", async () => {
    const paths = ["/mnt/user-data/outputs/kai-icon-32.png", "/mnt/user-data/outputs/kai-icon.svg", "/mnt/user-data/outputs/kai-logo.svg"];
    const data = {
      name: "KAI", current_leaf_message_uuid: "a1",
      chat_messages: [
        { uuid: "u1", sender: "human", parent_message_uuid: "r", content: [{ type: "text", text: "Ikoner" }] },
        { uuid: "a1", sender: "assistant", parent_message_uuid: "u1", content: [
          { type: "tool_use", name: "present_files", input: { filepaths: paths } },
          { type: "tool_result", name: "present_files", content: [{ type: "local_resource", file_path: paths[0], name: "kai-icon-32.png", mime_type: "image/png" }] },
          { type: "text", text: "Her." },
        ] },
      ],
    };
    const routes: Record<string, Route> = { ...claudeRoutes(data) };
    for (const p of paths) routes[DL + encodeURIComponent(p)] = () => new Response(p.endsWith(".svg") ? "<svg/>" : new Uint8Array([1]), { headers: { "content-type": "application/octet-stream" } });
    const clip = await createClaudeReader({ fetch: fakeFetch(routes).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
    expect(clip.units[1]!.content).toBe("[Fil: kai-icon-32.png]\n\n[Fil: kai-icon.svg]\n\n[Fil: kai-logo.svg]\n\nHer.");
    // mime: the result's when it has one, else the extension (the server said octet-stream); an SVG is text
    expect(clip.units[1]!.assets!.map((a) => [a.name, a.mime, a.encoding ?? "text"])).toStrictEqual([
      ["kai-icon-32.png", "image/png", "base64"], ["kai-icon.svg", "image/svg+xml", "text"], ["kai-logo.svg", "image/svg+xml", "text"],
    ]);
  });

  it("every problem is named — none cut to the first three — and problems[] carries them one by one", async () => {
    const paths = ["a", "b", "c", "d"].map((x) => `/mnt/user-data/outputs/${x}.png`);
    const data = { name: "X", current_leaf_message_uuid: "a1", chat_messages: [
      { uuid: "u1", sender: "human", parent_message_uuid: "r", content: [{ type: "text", text: "?" }] },
      { uuid: "a1", sender: "assistant", parent_message_uuid: "u1", content: [{ type: "tool_use", name: "present_files", input: { filepaths: paths } }, { type: "text", text: "!" }] },
    ] };
    const clip = await createClaudeReader({ fetch: fakeFetch({ ...claudeRoutes(data), [DL]: () => new Response("no", { status: 404 }) }).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness?.problems).toStrictEqual(["a", "b", "c", "d"].map((x) => `«${x}.png» kunne ikke hentes (404)`));
    for (const x of ["a", "b", "c", "d"]) expect(clip.completeness?.reason).toContain(`«${x}.png»`);
    expect(clip.completeness?.missing).toBe("files");
  });
});

describe("F099.13 / 0.8.2 — missing files as DATA (owner 13/10: «send en fejlbesked til klienten»)", () => {
  const DL = "https://claude.ai/api/organizations/org-a/conversations/11111111-2222-3333-4444-555555555555/wiggle/download-file?path=";
  const conv = (assistant: unknown[], human: Record<string, unknown> = {}) => ({
    name: "X", current_leaf_message_uuid: "a1",
    chat_messages: [
      { uuid: "u1", sender: "human", parent_message_uuid: "r", content: [{ type: "text", text: "?" }], ...human },
      { uuid: "a1", sender: "assistant", parent_message_uuid: "u1", content: [...assistant, { type: "text", text: "!" }] },
    ],
  });
  const present = (...names: string[]) => ({ type: "tool_use", name: "present_files", input: { filepaths: names.map((n) => `/mnt/user-data/outputs/${n}`) } });

  it("every kind of missing file is named with its reason — http (status), network, too_large, no_url, unknown_tool, unapplied", async () => {
    const data = conv(
      [present("a.png", "b.png", "c.mp4"), { type: "tool_use", name: "render_video", input: {} }, { type: "tool_use", name: "artifacts", input: { id: "x", command: "update", old_str: "?", new_str: "!" } }],
      { files_v2: [{ file_uuid: "u-9", file_name: "logo.svg", file_kind: "file" }] },
    );
    const routes: Record<string, Route> = {
      ...claudeRoutes(data),
      [DL]: () => new Response("no", { status: 404 }),
      [DL + encodeURIComponent("/mnt/user-data/outputs/b.png")]: () => { throw new TypeError("Failed to fetch"); },
      [DL + encodeURIComponent("/mnt/user-data/outputs/c.mp4")]: () => new Response(new Uint8Array([1]), { headers: { "content-length": String(MAX_FILE_BYTES + 1) } }),
    };
    const clip = await createClaudeReader({ fetch: fakeFetch(routes).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness?.missing).toBe("files");
    expect(clip.completeness?.missingFiles).toStrictEqual([
      { name: "logo.svg", why: "no_url" },
      { name: "render_video", why: "unknown_tool", tool: "render_video" },
      { name: "x", why: "unapplied" },
      { name: "a.png", why: "http", status: 404 },
      { name: "b.png", why: "network" },
      { name: "c.mp4", why: "too_large" },
    ]);
    expect(clip.completeness?.problems).toHaveLength(6);
  });

  it("the clip's total budget used up → clip_limit (not too_large)", async () => {
    const big = new Uint8Array(900); // with the limits set small: 1000 per file, 2000 per clip
    const names = ["1.zip", "2.zip", "3.zip"];
    const routes: Record<string, Route> = { ...claudeRoutes(conv([present(...names)])) };
    for (const n of names) routes[DL + encodeURIComponent(`/mnt/user-data/outputs/${n}`)] = () => new Response(big, { headers: { "content-type": "application/zip" } });
    const clip = await createClaudeReader({ fetch: fakeFetch(routes).f, maxFileBytes: 1000, maxClipFileBytes: 2000 }).extract(docWith(""), CLAUDE_URL);
    expect(clip.units[1]!.assets).toHaveLength(2);
    expect(clip.completeness?.missingFiles).toStrictEqual([{ name: "3.zip", why: "clip_limit" }]);
  });

  it("NEGATIVE CONTROL: a complete clip has no missingFiles field at all", async () => {
    const routes = { ...claudeRoutes(conv([present("ok.md")])), [DL + encodeURIComponent("/mnt/user-data/outputs/ok.md")]: () => new Response("# ok", { headers: { "content-type": "text/markdown" } }) };
    const clip = await createClaudeReader({ fetch: fakeFetch(routes).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
  });
});

describe("F099.13 / 0.8.3 — the thread is the WHOLE thread (jam 13/10: KAI gave 51 of 76, «complete»)", () => {
  const msg = (uuid: string, sender: string, parent: string, text: string, t: number) => ({ uuid, sender, parent_message_uuid: parent, content: [{ type: "text", text }], created_at: new Date(Date.UTC(2026, 9, 13, 10, t)).toISOString() });
  const read = async (data: unknown) => createClaudeReader({ fetch: fakeFetch(claudeRoutes(data)).f }).extract(docWith(""), CLAUDE_URL);

  it("a current_leaf that has replies after it is followed to the real end — every turn, complete", async () => {
    const data = { name: "X", current_leaf_message_uuid: "a1", chat_messages: [
      msg("u1", "human", "r", "en", 1), msg("a1", "assistant", "u1", "to", 2), msg("u2", "human", "a1", "tre", 3), msg("a2", "assistant", "u2", "fire", 4),
    ] };
    const clip = await read(data);
    expect(clip.units.map((u) => u.content)).toStrictEqual(["en", "to", "tre", "fire"]);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
  });

  it("an older version on screen while a newer one exists → clipped as shown, but missing:\"turns\" says so", async () => {
    const data = { name: "X", current_leaf_message_uuid: "a2old", chat_messages: [
      msg("u1", "human", "r", "en", 1), msg("a1", "assistant", "u1", "to", 2),
      msg("u2old", "human", "a1", "gammel", 3), msg("a2old", "assistant", "u2old", "gammelt svar", 4),
      msg("u2new", "human", "a1", "ny", 5), msg("a2new", "assistant", "u2new", "nyt svar", 6),
    ] };
    const clip = await read(data);
    expect(clip.units.map((u) => u.content)).toStrictEqual(["en", "to", "gammel", "gammelt svar"]);
    expect(clip.completeness).toMatchObject({ complete: false, source: "data", missing: "turns" });
    expect(clip.completeness?.reason).toContain("nyere beskeder i en anden version");
  });

  it("NEGATIVE CONTROL: the newest version on screen, an older branch elsewhere → complete", async () => {
    const data = { name: "X", current_leaf_message_uuid: "a2new", chat_messages: [
      msg("u1", "human", "r", "en", 1), msg("a1", "assistant", "u1", "to", 2),
      msg("u2old", "human", "a1", "gammel", 3), msg("a2old", "assistant", "u2old", "gammelt svar", 4),
      msg("u2new", "human", "a1", "ny", 5), msg("a2new", "assistant", "u2new", "nyt svar", 6),
    ] };
    const clip = await read(data);
    expect(clip.units.map((u) => u.content)).toStrictEqual(["en", "to", "ny", "nyt svar"]);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
  });
});
