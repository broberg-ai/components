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

describe("F099.22 — Copilot reader (screen)", () => {
  it("one unit per turn; accessible headings, name, buttons and toolbars left out; answer as markdown; honest complete:false", async () => {
    document.title = "Budget 2027 | Microsoft 365 Copilot";
    document.body.innerHTML = `<div class="fai-CopilotChat">${user("Lav et budget for 2027")}${bot("<p>Her er et <em>udkast</em>.</p><ol><li>Løn</li></ol>")}</div>`;
    const clip = await createCopilotReader().extract(document, URL_);
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
    await expect(createCopilotReader().extract(document, URL_)).rejects.toThrow(/nothing to clip/);
  });
});
