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

  it("a shared link is read from the screen and says so", async () => {
    const clip = await createChatgptReader({ fetch: fakeFetch({}).f }).extract(docWith(screenTail), new URL("https://chatgpt.com/share/6acd402d-cfb0-83eb-ab10-a9a538082b14"));
    expect(clip.completeness?.complete).toBe(false);
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
