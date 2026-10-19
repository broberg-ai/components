// @vitest-environment happy-dom
// F099.22 — Gemini, read from the screen. Structure as measured 15/10 on a real page
// (broberg-ai/jam docs/clipper-shapes/gemini.json, Lens flow dc3bf0e1): the visually-hidden
// screen-reader labels sit INSIDE the turn elements and must not reach the turn text.
import { describe, expect, it } from "vitest";
import { chatReaders, createGeminiReader, pickExtractor, articleExtractor } from "../src/extract";

const turn = (q: string[], a: string) => `
  <div class="conversation-container message-actions-hover-boundary">
    <user-query><span class="user-query-container"><user-query-content><div class="user-query-container">
      <div class="file-preview-container"></div>
      <div class="query-content"><div class="query-bubble-with-status"><span class="user-query-bubble-with-background"><span class="horizontal-container">
        <div class="query-text gds-body-l"><h5 class="cdk-visually-hidden screen-reader-user-query-label"><span>Du sagde</span></h5>
          ${q.map((l) => `<p class="query-text-line">${l}</p>`).join("")}
        </div></span></span></div></div>
    </div></user-query-content></span></user-query>
    <model-response><div><response-container><div class="response-container"><div class="presented-response-container"><div class="response-container-content"><div class="response-content">
      <div class="model-response-label-announcer"><h6 class="cdk-visually-hidden screen-reader-model-response-label">Gemini sagde</h6></div>
      <model-response-content><structured-content-container class="model-response-text"><div class="container"><message-content>
        <div class="markdown markdown-main-panel">${a}</div>
      </message-content></div></structured-content-container></model-response-content>
    </div></div></div></div></response-container></div></model-response>
  </div>`;
const URL_ = new URL("https://gemini.google.com/app/3f2a9c1b8d7e6f50");

describe("F099.22 — Gemini reader (screen)", () => {
  it("one unit per turn, in order, user lines joined, answer as markdown; no screen-reader labels; anchor = conversation id; honest complete:false", async () => {
    document.title = "Rejseplan - Gemini";
    document.body.innerHTML = `<infinite-scroller class="chat-history">${turn(["Lav en rejseplan", "til Rom"], "<p>Her er <strong>planen</strong>:</p><ul><li>Dag 1</li></ul>")}${turn(["Tak!"], "<p>Selv tak.</p>")}</infinite-scroller>`;
    const clip = await createGeminiReader().extract(document, URL_);
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([
      ["user", "Lav en rejseplan\ntil Rom"],
      ["assistant", "Her er **planen**:\n\n-   Dag 1"],
      ["user", "Tak!"],
      ["assistant", "Selv tak."],
    ]);
    expect(clip.anchor).toBe("3f2a9c1b8d7e6f50");
    expect(clip.title).toBe("Rejseplan");
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom", missing: "turns" });
    expect(clip.units.map((u) => u.content).join("\n")).not.toMatch(/Du sagde|Gemini sagde/);
  });

  it("chatReaders picks it for a Gemini conversation; NEGATIVE CONTROL: Gemini's start page (no conversation id) is not a conversation", () => {
    expect(pickExtractor(URL_, chatReaders).id).toBe("gemini");
    expect(pickExtractor(new URL("https://gemini.google.com/u/1/app/3f2a9c1b8d7e6f50"), chatReaders).id).toBe("gemini");
    expect(pickExtractor(new URL("https://gemini.google.com/app"), chatReaders)).toBe(articleExtractor);
  });

  it("NEGATIVE CONTROL: a changed page with no turn elements is never a clip", async () => {
    document.body.innerHTML = `<div class="something-else"><p>Hej</p></div>`;
    await expect(createGeminiReader().extract(document, URL_)).rejects.toThrow(/nothing to clip/);
  });
});

