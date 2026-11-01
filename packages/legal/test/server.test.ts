// F110.13 + F110.14 — legal.broberg.ai is an API (not a website), cold and cached.
// Runs the SHIPPED server's route() directly.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { route, CACHE } from "../../../apps/legal/server.ts";
import { DOC_IDS } from "../src/index";

const R = "https://broberg.ai";
const get = (path: string, headers: Record<string, string> = {}, redirect: string | undefined = R) =>
  route(new Request(`https://legal.broberg.ai${path}`, { headers }), redirect);

it("serves the TEMPLATE (facts slots open) with ETag, a day of cache and 304", async () => {
  const r = get("/v1/privacy.da.json");
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe(CACHE);
  const body = await r.json();
  const slots = body.sections.flatMap((s: any) => s.blocks).filter((b: any) => b.type === "facts").map((b: any) => b.fact);
  expect(slots.length).toBeGreaterThan(0);
  expect(body.product).toBeUndefined();
  const etag = r.headers.get("etag")!;
  expect(etag).toBe(`"${body.hash}"`);
  const again = get("/v1/privacy.da.json", { "if-none-match": etag });
  expect([again.status, await again.text()]).toEqual([304, ""]);
});

it("/v1/documents lists every template with version and hash", async () => {
  const body = await get("/v1/documents").json();
  expect(body.documents.map((d: any) => d.doc).sort()).toEqual([...DOC_IDS].sort());
});

it("has NO per-product routes any more — components keeps no product versions", () => {
  expect(get("/v1/jam/privacy.da.json").status).toBe(404);
  expect(get("/v1/products").status).toBe(404);
  expect(get("/v1/nope.da.json").status).toBe(404);
});

it("is not a website: the front page and any page send people to broberg.ai (301)", () => {
  for (const p of ["/", "/jam/terms", "/privacy", "/anything"]) {
    const r = get(p);
    expect([p, r.status, r.headers.get("location")]).toEqual([p, 301, R]);
  }
});

it("without REDIRECT_URL it answers 404 rather than inventing a target", () => {
  expect(route(new Request("https://legal.broberg.ai/"), "").status).toBe(404);
});

it("/health is never cached; fly.toml is cold and names the redirect target once", () => {
  expect(get("/health").headers.get("cache-control")).toBe("no-store");
  const toml = readFileSync(new URL("../../../apps/legal/fly.toml", import.meta.url), "utf8");
  expect(/^\s*min_machines_running\s*=\s*0\s*$/m.test(toml)).toBe(true);
  expect(/REDIRECT_URL\s*=\s*"https:\/\/broberg\.ai"/.test(toml)).toBe(true);
});
