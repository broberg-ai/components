// F110.13 — legal.broberg.ai is cold and cached: sites keep the texts for a day
// and revalidate cheaply with ETag. Runs the SHIPPED server's route() directly.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { route, CACHE } from "../../../apps/legal/server.ts";

it("legal.broberg.ai: cached for a day, 304 on an unchanged ETag, /health uncached, cold on Fly", async () => {
  const errors: string[] = [];
  const check = (label: string, cond: boolean, detail: unknown = "") => { if (!cond) errors.push(`${label} — ${String(detail)}`); };
  const get = (path: string, headers: Record<string, string> = {}) => route(new Request(`https://legal.broberg.ai${path}`, { headers }));

  check("cache policy is a day, then stale-while-revalidate a week", CACHE === "public, max-age=86400, stale-while-revalidate=604800", CACHE);

  const j = get("/v1/jam/privacy.da.json");
  const etag = j.headers.get("etag");
  check("JSON: 200 with an ETag", j.status === 200 && /^"[0-9a-f]{64}"$/.test(etag ?? ""), `${j.status} ${etag}`);
  check("JSON: cached for a day", j.headers.get("cache-control") === CACHE, j.headers.get("cache-control"));
  const j304 = get("/v1/jam/privacy.da.json", { "if-none-match": etag! });
  check("JSON: If-None-Match with the same ETag → 304, no body", j304.status === 304 && (await j304.text()) === "", String(j304.status));
  check("JSON: the 304 keeps the cache header", j304.headers.get("cache-control") === CACHE);
  const jOld = get("/v1/jam/privacy.da.json", { "if-none-match": '"0000"' });
  check("JSON: a different ETag → full 200 (new text is delivered)", jOld.status === 200);

  const h = get("/jam/terms");
  const hetag = h.headers.get("etag");
  check("HTML: 200, cached for a day, with an ETag", h.status === 200 && h.headers.get("cache-control") === CACHE && /^"p\d+-[0-9a-f]{64}"$/.test(hetag ?? ""), `${h.status} ${h.headers.get("cache-control")} ${hetag}`);
  const h304 = get("/jam/terms", { "if-none-match": hetag! });
  check("HTML: If-None-Match → 304", h304.status === 304);
  check("HTML: page ETag differs from the JSON one (template versioned)", hetag !== get("/v1/jam/terms.da.json").headers.get("etag"));

  const health = get("/health");
  check("/health is never cached", health.status === 200 && health.headers.get("cache-control") === "no-store", health.headers.get("cache-control"));

  const toml = readFileSync(new URL("../../../apps/legal/fly.toml", import.meta.url), "utf8");
  check("fly.toml: cold — min_machines_running = 0", /^\s*min_machines_running\s*=\s*0\s*$/m.test(toml));
  check("fly.toml: stops when idle and starts on request", /auto_stop_machines\s*=\s*"stop"/.test(toml) && /auto_start_machines\s*=\s*true/.test(toml));

    expect(errors).toEqual([]);
});
