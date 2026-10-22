// F019.10 — list missing keys; fill ONLY them with an LLM; placeholders byte
// for byte; existing keys never touched; EU route, no fallback.
import { describe, expect, it, vi } from "vitest";
import { missingKeys, type Dict } from "../src/index.js";
import { EU_ROUTE, fillMissing, placeholders } from "../src/llm.js";

const da: Dict = {
  title: "Dokumenter",
  hello: "Hej {name}, du har {n} nye",
  nav: { home: "Hjem", settings: "Indstillinger" },
  docs: { one: "{count} dokument", other: "{count} dokumenter" },
};
const en: Dict = { title: "Documents (hand-edited)", nav: { home: "Home" } };

describe("missingKeys", () => {
  it("lists exactly the dot-paths in base that target lacks, nested and plural entries included", () => {
    expect(missingKeys(da, en)).toEqual(["hello", "nav.settings", "docs"]);
  });

  it("a plural entry without other in the target is still missing; a complete one is not", () => {
    expect(missingKeys(da, { ...en, hello: "x", nav: { home: "h", settings: "s" }, docs: { one: "x" } })).toEqual(["docs"]);
    expect(missingKeys(da, { ...en, hello: "x", nav: { home: "h", settings: "s" }, docs: { other: "x" } })).toEqual([]);
  });

  it("an empty target misses everything", () => {
    expect(missingKeys(da, undefined)).toEqual(["title", "hello", "nav.home", "nav.settings", "docs"]);
  });
});

/** A fake translator: uppercases the text but keeps {placeholders}. Records every call. */
function fakeAI(map?: (text: string) => string) {
  const calls: { prompt: string; override?: unknown; fallback?: unknown }[] = [];
  return {
    calls,
    chat: vi.fn(async (req: { prompt: string; override?: unknown; fallback?: unknown }) => {
      calls.push(req);
      return { text: map ? map(req.prompt) : req.prompt.replace(/[^{}]+(?=\{|$)/g, (s) => s.toUpperCase()) };
    }),
  };
}

describe("fillMissing", () => {
  it("asks the AI only for missing keys and writes only those", async () => {
    const ai = fakeAI();
    const { result, filled } = await fillMissing({ base: da, target: en, from: "da", to: "en", ai });
    expect(filled).toEqual(["hello", "nav.settings", "docs"]);
    expect(ai.calls.map((c) => c.prompt)).toEqual(["Hej {name}, du har {n} nye", "Indstillinger", "{count} dokument", "{count} dokumenter"]);
    expect((result.nav as Dict).settings).toBe("INDSTILLINGER");
    expect(result.docs).toEqual({ one: "{count} DOKUMENT", other: "{count} DOKUMENTER" });
  });

  it("an existing key in the target is byte-identical afterwards, and the input is not mutated", async () => {
    const before = JSON.stringify(en);
    const { result } = await fillMissing({ base: da, target: en, from: "da", to: "en", ai: fakeAI() });
    expect(result.title).toBe("Documents (hand-edited)");
    expect((result.nav as Dict).home).toBe("Home");
    expect(JSON.stringify(en)).toBe(before);
  });

  it("a translation that changes a placeholder is rejected and not written", async () => {
    const ai = fakeAI((t) => (t.includes("{name}") ? "Hi {navn}, you have {n} new" : t));
    const { result, filled, rejected } = await fillMissing({ base: da, target: en, from: "da", to: "en", ai });
    expect(rejected).toEqual([{ key: "hello", reason: "placeholders_changed", got: "Hi {navn}, you have {n} new" }]);
    expect(filled).not.toContain("hello");
    expect("hello" in result).toBe(false);
  });

  it("a dropped placeholder is rejected too (same multiset, not just same names)", async () => {
    const ai = fakeAI((t) => (t.includes("{name}") ? "Hi {name}, you have new ones" : t));
    const { rejected } = await fillMissing({ base: da, target: en, from: "da", to: "en", ai });
    expect(rejected.map((r) => r.key)).toEqual(["hello"]);
  });

  it("every call goes to the EU route with no fallback", async () => {
    const ai = fakeAI();
    await fillMissing({ base: da, target: en, from: "da", to: "en", ai });
    expect(ai.calls.length).toBeGreaterThan(0);
    for (const c of ai.calls) {
      expect(c.override).toEqual({ provider: "mistral", model: "mistral-large-2512" });
      expect(c.fallback).toBeUndefined();
    }
    expect(EU_ROUTE).toEqual({ provider: "mistral", model: "mistral-large-2512" });
  });

  it("placeholders() compares as a sorted multiset", () => {
    expect(placeholders("{b} {a} {a}")).toEqual(["{a}", "{a}", "{b}"]);
  });
});

describe("the report half does not pull in the AI half", () => {
  it("src/index.ts imports nothing from llm or ai-sdk", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*(llm|ai-sdk)/);
  });
});
