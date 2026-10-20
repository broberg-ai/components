// @vitest-environment happy-dom
// F099.22 — Microsoft 365 Copilot, read from the screen. Structure as measured 15/10 on the owner's
// own conversation (copilot.cloud.microsoft, jam form extract): .fai-UserMessage / .fai-CopilotMessage
// (role=article), each with a visually-hidden accessible heading, the answer in __content.
import { describe, expect, it } from "vitest";
import { chatReaders, createCopilotReader, pickExtractor, articleExtractor } from "../src/extract";

const user = (t: string) => `<div data-message-index="0"><div class="fai-UserMessage fai-BebopUserMessage" role="article">
  <h5 class="fai-UserMessage__accessibleHeading">Du sagde:</h5>
  <button class="fai-UserMessage__actionBarAccessibleButton" aria-label="Handlinger"></button>
  <div class="fai-UserMessage__topContent"></div><div>${t}</div>
  <div role="toolbar"><button>Kopiér</button></div></div></div>`;
const bot = (html: string) => `<div data-message-index="1"><div class="fai-CopilotMessage" role="article">
  <div><h6 class="fai-CopilotMessage__accessibleHeading">Copilot sagde:</h6></div>
  <div class="fai-CopilotMessage__avatar"></div><div class="fai-CopilotMessage__name">Copilot</div>
  <div class="fai-CopilotMessage__content"><div><div>${html}</div></div></div>
  <div class="fai-CopilotMessage__actions" role="toolbar"><button>Kopiér</button></div></div></div>`;
