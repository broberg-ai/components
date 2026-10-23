// F038.39 — /images: what every Fly app runs on, from cardmem's hygiene reports.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
process.env.ENROLL_DB_URL = ":memory:";
import { app } from "./server";
import { getEnrollStore } from "./enroll";
import { fetchImages, renderImagesPage, slimVerdict, type ImageRow } from "./images-page";

const row = (o: Partial<ImageRow>): ImageRow => ({ app: "a", project: "p", status: "ok", at: "2026-10-23T10:42:00Z", base_os: "debian 13", base_image: "oven/bun:1-slim", base_image_exception: null, node_version: null, critical_fixable: 0, sha: "x", run_id: 1, ...o });

describe("slimVerdict", () => {
  it("follows: node:24-slim and oven/bun:1-slim, also pinned by digest", () => {
    expect(["node:24-slim", "oven/bun:1-slim", "oven/bun:1-slim@sha256:" + "a".repeat(64)].map((b) => slimVerdict(row({ base_image: b })))).toEqual(["follows", "follows", "follows"]);
  });
  it("not: latest, full distro, alpine, other majors, pinned minors", () => {
    expect(["node:latest", "oven/bun:1", "oven/bun:1.4-alpine", "node:22-slim", "node:24", "node:24.11-slim", "debian:12", "python:3.12-slim"].map((b) => slimVerdict(row({ base_image: b }))))
      .toEqual(["not", "not", "not", "not", "not", "not", "not", "not"]);
  });
  it("exception wins; unknown or ${ARG} base is unknown — never «not»", () => {
    expect([
      slimVerdict(row({ base_image: "coturn/coturn:4.18.0-alpine", base_image_exception: "vendor image" })),
      slimVerdict(row({ base_image: null })),
      slimVerdict(row({ base_image: "node:${NODE_VERSION}-slim" })),
    ]).toEqual(["exception", "unknown", "unknown"]);
  });
});

describe("fetchImages", () => {
  it("without a key it never calls out and says not_configured", async () => {
    let called = false;
    const r = await fetchImages(undefined, "http://x", (async () => { called = true; return new Response("{}"); }) as typeof fetch);
    expect([r, called]).toEqual([{ ok: false, reason: "not_configured" }, false]);
  });
  it("sends the read key and returns the rows", async () => {
    let sent: string | null = null;
    const r = await fetchImages("k1", "http://x", (async (_u: string, init: RequestInit) => {
      sent = (init.headers as Record<string, string>)["x-hygiene-read-key"];
      return new Response(JSON.stringify({ apps: [row({ app: "cardmem" })] }));
    }) as typeof fetch);
    expect(sent).toBe("k1");
    expect(r.ok && r.rows.map((x) => x.app)).toEqual(["cardmem"]);
  });
  it("a 401 or a thrown fetch is fetch_failed, not an empty fleet", async () => {
    const a = await fetchImages("k", "http://x", (async () => new Response("no", { status: 401 })) as typeof fetch);
    const b = await fetchImages("k", "http://x", (async () => { throw new Error("boom"); }) as typeof fetch);
    expect([a, b]).toEqual([{ ok: false, reason: "fetch_failed", detail: "HTTP 401" }, { ok: false, reason: "fetch_failed", detail: "boom" }]);
  });
});

describe("renderImagesPage", () => {
  const html = renderImagesPage({ ok: true, fetchedAt: "2026-10-23T12:00:00Z", rows: [
    row({ app: "cardmem", base_image: "oven/bun:1-slim" }),
    row({ app: "pitch", base_image: "node:22-alpine", base_os: "alpine 3.20" }),
    row({ app: "voice", base_image: "livekit/livekit-server:v1.13.9", base_image_exception: "vendor image" }),
    row({ app: "never", status: null, base_image: null, base_os: null, at: null }),
  ] });
  const verdictOf = (app: string) => html.match(new RegExp(`data-testid="images-row-${app}" data-verdict="([a-z]+)"`))?.[1];
  it("one row per app with its verdict; never-run is unknown and says so", () => {
    expect(["cardmem", "pitch", "voice", "never"].map(verdictOf)).toEqual(["follows", "not", "exception", "unknown"]);
    expect(html).toContain("ingen kørsel endnu");
    expect(html).toContain('<span class="im-why">vendor image</span>');
  });
  it("the time is Danish: 10:42Z in October reads 12.42 (CEST)", () => {
    expect(html).toContain("23.10.2026 kl. 12.42 (dansk tid)");
  });
  it("not configured says so instead of an empty table", () => {
    const h = renderImagesPage({ ok: false, reason: "not_configured" });
    expect(h).toContain('data-testid="images-unavailable" data-reason="not_configured"');
    expect(h).not.toContain('data-testid="images-table"');
  });
});

describe("/images and /api/images", () => {
  const login = async () => {
    const k = "i".repeat(64);
    await (await getEnrollStore())!.bindSessionKey("t-img", createHash("sha256").update(k).digest("hex"));
    return { "x-discovery-session": "t-img", "x-enroll-key": k };
  };
  it("sit behind the login", async () => {
    expect((await app.request("/images")).status).toBe(401);
    expect((await app.request("/api/images")).status).toBe(401);
  });
  it("without HYGIENE_READ_KEY: page explains, API answers 503 not_configured", async () => {
    delete process.env.HYGIENE_READ_KEY;
    const h = await login();
    const page = await (await app.request("/images", { headers: h })).text();
    expect(page).toContain('data-reason="not_configured"');
    const api = await app.request("/api/images", { headers: h });
    expect([api.status, (await api.json()).error]).toEqual([503, "not_configured"]);
  });
  it("is in the menu and in /api's self-description", async () => {
    const h = await login();
    expect(await (await app.request("/packages", { headers: h })).text()).toContain('data-testid="nav-images"');
    expect(JSON.stringify(await (await app.request("/api", { headers: h })).json())).toContain('"/api/images"');
  });
});
