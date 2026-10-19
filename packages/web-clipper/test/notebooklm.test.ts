// @vitest-environment happy-dom
// F099.22 — NotebookLM, read from the screen. Structure as measured 19/10 by Lens on the test account's
// notebook (jam docs/clipper-shapes/notebooklm-lens-chat.json, flow 1f9317df): chat-message pairs, the
// question in .from-user-container, the answer in .to-user-container as structural-element blocks, a
// collapsed thinking-chain-view first (not answer text), citation markers inline, action buttons beside.
import { describe, expect, it } from "vitest";
import { chatReaders, createNotebookLMReader, pickExtractor, articleExtractor } from "../src/extract";

const ID = "138c73fd-313e-4771-a3d0-8a5a2830620c";
const URL_ = new URL(`https://notebook.google.com/notebook/${ID}`);
const q = (t: string) => `<chat-message class="individual-message"><div class="from-user-container"><mat-card class="mat-mdc-card from-user-message-card-content"><mat-card-content class="from-user-message-inner-content message-content"><div class="message-text-content mat-body-medium"><div class="md3-body-text" role="heading" aria-level="3"><p>${t}</p></div></div></mat-card-content></mat-card></div></chat-message>`;
const para = (html: string) => `<labs-tailwind-structural-element-view-v2><paragraph-element-view><div class="paragraph normal" data-start-index="0">${html}</div></paragraph-element-view></labs-tailwind-structural-element-view-v2>`;
const a = (blocks: string) => `<chat-message class="individual-message"><div class="to-user-container"><mat-card class="mat-mdc-card to-user-message-card-content"><mat-card-content class="message-content to-user-message-inner-content"><div class="message-text-content mat-body-medium"><labs-tailwind-doc-viewer><element-list-renderer>
  <thinking-chain-view><div class="thinking-chain thinking-chain--collapsed"><button class="thinking-chain__header"><span class="thinking-chain__title">Tænker…</span></button></div></thinking-chain-view>
  ${blocks}</element-list-renderer></labs-tailwind-doc-viewer></div></mat-card-content>
  <mat-card-actions class="message-actions"><nb-button class="pin-button"><button><span>Gem i note</span></button></nb-button></mat-card-actions></mat-card></div></chat-message>`;

describe("F099.22 — NotebookLM reader (screen)", () => {
  it("one unit per turn in order; the answer from its blocks as markdown, thinking chain and buttons left out, citations as [n]; title from the cover; honest complete:false", async () => {
    document.title = "Untitled - NotebookLM";
    document.body.innerHTML = `<div class="chat-panel-header"><h2 class="cover-title">Budget 2027</h2><span class="cover-subtitle-source-count">2 kilder</span></div>
      <section class="chat-panel"><div class="chat-panel-content">
        <div class="chat-message-pair">${q("Hvad koster lønnen?")}${a(para(`<span data-start-index="0">Lønnen er </span><b data-start-index="1">den største post</b><span>.</span><button class="citation-marker">1</button>`) + para(`<span>Dernæst husleje.</span>`))}</div>
        <div class="chat-message-pair">${q("Tak")}${a(para(`<span>Selv tak.</span>`))}</div>
      </div></section>`;
    const clip = await createNotebookLMReader().extract(document, URL_);
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([
      ["user", "Hvad koster lønnen?"],
      ["assistant", "Lønnen er **den største post**.\\[1\\]\n\nDernæst husleje."],
      ["user", "Tak"],
      ["assistant", "Selv tak."],
    ]);
    expect(clip.title).toBe("Budget 2027");
    expect(clip.anchor).toBe(ID);
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom", missing: "turns" });
  });

  it("an answer without structural blocks (a block type the sample did not show) falls back to the whole answer — still without the thinking chain", async () => {
    document.body.innerHTML = `<section class="chat-panel"><div class="chat-message-pair">${q("Hej")}${a(`<p>Et svar uden blokke.</p>`)}</div></section>`;
    const clip = await createNotebookLMReader().extract(document, URL_);
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([["user", "Hej"], ["assistant", "Et svar uden blokke."]]);
  });

  it("chatReaders picks it on notebook.google.com AND notebooklm.google.com; NEGATIVE CONTROL: the notebook list is not a notebook", () => {
    expect(pickExtractor(URL_, chatReaders).id).toBe("notebooklm");
    expect(pickExtractor(new URL(`https://notebooklm.google.com/notebook/${ID}`), chatReaders).id).toBe("notebooklm");
    expect(pickExtractor(new URL("https://notebook.google.com/"), chatReaders)).toBe(articleExtractor);
  });

  it("NEGATIVE CONTROL: a notebook with no chat on screen is never a clip", async () => {
    document.body.innerHTML = `<section class="source-panel"><div class="single-source-container"><div class="source-title-column">kilde.pdf</div></div></section>`;
    await expect(createNotebookLMReader().extract(document, URL_)).rejects.toThrow(/nothing to clip/);
  });
});
