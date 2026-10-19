// @vitest-environment happy-dom
// F099.22 — Le Chat (Mistral), read from the DATA. The fixture follows the shape measured 15/10 on
// the owner's own conversation (broberg-ai/jam docs/clipper-shapes/lechat.json, requestShapes[4]):
// GET /api/trpc/chat.byId,message.all,canva.all?batch&input → [chat, messages, canvases], each as
// result.data.json; messages {id, role, content, contentChunks[{type:text|tool_call|canva}], turn,
// version, versionCount, nextVersion, files}; canvases {id, type:"text/markdown", title, content,
// messageId, version}. Field NAMES and types are the sample's; the text is invented.
import { describe, expect, it } from "vitest";
import { chatReaders, createLeChatReader, pickExtractor, articleExtractor } from "../src/extract";

const ID = "a68249e6-af9a-4b99-a5ca-5da94ce632d5";
const URL_ = new URL(`https://chat.mistral.ai/work/${ID}`);
const msg = (o: Record<string, unknown>) => ({
  agentId: null, agentsApiAgentId: null, chatId: ID, createdById: "u-1", files: [], isAcceleratedAnswer: false, moderationCategory: null,
  reaction: "neutral", references: null, memories: null, followups: [], status: "active", generationStatus: "success", parentId: null,
  parentVersion: null, version: 0, nextVersion: null, prevVersion: null, versionCount: 1, visibility: "private", model: null, quotedContent: null,
  reviewComments: [], workflowExecution: null, createdAt: "2026-10-15T17:00:00.000Z", contentChunks: null, ...o,
});
const text = (t: string) => ({ type: "text", text: t, _context: { type: "reasoning", endTime: 1, contextId: "ctx-1", startTime: 0 } });
const tool = { id: "call_1", name: "web_search", turn: 1, type: "tool_call", isDone: true, endTime: 2, success: true, toolType: "web", startTime: 1, publicResult: "{}", isInterrupted: false, publicArguments: null, requiresConfirmation: false, publicMetadata: { display: {} } };
const conversation = (o: { items?: unknown[]; messages?: unknown; canvases?: unknown; nextCursor?: string | null } = {}) => [
  { result: { data: { json: { id: ID, title: "Budget 2027", userTitle: null, generatedTitle: "Budgetforslag for 2027", nextCursor: o.nextCursor ?? null, features: [], copies: [], integrations: [], items: o.items ?? [
    msg({ id: "m1", role: "user", content: "Lav et budget for 2027", turn: 0 }),
    msg({ id: "m2", role: "assistant", content: "", turn: 1, contentChunks: [tool, text("Her er et **udkast**.")] }),
    msg({ id: "m3", role: "user", content: "Gør det til et dokument", turn: 2 }),
    msg({ id: "m4", role: "assistant", content: "Jeg har lavet et canvas.", turn: 3, contentChunks: [text("Jeg har lavet et canvas."), { id: "c-1", type: "canva", version: 2 }] }),
  ] } } } },
  { result: { data: { json: o.messages ?? { items: [], nextCursor: null } } } },
  { result: { data: { json: o.canvases ?? [{ id: "c-1", identifier: "budget-2027-canvas", type: "text/markdown", turn: 3, order: 0, content: "# Budget 2027\n\n- Løn", files: null, role: "assistant", options: null, readonly: false, title: "Budget 2027", version: 2, status: "active", parentId: null, parentVersion: null, messageId: "m4", messageVersion: 0, chatId: ID, prevVersion: null, nextVersion: null, versionCount: 2, versionIndex: 1 }] } } },
];
const serve = (body: unknown, seen: string[] = []) => (async (u: unknown) => { seen.push(String(u)); return Response.json(body); }) as unknown as typeof fetch;

