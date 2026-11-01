// F110.15 — the self-updating cache (ported from jam) and verifyTemplate.
import { describe, expect, it } from "vitest";
import { EXAMPLE_FACTS, createLegalCache, getTemplate, templateHash, verifyTemplate, type LegalTemplate } from "../src/index";

const bundled = getTemplate({ doc: "trust", locale: "da" });
// A NEWER template as the API would send it: changed title, its own correct hash.
function newer(title = "Tillid og sikkerhed (ny udgave)"): LegalTemplate {
  const { hash: _h, stale, ...src } = bundled;
  const changed = { ...src, title };
  return { ...changed, stale, hash: templateHash(changed) };
}
const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

describe("verifyTemplate", () => {
  it("accepts a template exactly as the API serves it (hash over the authored part, without stale/hash)", () => {
    expect(verifyTemplate(JSON.parse(JSON.stringify(bundled)))).toBe(true);
  });
  it("refuses a changed body, a missing hash and an empty template", () => {
    expect(verifyTemplate({ ...bundled, title: "tampered" })).toBe(false);
    expect(verifyTemplate({ ...bundled, hash: undefined })).toBe(false);
    expect(verifyTemplate({ ...bundled, sections: [] })).toBe(false);
    expect(verifyTemplate(null)).toBe(false);
  });
});

describe("createLegalCache", () => {
  const setup = (respond: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
    let t = 0;
    const calls: { url: string; inm?: string }[] = [];
    const kept: string[] = [];
    const cache = createLegalCache({
      facts: EXAMPLE_FACTS,
      now: () => t,
      onKeepOld: (_k, r) => kept.push(r),
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push({ url, inm: (init?.headers as Record<string, string>)?.["if-none-match"] });
        return respond(url, init);
      }) as typeof fetch,
    });
    return { cache, calls, kept, advance: (ms: number) => (t += ms) };
  };

  it("serves at once from the bundled template, then swaps in a newer one that verifies", async () => {
    const { cache, calls } = setup(() => res(200, newer()));
    expect(cache.get("trust", "da").title).toBe(bundled.title);
    await cache.settled("trust", "da");
    expect(cache.get("trust", "da").title).toBe("Tillid og sikkerhed (ny udgave)");
    expect(calls[0]).toEqual({ url: "https://legal.broberg.ai/v1/trust.da.json", inm: `"${bundled.hash}"` });
  });

  it("calls the API at most once per day per document — not per page view", async () => {
    const { cache, calls, advance } = setup(() => res(304));
    for (let i = 0; i < 50; i++) cache.get("trust", "da");
    await cache.settled("trust", "da");
    expect(calls.length).toBe(1);
    advance(23 * 3600_000);
    cache.get("trust", "da");
    expect(calls.length).toBe(1);
    advance(2 * 3600_000);
    cache.get("trust", "da");
    expect(calls.length).toBe(2);
  });

  it("keeps the old template on 304, a server error, a network error and a bad hash", async () => {
    for (const respond of [() => res(304), () => res(503), () => { throw new Error("ECONNREFUSED"); }, () => res(200, { ...newer(), title: "changed after hashing" })]) {
      const { cache, kept } = setup(respond as never);
      cache.get("trust", "da");
      await cache.settled("trust", "da");
      expect(cache.get("trust", "da").title).toBe(bundled.title);
      if (respond.toString().includes("304")) expect(kept).toEqual([]);
      else expect(kept.length).toBe(1);
    }
  });

  it("fills YOUR facts into every version it serves", async () => {
    const { cache } = setup(() => res(200, newer()));
    cache.get("trust", "da");
    await cache.settled("trust", "da");
    expect(cache.get("trust", "da").product).toBe(EXAMPLE_FACTS.id);
  });
});
