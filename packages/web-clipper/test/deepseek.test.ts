// @vitest-environment happy-dom
// F099.22 — DeepSeek, read from the screen. Structure as measured 19/10 on the owner's own conversation
// (broberg-ai/jam docs/clipper-shapes/deepseek.json): a virtual list of .ds-message; the answer is
// .ds-markdown.ds-assistant-message-main-content, the question a .ds-message holding .ds-collapsible-text.
// Class names with hashes (d29f3d7d, fbb737a4) are copied from the sample but never relied on.
import { describe, expect, it, vi } from "vitest";
import { chatReaders, createDeepSeekReader, pickExtractor, articleExtractor } from "../src/extract";

const ID = "f6b312ab-1083-4426-a38d-3e0fe3b0af25";
const URL_ = new URL(`https://chat.deepseek.com/a/chat/s/${ID}`);
const buttons = `<div class="_11d6b3a"><div class="ds-flex"><div class="ds-button ds-button--icon" role="button"><div class="ds-button__background"></div><div class="ds-icon"><svg></svg></div></div></div></div>`;
const user = (t: string) => `<div class="_9663006" data-virtual-list-item-key="1"><div class="d29f3d7d ds-message _63c77b1"><div class="fbb737a4"><div class="ds-collapsible-text"><div><span>${t}</span></div></div></div></div>${buttons}</div>`;
const bot = (html: string) => `<div class="_4f9bf79" data-virtual-list-item-key="2"><div class="ds-message _63c77b1"><div class="ds-markdown ds-assistant-message-main-content">${html}</div></div><div class="ds-flex _0a3d93b">${buttons}</div></div>`;

describe("F099.22 — DeepSeek reader (screen)", () => {
  it("one unit per turn in order; the answer as markdown; buttons and icons left out; honest complete:false", async () => {
    document.title = "Budget 2027 - DeepSeek";
    document.body.innerHTML = `<div class="ds-virtual-list-items"><div class="ds-virtual-list-visible-items">${user("Lav et budget for 2027")}${bot('<p class="ds-markdown-paragraph"><span>Her er et </span><strong><span>udkast</span></strong></p><ol><li><p class="ds-markdown-paragraph">Løn</p></li></ol>')}${user("Tak")}</div></div>`;
    const clip = await createDeepSeekReader().extract(document, URL_);
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([
      ["user", "Lav et budget for 2027"],
      ["assistant", "Her er et **udkast**\n\n1.  Løn"],
      ["user", "Tak"],
    ]);
    expect(clip.anchor).toBe(ID);
    expect(clip.title).toBe("Budget 2027");
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom", missing: "turns" });
  });

  it("chatReaders picks it for a conversation; NEGATIVE CONTROL: DeepSeek's start page is not a conversation", () => {
    expect(pickExtractor(URL_, chatReaders).id).toBe("deepseek");
    expect(pickExtractor(new URL("https://chat.deepseek.com/"), chatReaders)).toBe(articleExtractor);
  });

  it("NEGATIVE CONTROL: a changed page with no .ds-message is never a clip", async () => {
    document.body.innerHTML = `<div class="chat"><p>Hej</p></div>`;
    await expect(createDeepSeekReader().extract(document, URL_)).rejects.toThrow(/nothing to clip/);
  });
});

