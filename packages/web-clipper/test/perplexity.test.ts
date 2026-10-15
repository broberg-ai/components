// @vitest-environment happy-dom
// F099.22 — Perplexity, read from the screen. Structure as measured 15/10 on the owner's own
// logged-in thread (jam form extract): the question is [data-message-bubble] (with an aria-hidden
// span beside its text), the answer is [data-renderer] prose with citation spans.
import { describe, expect, it } from "vitest";
import { chatReaders, createPerplexityReader, pickExtractor, articleExtractor } from "../src/extract";

const turn = (q: string, a: string) => `
  <div class="group/partition flex flex-col" data-workflow-entry data-workflow-items-first>
    <div class="flex flex-col"><div><div class="contents"><div class="group/user-bubble flex">
      <div class="pointer-events-none"><span>18.02</span><button aria-label="Kopiér"></button></div>
      <div class="min-w-0 whitespace-pre-wrap" data-message-bubble="right"><div class="flex flex-col items-start"><div class="max-h-[144px] overflow-hidden"><div>${q}</div><span aria-hidden="true"></span></div></div></div>
    </div></div></div></div>
  </div>
  <div class="group/partition flex flex-col group/final-text mt-2" data-workflow-final-text data-workflow-items-first>
    <div data-workflow-items><div class="contents"><div class="break-words min-w-0 flex-1"><div>
      <div class="prose dark:prose-invert inline" data-renderer>${a}</div>
    </div></div></div></div>
  </div>`;
const URL_ = new URL("https://www.perplexity.ai/search/0e07f168-d660-4561-9cec-d9c559dd3678");

describe("F099.22 — Perplexity reader (screen)", () => {
  it("one unit per turn, in order; the answer as markdown; the bubble's time and buttons left out; anchor = thread slug; honest complete:false", async () => {
    document.title = "Bedste kaffe i Aalborg - Perplexity";
    document.body.innerHTML = `<main>${turn("Hvor er den bedste kaffe i Aalborg?", `<p>Prøv <strong>Café X</strong><span class="citation-nbsp"></span><span class="citation inline" data-pplx-citation data-pplx-citation-url="https://x.dk">x.dk</span></p><h2>Kort sagt</h2>`)}${turn("Og om søndagen?", "<p>Café Y.</p>")}</main>`;
    const clip = await createPerplexityReader().extract(document, URL_);
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([
      ["user", "Hvor er den bedste kaffe i Aalborg?"],
      ["assistant", "Prøv **Café X**x.dk\n\n## Kort sagt"],
      ["user", "Og om søndagen?"],
      ["assistant", "Café Y."],
    ]);
    expect(clip.anchor).toBe("0e07f168-d660-4561-9cec-d9c559dd3678");
    expect(clip.title).toBe("Bedste kaffe i Aalborg");
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom", missing: "turns" });
  });

  it("chatReaders picks it for a thread; NEGATIVE CONTROL: Perplexity's start page is not a thread", () => {
    expect(pickExtractor(URL_, chatReaders).id).toBe("perplexity");
    expect(pickExtractor(new URL("https://www.perplexity.ai/"), chatReaders)).toBe(articleExtractor);
  });

  it("NEGATIVE CONTROL: a changed page with no turn elements is never a clip", async () => {
    document.body.innerHTML = `<div><p>Hej</p></div>`;
    await expect(createPerplexityReader().extract(document, URL_)).rejects.toThrow(/nothing to clip/);
  });
});
