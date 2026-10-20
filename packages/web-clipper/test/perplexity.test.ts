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
/** No data (the request is refused) → the screen reader. */
const offline = { fetch: (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch };

describe("F099.22 — Perplexity reader (screen)", () => {
  it("one unit per turn, in order; the answer as markdown; the bubble's time and buttons left out; anchor = thread slug; honest complete:false", async () => {
    document.title = "Bedste kaffe i Aalborg - Perplexity";
    document.body.innerHTML = `<main>${turn("Hvor er den bedste kaffe i Aalborg?", `<p>Prøv <strong>Café X</strong><span class="citation-nbsp"></span><span class="citation inline" data-pplx-citation data-pplx-citation-url="https://x.dk">x.dk</span></p><h2>Kort sagt</h2>`)}${turn("Og om søndagen?", "<p>Café Y.</p>")}</main>`;
    const clip = await createPerplexityReader(offline).extract(document, URL_);
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
    await expect(createPerplexityReader(offline).extract(document, URL_)).rejects.toThrow(/nothing to clip/);
  });
});

// F099.22 — Perplexity from the DATA. The fixture follows the shape in the owner's sample 19/10 (jam form
// extract of thread 0e07f168): /rest/thread entries with query_str, thread_title, blocks by intended_usage
// (ask_text → markdown_block.answer). Field names and types are the sample's; the text is invented.
describe("F099.22 — Perplexity reader (data)", () => {
  const block = (usage: string, extra: object) => ({ intended_usage: usage, ...extra });
  const entry = (q: string, a: string, at: string) => ({
    query_str: q, thread_title: "Bedste kaffe i Aalborg", thread_url_slug: "0e07f168-d660-4561-9cec-d9c559dd3678", uuid: `u-${at}`, entry_created_datetime: at, status: "COMPLETED",
    blocks: [
      block("plan", { plan_block: { final: true, goals: [], progress: "DONE" } }),
      block("ask_text_0_markdown", { markdown_block: { answer: "kun første stykke", chunks: ["kun første stykke"], chunk_starting_offset: 0, progress: "DONE" } }),
      block("ask_text", { markdown_block: { answer: a, chunks: [a], chunk_starting_offset: 0, progress: "DONE" } }),
      block("web_results", { web_result_block: { progress: "DONE", web_results: [] } }),
    ],
  });
  const serve = (body: unknown, seen: string[] = []) => ({ fetch: (async (u: unknown) => { seen.push(String(u)); return Response.json(body); }) as unknown as typeof fetch });

  it("asks /rest/thread/<slug>; one unit per turn in order (by entry_created_datetime); the answer is the ask_text markdown, not the first-chunk block; title from the thread — complete", async () => {
    document.body.innerHTML = "";
    const seen: string[] = [];
    const body = { status: "success", has_next_page: false, next_cursor: null, entries: [entry("Og om søndagen?", "Café **Y**.", "2026-10-15T18:03:00Z"), entry("Hvor er den bedste kaffe?", "Prøv **Café X**.", "2026-10-15T18:02:00Z")] };
    const clip = await createPerplexityReader(serve(body, seen)).extract(document, URL_);
    expect(new URL(seen[0]!).pathname).toBe("/rest/thread/0e07f168-d660-4561-9cec-d9c559dd3678");
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([
      ["user", "Hvor er den bedste kaffe?"], ["assistant", "Prøv **Café X**."],
      ["user", "Og om søndagen?"], ["assistant", "Café **Y**."],
    ]);
    expect(clip.title).toBe("Bedste kaffe i Aalborg");
    expect(clip.anchor).toBe("0e07f168-d660-4561-9cec-d9c559dd3678");
    expect(clip.completeness).toStrictEqual({ complete: true, source: "data" });
  });

  it("has_next_page → the clip SAYS there are more turns (complete:false, missing turns)", async () => {
    document.body.innerHTML = "";
    const clip = await createPerplexityReader(serve({ has_next_page: true, next_cursor: "c2", entries: [entry("Hej", "Hej igen", "2026-10-15T18:02:00Z")] })).extract(document, URL_);
    expect(clip.completeness).toMatchObject({ complete: false, source: "data", missing: "turns", problems: ["Perplexity har flere ture end dem der blev hentet"] });
  });

  it("NEGATIVE CONTROL: a changed shape (an entry without query_str) is never a complete clip — the screen is read instead, marked so", async () => {
    document.body.innerHTML = `<main>${turn("Hvor er den bedste kaffe i Aalborg?", "<p>Café X.</p>")}</main>`;
    const clip = await createPerplexityReader(serve({ entries: [{ blocks: [] }] })).extract(document, URL_);
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom", missing: "turns" });
    expect((clip.completeness as { reason: string }).reason).toMatch(/a thread entry without query_str\/blocks/);
  });

  // Lens 20/10, anonymous thread 2a3e44b1: blocks were plan / answer_tabs / pending_followups — no ask_text.
  it("NEGATIVE CONTROL: an entry whose answer is not an ask_text block never becomes a questions-only clip — the screen is read instead", async () => {
    document.body.innerHTML = `<main>${turn("Hvor er den bedste kaffe i Aalborg?", "<p>Café X.</p>")}</main>`;
    const e = { ...entry("Hvor er den bedste kaffe i Aalborg?", "ubrugt", "2026-10-15T18:02:00Z"), blocks: [block("plan", { plan_block: {} }), block("answer_tabs", { answer_tabs_block: {} }), block("pending_followups", { pending_followups_block: {} })] };
    const clip = await createPerplexityReader(serve({ has_next_page: false, entries: [e] })).extract(document, URL_);
    expect(clip.units.map((u) => [u.role, u.content])).toStrictEqual([["user", "Hvor er den bedste kaffe i Aalborg?"], ["assistant", "Café X."]]);
    expect(clip.completeness).toMatchObject({ complete: false, source: "dom", missing: "turns" });
    expect((clip.completeness as { reason: string }).reason).toMatch(/without an ask_text answer/);
  });
});