const URL_ = new URL("https://copilot.cloud.microsoft/chat/conversation/58b8d0cc-e971-493e-a71e-c6147a491b94");
const offline = { fetch: (async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch };

describe("F099.22 — Copilot reader (screen)", () => {
  it("one unit per turn; accessible headings, name, buttons and toolbars left out; answer as markdown; honest complete:false", async () => {
    document.title = "Budget 2027 | Microsoft 365 Copilot";
    document.body.innerHTML = `<div class="fai-CopilotChat">${user("Lav et budget for 2027")}${bot("<p>Her er et <em>udkast</em>.</p><ol><li>Løn</li></ol>")}</div>`;
    const clip = await createCopilotReader(offline).extract(document, URL_);
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([
      ["user", "Lav et budget for 2027"],
      ["assistant", "Her er et _udkast_.\n\n1.  Løn"],
    ]);
    expect(clip.anchor).toBe("58b8d0cc-e971-493e-a71e-c6147a491b94");
    expect(clip.title).toBe("Budget 2027");
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom", missing: "turns" });
    expect(clip.units.map((u) => u.content).join("\n")).not.toMatch(/sagde:|Kopiér|Copilot$/);
  });

  it("chatReaders picks it for a conversation; NEGATIVE CONTROL: the Copilot start page is not a conversation", () => {
    expect(pickExtractor(URL_, chatReaders).id).toBe("copilot");
    expect(pickExtractor(new URL("https://copilot.cloud.microsoft/chat"), chatReaders)).toBe(articleExtractor);
  });

  it("NEGATIVE CONTROL: a changed page with no message elements is never a clip", async () => {
    document.body.innerHTML = `<div><p>Hej</p></div>`;
    await expect(createCopilotReader(offline).extract(document, URL_)).rejects.toThrow(/nothing to clip/);
  });
});

// F099.22 — Copilot from the DATA. Fixture follows the shape jam measured 20/10 on the owner's conversation
// (GET /chat/conversation/<id>?es=…, store.rawConversationResponse.messages): user, three bot progress
// steps WITH messageType, the bot answer WITHOUT one, user, answer, empty placeholder. The text is invented.
describe("F099.22 — Copilot reader (data)", () => {
  const msg = (author: string, text: string, extra: object = {}) => ({ author, text, createdAt: "2026-10-20T12:38:00.0000000+00:00", messageId: crypto.randomUUID(), turnCount: 1, ...extra });
  const step = (t: string) => msg("bot", t, { messageType: "Progress", contentType: "IMAGE_PREVIEW", addToChainOfThought: true, isPersisted: true });
  const body = (messages: unknown[]) => ({ __queryState: { mutations: [], queries: [] }, store: { chatType: "web", pageName: "chat", rawConversationResponse: { conversationId: "58b8d0cc-e971-493e-a71e-c6147a491b94", chatName: "Budget 2027", messages } } });
  const serve = (b: unknown, seen: { url: string; init?: RequestInit }[] = []) => ({ fetch: (async (u: unknown, init?: RequestInit) => { seen.push({ url: String(u), init }); return Response.json(b); }) as unknown as typeof fetch });

  it("GETs the page's own address as JSON with the cookie; user turns + the answers WITHOUT messageType, in order; thinking steps and the empty placeholder left out; title from chatName — complete", async () => {
    document.body.innerHTML = "";
    const seen: { url: string; init?: RequestInit }[] = [];
    const b = body([msg("user", "Lav et budget for 2027"), step("Søger i dine filer"), step("Læser Budget.xlsx"), step("Opsummerer"), msg("bot", "Her er et **udkast**."), msg("user", "Kortere?"), msg("bot", "Løn, husleje, drift."), msg("bot", "")]);
    const clip = await createCopilotReader(serve(b, seen)).extract(document, new URL(`${URL_.href}?es=SSR`));
    expect(seen[0]!.url).toBe(`${URL_.href}?es=SSR`);
    expect(seen[0]!.init).toMatchObject({ credentials: "include", headers: { accept: "application/json" } });
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([
      ["user", "Lav et budget for 2027"], ["assistant", "Her er et **udkast**."],
      ["user", "Kortere?"], ["assistant", "Løn, husleje, drift."],
    ]);
    expect(clip.title).toBe("Budget 2027");
    expect(clip.anchor).toBe("58b8d0cc-e971-493e-a71e-c6147a491b94");
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
  });

  it("no query string on the page → ?es is still asked for", async () => {
    document.body.innerHTML = "";
    const seen: { url: string; init?: RequestInit }[] = [];
    await createCopilotReader(serve(body([msg("user", "Hej"), msg("bot", "Hej igen")]), seen)).extract(document, URL_);
    expect(seen[0]!.url).toBe(`${URL_.href}?es`);
  });

  it("an author it does not know is NAMED — complete:false, missing turns", async () => {
    document.body.innerHTML = "";
    const clip = await createCopilotReader(serve(body([msg("user", "Hej"), msg("bot", "Hej igen"), msg("system", "x")]))).extract(document, URL_);
    expect(clip.completeness).toMatchObject({ complete: false, source: "data", missing: "turns" });
    expect((clip.completeness as { reason: string }).reason).toMatch(/fra «system»/);
  });

  it("NEGATIVE CONTROL: the page answers HTML (not the JSON) → the screen is read, marked so, with the reason", async () => {
    document.body.innerHTML = `<div class="fai-CopilotChat">${user("Lav et budget for 2027")}${bot("<p>Her er et udkast.</p>")}</div>`;
    const clip = await createCopilotReader(offline).extract(document, URL_);
    expect(clip.units.map((u) => u.role)).toStrictEqual(["user", "assistant"]);
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom", missing: "turns" });
    expect((clip.completeness as { reason: string }).reason.length).toBeGreaterThan(0);
  });

  it("NEGATIVE CONTROL: a changed shape (no rawConversationResponse) is never a complete clip", async () => {
    document.body.innerHTML = `<div class="fai-CopilotChat">${user("Hej")}${bot("<p>Hej igen</p>")}</div>`;
    const clip = await createCopilotReader(serve({ store: {} })).extract(document, URL_);
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom" });
    expect((clip.completeness as { reason: string }).reason).toMatch(/no rawConversationResponse/);
  });
});
