// F035.23 — house-of-wellness (#50368): the openai pattern had no left boundary, so
// "klassisk-ansigtsbehandling-gavekort" in an ordinary WordPress URL read as an OpenAI key
// ("sk-" in the middle of a Danish word) and stopped a commit.
import { describe, expect, it } from "vitest";
import { hasSecret, redactSecrets } from "../src/index";

describe("sk- inside a word is not an OpenAI key (F035.23)", () => {
  const urls = [
    "https://example.dk/vare/klassisk-ansigtsbehandling-gavekort/",
    "https://example.dk/wp-content/uploads/2026/05/Klassisk-Ansigtsbehandling-hero-1024x683.jpg",
    "fysisk-genoptraening-forloeb-for-sportsudoevere",
  ];
  for (const u of urls) it(`does not flag «${u.slice(0, 50)}…»`, () => {
    expect(hasSecret(u)).toBe(false);
    expect(redactSecrets(u).redacted).toBe(u);
  });
  it("still catches a real-shaped key at the start of a value, after =, a quote or a space", () => {
    const k = "sk-proj-" + "B".repeat(40);
    for (const s of [k, `OPENAI_API_KEY=${k}`, `"${k}"`, `token ${k}`]) expect(hasSecret(s)).toBe(true);
  });
});
