// F098.1 — the WebMCP lab is a measuring instrument, so what it records must be
// true: a page fetch is logged with the agent's class, a booking link lands on a
// prefilled confirmation that books nothing, and the JSON-LD names that same URL.
import { describe, expect, test } from "vitest";
import { agentClass, LAB_SERVICES, labJsonLd, webmcpLab } from "./webmcp-lab";

const AT = new Date("2026-10-07T13:00:00.000Z");
const lab = () => webmcpLab(() => AT);
const get = (l: ReturnType<typeof lab>, path: string, ua?: string) =>
  l.app.request(path, { headers: ua ? { "user-agent": ua } : {} });

describe("webmcp-lab (F098.1)", () => {
  test("the page carries JSON-LD whose ReserveAction points at the real booking route", async () => {
    const html = await (await get(lab(), "/")).text();
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]);
    expect(ld).toEqual(labJsonLd());
    expect(ld.potentialAction.target.urlTemplate).toBe(
      "https://discovery.broberg.ai/webmcp-lab/book?service={service}&date={date}&time={time}",
    );
    expect(ld.makesOffer.map((o: { identifier: string }) => o.identifier)).toEqual(LAB_SERVICES.map((s) => s.id));
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain("fiktiv");
  });

  test("the booking link lands on a PREFILLED confirmation that books nothing until pressed", async () => {
    const res = await get(lab(), "/book?service=konsultation&date=2026-10-20&time=10:00");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(/data-testid="lab-book-service">([^<]*)</.exec(html)![1]).toBe("Første konsultation");
    expect(/data-testid="lab-book-date">([^<]*)</.exec(html)![1]).toBe("2026-10-20");
    expect(/data-testid="lab-book-time">([^<]*)</.exec(html)![1]).toBe("10:00");
    expect(html).toContain('data-testid="lab-book-confirm"');
  });

  test("a booking link with a missing or unknown field is refused 400, never guessed", async () => {
    for (const q of ["service=massage&date=2026-10-20&time=10:00", "service=kort&date=20-10-2026&time=10:00", "service=kort&date=2026-10-20"]) {
      expect((await get(lab(), `/book?${q}`)).status).toBe(400);
    }
  });

  test("hits record WHICH agent fetched what — a class, never the raw user-agent", async () => {
    const l = lab();
    await get(l, "/", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)");
    await get(l, "/book?service=kort&date=2026-10-20&time=09:30", "Claude-User/1.0 (+Claude-User@anthropic.com)");
    const body = await (await get(l, "/hits")).json();
    expect(body.hits).toEqual([
      { at: AT.toISOString(), kind: "page", agent: "chatgpt-user" },
      { at: AT.toISOString(), kind: "book", agent: "claude-user", detail: "kort 2026-10-20 09:30" },
    ]);
    expect(JSON.stringify(body)).not.toContain("Mozilla");
  });

  test("a tool-call report is kept only for a known tool name", async () => {
    const l = lab();
    const post = (detail: unknown) => l.app.request("/hits", { method: "POST", body: JSON.stringify({ detail }) });
    expect((await post("start_booking")).status).toBe(204);
    expect((await post("<script>")).status).toBe(400);
    expect(l.hits.map((h) => [h.kind, h.detail])).toEqual([["tool", "start_booking"]]);
  });

  test("agent classes: the AI fetchers are told apart", () => {
    expect(agentClass("Claude-User/1.0")).toBe("claude-user");
    expect(agentClass("ChatGPT-User/1.0")).toBe("chatgpt-user");
    expect(agentClass("OAI-SearchBot/1.0")).toBe("oai-searchbot");
    expect(agentClass(undefined)).toBe("none");
  });
});
