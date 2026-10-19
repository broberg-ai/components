// @vitest-environment happy-dom
// F099.22 — DeepSeek, read from the screen. Structure as measured 19/10 on the owner's own conversation
// (broberg-ai/jam docs/clipper-shapes/deepseek.json): a virtual list of .ds-message; the answer is
// .ds-markdown.ds-assistant-message-main-content, the question a .ds-message holding .ds-collapsible-text.
// Class names with hashes (d29f3d7d, fbb737a4) are copied from the sample but never relied on.
import { describe, expect, it } from "vitest";
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