// F099.22 — Gemini from the DATA. The answer follows the hNvQHb payload measured 20/10 on the owner's
// conversation (jam form extract, second press): payload[0] = per turn [ids, ids, [[question], …],
// [[[candidate_id, [answer], …]], …], [seconds, nanos]] — newest first. The REQUEST form is not measured.
describe("F099.22 — Gemini reader (data)", () => {
  const turnEntry = (q: string, a: string, secs: number) => [
    ["c_d717e19bd09855e2", `r_${secs}`], ["c_d717e19bd09855e2", `r_${secs}`, `rc_${secs}`],
    [[q], 1, null, 0, "fbb127bbb056c959", 0, 0],
    [[[`rc_${secs}`, [a], null, null, null, null, false, null, [1], "en", null, null]], null, null, `rc_${secs}`, null, null, null, null, "en", null, null, null],
    [secs, 0],
  ];
  const wire = (payload: unknown, rpc = "hNvQHb") => `)]}'\n\n123\n${JSON.stringify([["wrb.fr", rpc, JSON.stringify(payload), null, null, null, "generic"], ["di", 42], ["af.httprm", 41, "x", 1]])}\n25\n[["e",4,null,null,180]]\n`;
  const sessionPage = () => {
    document.documentElement.lang = "da";
    document.head.innerHTML = `<script>window.WIZ_global_data = {"SNlM0e":"AT-token:123","cfb2h":"boq_gemini-web-uiserver_20261016.00_p0","FdrFJe":"-1234567890123456789"};</script>`;
    document.body.innerHTML = "";
  };
  const serve = (text: string, seen: { url: string; init?: RequestInit }[] = []) => ({ fetch: (async (u: unknown, init?: RequestInit) => { seen.push({ url: String(u), init }); return new Response(text); }) as unknown as typeof fetch });

  it("POSTs hNvQHb with the page's own at/bl/f.sid and the conversation id; turns oldest first (the payload is newest first) — complete", async () => {
    sessionPage();
    document.title = "Budget 2027 - Gemini";
    const seen: { url: string; init?: RequestInit }[] = [];
    const payload = [[turnEntry("Og om søndagen?", "Café **Y**.", 1_760_000_200), turnEntry("Hvor er den bedste kaffe?", "Prøv **Café X**.", 1_760_000_100)], null, null, [[[], [], []]]];
    const clip = await createGeminiReader(serve(wire(payload), seen)).extract(document, URL_);
    const u = new URL(seen[0]!.url);
    expect(u.pathname).toBe("/_/BardChatUi/data/batchexecute");
    expect([u.searchParams.get("rpcids"), u.searchParams.get("bl"), u.searchParams.get("f.sid"), u.searchParams.get("hl"), u.searchParams.get("rt")]).toStrictEqual(["hNvQHb", "boq_gemini-web-uiserver_20261016.00_p0", "-1234567890123456789", "da", "c"]);
    const body = new URLSearchParams(String(seen[0]!.init!.body));
    expect(body.get("at")).toBe("AT-token:123");
    expect(JSON.parse(JSON.parse(body.get("f.req")!)[0][0][1])[0]).toBe(`c_${URL_.pathname.split("/").pop()}`);
    expect(seen[0]!.init!.credentials).toBe("include");
    expect(clip.units.map((x) => [x.role, x.content])).toStrictEqual([
      ["user", "Hvor er den bedste kaffe?"], ["assistant", "Prøv **Café X**."], ["user", "Og om søndagen?"], ["assistant", "Café **Y**."],
    ]);
    expect(clip.title).toBe("Budget 2027");
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
  });

  it("NEGATIVE CONTROLS: no session values on the page, an answer without hNvQHb, or a changed turn shape → never a data clip; the screen is read and the reason says why", async () => {
    document.head.innerHTML = "";
    document.body.innerHTML = `<user-query><div class="query-text"><p class="query-text-line">Hej</p></div></user-query><model-response><message-content><div class="markdown"><p>Hej igen</p></div></message-content></model-response>`;
    const noSession = await createGeminiReader(serve("")).extract(document, URL_);
    expect((noSession.completeness as { reason: string }).reason).toMatch(/session values .* were not found/);
    const bodyHtml = document.body.innerHTML;
    sessionPage(); document.body.innerHTML = bodyHtml;
    const other = await createGeminiReader(serve(wire([[]], "MaZiqc"))).extract(document, URL_);
    expect((other.completeness as { reason: string }).reason).toMatch(/holds no hNvQHb payload/);
    const changed = await createGeminiReader(serve(wire([[[["c", "r"], null, [["kun spørgsmål"]], null, [1, 0]]]]))).extract(document, URL_);
    expect((changed.completeness as { reason: string }).reason).toMatch(/without question\/answer text/);
    expect(changed.completeness).toMatchObject({ complete: false, source: "dom" });
  });
});
