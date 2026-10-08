import { describe, expect, it } from "vitest";

// authenticateEditor's TOFU store is a lazy singleton reading env at first use.
process.env.ENROLL_DB_URL = ":memory:";

import { applyDiff, authenticateEditor, bumpPatch, countEditors, groupTerms, registerEditor, type CorrectionEntry, type TermEntry } from "./speech-dictionary";

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

describe("authenticateEditor — only registered sessions (F044.3)", () => {
  const KEY = "a".repeat(32);

  it("rejects a key shorter than 32 chars", async () => {
    const r = await authenticateEditor("test-session-short", "tooshort");
    expect(r.ok).toBe(false);
  });

  it("rejects a missing session name", async () => {
    const r = await authenticateEditor("", KEY);
    expect(r.ok).toBe(false);
  });

  it("an UNKNOWN session is refused and NOTHING is bound — the hole that let anyone publish", async () => {
    const before = await countEditors();
    const session = "stranger-" + Math.random();
    const first = await authenticateEditor(session, KEY);
    expect(first.ok).toBe(false);
    expect(first.ok ? "" : first.error).toMatch(/^session_not_registered/);
    expect(await countEditors()).toBe(before);
    // and a second try with the same key is still refused: no silent bind happened
    expect((await authenticateEditor(session, KEY)).ok).toBe(false);
  });

  it("a registered session with its key is accepted; a different key is refused", async () => {
    const session = "editor-" + Math.random();
    await registerEditor(session, KEY);
    expect(await authenticateEditor(session, KEY)).toEqual({ ok: true, status: "matched" });
    expect((await authenticateEditor(session, "b".repeat(32))).ok).toBe(false);
  });

  it("registering again cannot replace an editor's key", async () => {
    const session = "editor-" + Math.random();
    await registerEditor(session, KEY);
    await registerEditor(session, "c".repeat(32));
    expect((await authenticateEditor(session, "c".repeat(32))).ok).toBe(false);
    expect((await authenticateEditor(session, KEY)).ok).toBe(true);
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