describe("F099.22 — Le Chat reader (data)", () => {
  it("asks the same tRPC batch the page does; one unit per turn in order, text from content or the text chunks (tool calls left out), the canvas as a file on its answer — complete", async () => {
    const seen: string[] = [];
    const clip = await createLeChatReader({ fetch: serve(conversation(), seen) }).extract(document, URL_);
    const u = new URL(seen[0]!);
    expect(u.origin + u.pathname).toBe("https://chat.mistral.ai/api/trpc/chat.byId,message.all,canva.all");
    expect(u.searchParams.get("batch")).toBe("1");
    expect(JSON.parse(u.searchParams.get("input")!)).toStrictEqual({ 0: { json: { id: ID } }, 1: { json: { chatId: ID } }, 2: { json: { chatId: ID } } });
    expect(clip.units.map((x) => [x.role, x.content])).toStrictEqual([
      ["user", "Lav et budget for 2027"],
      ["assistant", "Her er et **udkast**."],
      ["user", "Gør det til et dokument"],
      ["assistant", "Jeg har lavet et canvas."],
    ]);
    expect(clip.units[3]!.assets).toStrictEqual([{ type: "file", id: "c-1", name: "Budget 2027", mime: "text/markdown", content: "# Budget 2027\n\n- Løn", version: 2 }]);
    expect(clip.anchor).toBe(ID);
    expect(clip.title).toBe("Budget 2027");
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
  });

  it("an edited message: the latest version on the line, and the clip SAYS older versions were not clipped; a further page (nextCursor) and an attached file are named too", async () => {
    const items = [
      msg({ id: "m1", role: "user", content: "Første udgave", turn: 0, version: 0, nextVersion: 1, versionCount: 2 }),
      msg({ id: "m1", role: "user", content: "Anden udgave", turn: 0, version: 1, prevVersion: 0, versionCount: 2, files: [{ name: "bilag.pdf" }] }),
      msg({ id: "m2", role: "assistant", content: "Svar", turn: 1 }),
    ];
    const clip = await createLeChatReader({ fetch: serve(conversation({ items, nextCursor: "cur-2", canvases: [] })) }).extract(document, URL_);
    expect(clip.units.map((x) => x.content)).toStrictEqual(["Anden udgave", "Svar"]);
    expect(clip.completeness).toMatchObject({ complete: false, source: "data", missing: "turns" });
    const problems = (clip.completeness as { problems: string[] }).problems;
    expect(problems).toStrictEqual([
      "1 tidligere version af redigerede beskeder er ikke klippet",
      "Le Chat har flere beskeder end dem der blev hentet",
      "en vedhæftet fil i Le Chat (bilag.pdf) er ikke klippet",
    ]);
  });

  it("message.all may carry messages chat.byId lacks — each message once", async () => {
    const clip = await createLeChatReader({ fetch: serve(conversation({ items: [msg({ id: "m1", role: "user", content: "Hej", turn: 0 })], messages: { items: [msg({ id: "m1", role: "user", content: "Hej", turn: 0 }), msg({ id: "m2", role: "assistant", content: "Hej igen", turn: 1 })], nextCursor: null }, canvases: [] })) }).extract(document, URL_);
    expect(clip.units.map((x) => [x.role, x.content])).toStrictEqual([["user", "Hej"], ["assistant", "Hej igen"]]);
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
  });

  it("a message that is neither user nor assistant (system/tool) is not a turn", async () => {
    const items = [msg({ id: "m0", role: "system", content: "Du er en hjælpsom assistent", turn: 0 }), msg({ id: "m1", role: "user", content: "Hej", turn: 1 }), msg({ id: "m2", role: "assistant", content: "Hej igen", turn: 2 })];
    const clip = await createLeChatReader({ fetch: serve(conversation({ items, canvases: [] })) }).extract(document, URL_);
    expect(clip.units.map((x) => [x.role, x.content])).toStrictEqual([["user", "Hej"], ["assistant", "Hej igen"]]);
  });

  it("NEGATIVE CONTROL: ONE message without a role among good ones is never silently dropped from a «complete» clip", async () => {
    const items = [msg({ id: "m1", role: "user", content: "Hej", turn: 0 }), { id: "m2", content: "Et svar uden rolle", turn: 1 }];
    await expect(createLeChatReader({ fetch: serve(conversation({ items, canvases: [] })) }).extract(document, URL_)).rejects.toThrow();
  });

  it("when the data cannot be read, the error SAYS why (jam 19/10: a failed clip said only «nothing to clip»)", async () => {
    const failing = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    const err = await createLeChatReader({ fetch: failing }).extract(document, URL_).then(() => { throw new Error("expected a failure"); }, (e: unknown) => e as Error & { dataError?: string });
    expect(err.message).toMatch(/nothing to clip on https:\/\/chat\.mistral\.ai\/work\/.+ — the conversation data could not be read: .*answered 403/);
    expect(err.dataError).toMatch(/answered 403$/);
    const shape = await createLeChatReader({ fetch: serve(conversation({ items: [{ id: "m1", content: "Hej" }] })) }).extract(document, URL_).then(() => { throw new Error("expected a failure"); }, (e: unknown) => e as Error & { dataError?: string });
    expect(shape.dataError).toBe("a Le Chat message without id/role");
  });

  it("chatReaders picks it for /work/<id> and /chat/<id>; NEGATIVE CONTROL: Le Chat's start page is not a conversation", () => {
    expect(pickExtractor(URL_, chatReaders).id).toBe("lechat");
    expect(pickExtractor(new URL(`https://chat.mistral.ai/chat/${ID}`), chatReaders).id).toBe("lechat");
    expect(pickExtractor(new URL("https://chat.mistral.ai/chat"), chatReaders)).toBe(articleExtractor);
  });

  it("NEGATIVE CONTROL: a changed shape (messages without role, or not a batch) is never a clip — no complete:true on a guess", async () => {
    const noRole = conversation({ items: [{ id: "m1", content: "Hej" }] });
    await expect(createLeChatReader({ fetch: serve(noRole) }).extract(document, URL_)).rejects.toThrow();
    await expect(createLeChatReader({ fetch: serve({ items: [] }) }).extract(document, URL_)).rejects.toThrow();
    const failing = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    await expect(createLeChatReader({ fetch: failing }).extract(document, URL_)).rejects.toThrow();
  });
});
