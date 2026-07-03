import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNotifier } from "../src/index";

const DISCORD = "https://discord.com/api/webhooks/123/abc";
const SLACK = "https://hooks.slack.com/services/T/B/xyz";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("createNotifier — registration + dark-ship", () => {
  it("registers only channels given a non-empty webhookUrl", () => {
    expect(createNotifier({ discord: { webhookUrl: DISCORD } }).channels).toEqual(["discord"]);
    expect(
      createNotifier({ discord: { webhookUrl: DISCORD }, slack: { webhookUrl: SLACK } }).channels,
    ).toEqual(["discord", "slack"]);
  });

  it("dark-ships a channel with an empty webhookUrl (unset env → \"\")", () => {
    expect(createNotifier({ discord: { webhookUrl: "" } }).channels).toEqual([]);
    expect(createNotifier({ discord: { webhookUrl: "" }, slack: { webhookUrl: SLACK } }).channels).toEqual([
      "slack",
    ]);
  });

  it("createNotifier({}) with zero channels: send() is a no-op returning [], never throws, never fetches", async () => {
    const n = createNotifier({});
    await expect(n.send({ text: "hi" })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a dark-shipped channel is never posted to", async () => {
    const n = createNotifier({ slack: { webhookUrl: "" } });
    expect(await n.send({ text: "hi" })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("send — payload mapping (one NotifyMessage → per-channel payload)", () => {
  it("maps Discord → { content } and Slack → { text } with title/url composed", async () => {
    const n = createNotifier({ discord: { webhookUrl: DISCORD }, slack: { webhookUrl: SLACK } });
    await n.send({ title: "Klar", text: "Dit opslag er klar", url: "https://x" });

    const calls = Object.fromEntries(fetchMock.mock.calls.map((c) => [c[0], c[1]]));
    expect(JSON.parse(calls[DISCORD].body)).toEqual({
      content: "**Klar**\nDit opslag er klar\nhttps://x",
    });
    expect(JSON.parse(calls[SLACK].body)).toEqual({
      text: "*Klar*\nDit opslag er klar\nhttps://x",
    });
    expect(calls[DISCORD].method).toBe("POST");
    expect(calls[DISCORD].headers["content-type"]).toBe("application/json");
  });

  it("composes a text-only message with no title/url", async () => {
    const n = createNotifier({ discord: { webhookUrl: DISCORD } });
    await n.send({ text: "bare tekst" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ content: "bare tekst" });
  });
});

describe("send — results + per-channel isolation", () => {
  it("returns ChannelResult[] with ok/status per channel on success", async () => {
    const n = createNotifier({ discord: { webhookUrl: DISCORD } });
    expect(await n.send({ text: "hi" })).toEqual([{ channel: "discord", ok: true, status: 204 }]);
  });

  it("non-2xx → ok:false with the status, no throw", async () => {
    fetchMock.mockImplementation(async () => new Response("bad", { status: 400 }));
    const n = createNotifier({ slack: { webhookUrl: SLACK } });
    expect(await n.send({ text: "hi" })).toEqual([{ channel: "slack", ok: false, status: 400 }]);
  });

  it("a thrown POST on one channel is isolated — the other channel still posts", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === DISCORD) throw new Error("network down");
      return new Response(null, { status: 200 });
    });
    const n = createNotifier({ discord: { webhookUrl: DISCORD }, slack: { webhookUrl: SLACK } });
    const byCh = Object.fromEntries((await n.send({ text: "hi" })).map((r) => [r.channel, r]));

    expect(byCh.discord.ok).toBe(false);
    expect(byCh.discord.error).toContain("network down");
    expect(byCh.slack.ok).toBe(true);
    expect(byCh.slack.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2); // slack posted despite discord throwing
  });
});
