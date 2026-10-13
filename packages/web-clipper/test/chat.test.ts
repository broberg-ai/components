// @vitest-environment happy-dom
// F099.9 — chat readers: the WHOLE conversation from the page's own data, the
// thread on screen only, and an honest «incomplete» when only the screen could be read.
// The data answers below are FIXTURES in the shape the sites send; a real
// logged-in browser is the consumer's measurement (Lens cannot sign in for us).
import { describe, expect, it } from "vitest";
import { chatgptReader, claudeReader, createChatgptReader, createClaudeReader, extractClip, htmlToMarkdown, chatReaders, articleExtractor } from "../src/extract";
import { chatgptTurns } from "../src/chat";

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

describe("F099.10 / 0.6.1 — what the person attached is not dropped", () => {
  it("a message that is only an attached file stays a turn (its text as a file); an uploaded image is named", async () => {
    const m = (uuid: string, sender: string, parent: string, content: unknown[], extra: Record<string, unknown> = {}) => ({ uuid, sender, parent_message_uuid: parent, content, ...extra });
    const data = {
      name: "Bilag", current_leaf_message_uuid: "a2",
      chat_messages: [
        m("u1", "human", "r", [{ type: "text", text: "Læs den her" }]),
        m("a1", "assistant", "u1", [{ type: "text", text: "Send den" }]),
        m("u2", "human", "a1", [], { attachments: [{ file_name: "brief.md", file_type: "text/markdown", extracted_content: "# Brief" }], files_v2: [{ file_name: "skitse.png", file_kind: "image" }] }),
        m("a2", "assistant", "u2", [{ type: "text", text: "Tak" }]),
      ],
    };
    const clip = await createClaudeReader({ fetch: fakeFetch(claudeRoutes(data)).f }).extract(docWith(""), CLAUDE_URL);
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([
      ["user", "Læs den her"], ["assistant", "Send den"], ["user", "[Bilag: brief.md]\n\n[Fil: skitse.png]"], ["assistant", "Tak"],
    ]);
    expect(clip.units[2]!.assets).toStrictEqual([{ type: "file", name: "brief.md", mime: "text/markdown", content: "# Brief" }]);
    expect(clip.completeness?.complete).toBe(true);
  });
});
