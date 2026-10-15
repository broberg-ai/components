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
