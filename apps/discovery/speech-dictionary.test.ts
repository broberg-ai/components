import { describe, expect, it } from "vitest";
import { applyDiff, bumpPatch, groupTerms, type CorrectionEntry, type TermEntry } from "./speech-dictionary";

const TERMS: TermEntry[] = [
  { term: "cardmem", group: "product" },
  { term: "WhisperKit", group: "tech" },
];
const CORRECTIONS: CorrectionEntry[] = [{ wrong: "kommitte", right: "committe", note: "git" }];

describe("groupTerms", () => {
  it("groups by product/person/brand/tech into the API's plural keys", () => {
    const g = groupTerms(TERMS);
    expect(g.products).toEqual(["cardmem"]);
    expect(g.tech).toEqual(["WhisperKit"]);
    expect(g.people).toEqual([]);
    expect(g.brands).toEqual([]);
  });
});

describe("bumpPatch", () => {
  it("increments the patch component", () => {
    expect(bumpPatch("0.1.0")).toBe("0.1.1");
    expect(bumpPatch("1.2.9")).toBe("1.2.10");
  });
});

describe("applyDiff", () => {
  it("adds a new term to its group", () => {
    const r = applyDiff(TERMS, CORRECTIONS, { addTerms: { brands: ["broberg.ai"] } });
    expect(r.changed).toBe(true);
    expect(r.terms.some((t) => t.term === "broberg.ai" && t.group === "brand")).toBe(true);
    expect(r.added.terms.brands).toEqual(["broberg.ai"]);
  });

  it("is idempotent — adding an existing term is a silent no-op, not a duplicate", () => {
    const r = applyDiff(TERMS, CORRECTIONS, { addTerms: { products: ["cardmem"] } });
    expect(r.changed).toBe(false);
    expect(r.terms.filter((t) => t.term === "cardmem").length).toBe(1);
    expect(r.added.terms.products).toEqual([]);
  });

  it("removes a term from its group", () => {
    const r = applyDiff(TERMS, CORRECTIONS, { removeTerms: { tech: ["WhisperKit"] } });
    expect(r.changed).toBe(true);
    expect(r.terms.some((t) => t.term === "WhisperKit")).toBe(false);
    expect(r.removed.terms.tech).toEqual(["WhisperKit"]);
  });

  it("removing a non-existent term is a silent no-op", () => {
    const r = applyDiff(TERMS, CORRECTIONS, { removeTerms: { tech: ["nonexistent"] } });
    expect(r.changed).toBe(false);
    expect(r.removed.terms.tech).toEqual([]);
  });

  it("adds a correction, rejects a duplicate wrong-key as a no-op", () => {
    const added = applyDiff(TERMS, CORRECTIONS, { addCorrections: [{ wrong: "søver", right: "server" }] });
    expect(added.changed).toBe(true);
    expect(added.corrections.some((c) => c.wrong === "søver")).toBe(true);

    const dup = applyDiff(TERMS, CORRECTIONS, { addCorrections: [{ wrong: "kommitte", right: "something-else" }] });
    expect(dup.changed).toBe(false);
    expect(dup.corrections.find((c) => c.wrong === "kommitte")?.right).toBe("committe"); // unchanged
  });

  it("removes a correction by wrong-key", () => {
    const r = applyDiff(TERMS, CORRECTIONS, { removeCorrections: ["kommitte"] });
    expect(r.changed).toBe(true);
    expect(r.corrections.some((c) => c.wrong === "kommitte")).toBe(false);
    expect(r.removed.corrections).toEqual(["kommitte"]);
  });

  it("an empty diff changes nothing", () => {
    const r = applyDiff(TERMS, CORRECTIONS, {});
    expect(r.changed).toBe(false);
    expect(r.terms).toEqual(TERMS);
    expect(r.corrections).toEqual(CORRECTIONS);
  });
});
