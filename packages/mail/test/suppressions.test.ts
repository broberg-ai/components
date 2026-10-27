// components-F005.12 — getSuppressions. The trap is in the FAILURE: a lookup that
// could not run, read as [], concludes «nobody was suppressed, so everyone got it».
import { describe, expect, it } from "vitest";
import { getSuppressions } from "../src/index";

const respond = (status: number, body: unknown, seen?: string[]) =>
  (async (url: string) => {
    seen?.push(url);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

const PAGE = {
  object: "list",
  has_more: true,
  data: [
    { id: "s1", email: "fd-demo-leder@webhouse.dk", origin: "bounce", source_id: "37a5ac15-d91c-49ac-a37e-d8a991096631", created_at: "2026-08-31T19:47:54Z" },
    { id: "s2", email: "x@example.com", origin: "complaint" },
  ],
};

describe("components-F005.12 — getSuppressions", () => {
  it("lists a page with the SAME key and an injected fetch, and passes the query through", async () => {
    const seen: string[] = [];
    const r = await getSuppressions({ apiKey: "re_x", fetch: respond(200, PAGE, seen) }, { limit: 50, after: "s0", origin: "bounce" });
    expect(r).toStrictEqual({
      ok: true,
      hasMore: true,
      suppressions: [
        { id: "s1", email: "fd-demo-leder@webhouse.dk", origin: "bounce", sourceId: "37a5ac15-d91c-49ac-a37e-d8a991096631", createdAt: "2026-08-31T19:47:54Z" },
        { id: "s2", email: "x@example.com", origin: "complaint" },
      ],
    });
    expect(seen).toStrictEqual(["https://api.resend.com/suppressions?limit=50&after=s0&origin=bounce"]);
  });

  it("an EMPTY list from the provider is an empty list — the one honest way to get []", async () => {
    const r = await getSuppressions({ apiKey: "re_x", fetch: respond(200, { object: "list", has_more: false, data: [] }) });
    expect(r).toStrictEqual({ ok: true, suppressions: [], hasMore: false });
  });

  it("NO failure ever yields a list: 401, 403, 404, 500, network, not-JSON, no data array, a malformed entry, no key", async () => {
    const throwing = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const cases: Array<[string, Awaited<ReturnType<typeof getSuppressions>>]> = [
      ["401", await getSuppressions({ apiKey: "re_x", fetch: respond(401, { message: "restricted" }) })],
      ["403", await getSuppressions({ apiKey: "re_x", fetch: respond(403, {}) })],
      ["404", await getSuppressions({ apiKey: "re_x", fetch: respond(404, {}) })],
      ["500", await getSuppressions({ apiKey: "re_x", fetch: respond(500, {}) })],
      ["network", await getSuppressions({ apiKey: "re_x", fetch: throwing })],
      ["not JSON", await getSuppressions({ apiKey: "re_x", fetch: respond(200, "<html>") })],
      ["no data array", await getSuppressions({ apiKey: "re_x", fetch: respond(200, { object: "list" }) })],
      ["malformed entry", await getSuppressions({ apiKey: "re_x", fetch: respond(200, { data: [{ id: "s1" }] }) })],
      ["no key", await getSuppressions({ fetch: respond(200, PAGE) })],
    ];
    for (const [name, r] of cases) {
      expect(r.ok, name).toBe(false);
      expect("suppressions" in r, `${name} must carry no list`).toBe(false);
      expect(r.ok === false && r.reason, name).toBe("could_not_ask");
      expect(r.ok === false && r.detail.length > 0, `${name} names a reason`).toBe(true);
    }
    const r401 = cases[0]![1];
    expect(r401.ok === false && r401.detail).toContain("does NOT mean nobody is suppressed");
  });

  it("refuses a limit outside 1–100 instead of sending it", async () => {
    const seen: string[] = [];
    const r = await getSuppressions({ apiKey: "re_x", fetch: respond(200, PAGE, seen) }, { limit: 500 });
    expect(r.ok).toBe(false);
    expect(seen).toStrictEqual([]);
  });

  it("zero new dependencies: src/index.ts imports only its own modules", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${process.cwd()}/src/index.ts`, "utf8");
    const froms = [...src.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
    expect(froms.every((f) => f!.startsWith("./"))).toBe(true);
  });
});