// F099.22 — DeepSeek from the DATA. The fixture follows the shape measured 20/10 on the owner's conversation
// (jam form extract, third press): history_messages with DeepSeek's bearer token → biz_data.chat_session
// {title, current_message_id} + chat_messages[{message_id, parent_id, inserted_at, fragments[{type, content}]}].
describe("F099.22 — DeepSeek reader (data)", () => {
  const msg = (id: number, parent: number | null, type: "REQUEST" | "RESPONSE", content: string, extra: object[] = []) => ({
    message_id: id, parent_id: parent, inserted_at: 1_760_000_000 + id, role: type === "REQUEST" ? "USER" : "ASSISTANT", status: "FINISHED",
    accumulated_token_usage: 1, auto_continue: false, ban_edit: false, ban_regenerate: false, extra_search_providers: [], feedback: null,
    fragments: [...extra, { id: 1, type, content, ...(type === "RESPONSE" ? { references: [], stage_id: 1 } : {}) }],
    has_pending_fragment: false, incomplete_message: null, model: "", search_enabled: false, search_triggered: false, thinking_enabled: false,
  });
  const answer = (messages: object[], current: number, code = 0) => ({ code, msg: "", data: { biz_code: 0, biz_msg: "", biz_data: {
    cache_control: "NO_CACH", cache_reset_at: 0, chat_session: { id: ID, title: "Budget 2027", current_message_id: current, agent: "chat", is_empty: false, model_type: "default", pinned: false, seq_id: 1, title_type: "SYSTEM", updated_at: 1, inserted_at: 1, version: 1 },
    chat_messages: messages } } });
  const serve = (body: unknown, seen: { url: string; auth: string | null }[] = []) =>
    (async (u: unknown, init?: RequestInit) => { seen.push({ url: String(u), auth: new Headers(init?.headers).get("authorization") }); return Response.json(body); }) as unknown as typeof fetch;

  it("asks history_messages with ONLY chat_session_id and DeepSeek's own Bearer; the current line in order; an edited question is a branch; a thinking fragment is not text — complete", async () => {
    document.body.innerHTML = "";
    const seen: { url: string; auth: string | null }[] = [];
    const messages = [
      msg(1, null, "REQUEST", "Lav et budget"),
      msg(2, 1, "RESPONSE", "Her er et **udkast**.", [{ id: 0, type: "THINK", content: "tænker…" }]),
      msg(3, 2, "REQUEST", "Gør det billigere"),
      msg(4, 3, "RESPONSE", "Billigere udgave."),
      msg(5, 2, "REQUEST", "Gør det dyrere"),
      msg(6, 5, "RESPONSE", "Dyrere udgave."),
    ];
    const clip = await createDeepSeekReader({ fetch: serve(answer(messages, 4), seen), token: () => "tok-123" }).extract(document, URL_);
    expect(seen).toStrictEqual([{ url: `https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${ID}`, auth: "Bearer tok-123" }]);
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([
      ["user", "Lav et budget"], ["assistant", "Her er et **udkast**."], ["user", "Gør det billigere"], ["assistant", "Billigere udgave."],
    ]);
    expect(clip.branches!.map((b) => b.map((u) => u.content))).toStrictEqual([["Lav et budget", "Her er et **udkast**.", "Gør det dyrere", "Dyrere udgave."]]);
    expect(clip.title).toBe("Budget 2027");
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
  });

  it("the token is read from localStorage userToken ({value} JSON) when none is passed", async () => {
    document.body.innerHTML = "";
    // The test runtime's own localStorage is Node's stub, so the page's window is stood in for.
    const store = new Map([["userToken", JSON.stringify({ value: "from-storage", __version: "0" })]]);
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null } });
    try {
      const seen: { url: string; auth: string | null }[] = [];
      await createDeepSeekReader({ fetch: serve(answer([msg(1, null, "REQUEST", "Hej"), msg(2, 1, "RESPONSE", "Hej igen")], 2), seen) }).extract(document, URL_);
      expect(seen[0]!.auth).toBe("Bearer from-storage");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("NEGATIVE CONTROL: no token, or code ≠ 0 → never a data clip; the screen is read and the reason says why", async () => {
    document.body.innerHTML = `<div class="ds-virtual-list-visible-items">${user("Hej")}${bot("<p>Hej igen</p>")}</div>`;
    const noToken = await createDeepSeekReader({ fetch: serve(answer([], 1)), token: () => undefined }).extract(document, URL_);
    expect(noToken.completeness).toMatchObject({ complete: false, source: "dom" });
    expect((noToken.completeness as { reason: string }).reason).toMatch(/login token was not found/);
    const refused = await createDeepSeekReader({ fetch: serve(answer([msg(1, null, "REQUEST", "Hej")], 1, 40003)), token: () => "t" }).extract(document, URL_);
    expect((refused.completeness as { reason: string }).reason).toMatch(/did not answer the conversation/);
  });
});
