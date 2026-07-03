import { describe, it, expect, afterEach } from "vitest";
import { createLensClient, LensClientError, type FlowResult, type CaptureResult } from "../src/index";
import { createLensProxy } from "../src/proxy";
import { Hono } from "hono";

const BASE = "https://lens.cardmem.com";
const TOKEN = "lct_secret_token";

// A routable fetch mock: `handler(url, init, callIndex)` returns a Response, or
// "throw" to simulate a network error. Records every call for assertions.
function fetchMock(handler: (url: string, init: RequestInit | undefined, n: number) => Response | "throw") {
  let n = 0;
  const urls: string[] = [];
  const inits: Array<RequestInit | undefined> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    inits.push(init);
    const r = handler(url, init, n++);
    if (r === "throw") throw new TypeError("fetch failed");
    return r;
  }) as typeof fetch;
  return Object.assign(fn, { urls, inits });
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const authOf = (init: RequestInit | undefined): string | undefined =>
  (init?.headers as Record<string, string> | undefined)?.Authorization;

const CAPTURE_OK: CaptureResult = {
  run_id: "r1",
  screenshot_url: `${BASE}/artifact?key=lens-cloud/r1.png`,
  dom_hash: "abc",
  status: "ok",
  width: 1280,
  height: 800,
  final_url: `${BASE}/x`,
  title: "X",
};

afterEach(() => {
  delete process.env.LENS_CLOUD_URL;
  delete process.env.LENS_CLOUD_TOKEN;
});

describe("createLensClient — request shape + auth", () => {
  it("capture POSTs /capture with Bearer + the body, returns the service result", async () => {
    const mf = fetchMock((url) => (url.endsWith("/health") ? json({ ok: true }) : json(CAPTURE_OK)));
    const client = createLensClient({ baseUrl: BASE, token: TOKEN, fetch: mf, prewarm: false });
    const r = await client.capture({ url: "https://autodoc.fly.dev", mode: "fullPage" });
    expect(r.screenshot_url).toContain("/artifact");
    const post = mf.urls.findIndex((u) => u.endsWith("/capture"));
    expect(mf.urls[post]).toBe(`${BASE}/capture`);
    expect(authOf(mf.inits[post])).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(mf.inits[post]?.body))).toEqual({ url: "https://autodoc.fly.dev", mode: "fullPage" });
  });

  it("runFlow surfaces resolved_via per step and accepts a LocateSpec target", async () => {
    const flow: FlowResult = {
      run_id: "f1",
      status: "passed",
      steps: [
        { index: 0, action: "click", status: "ok", ms: 12, resolved_via: "role" },
        { index: 1, action: "fill", status: "ok", ms: 8, resolved_via: "testid" },
      ],
    };
    const mf = fetchMock((url) => (url.endsWith("/health") ? json({ ok: true }) : json(flow)));
    const client = createLensClient({ baseUrl: BASE, token: TOKEN, fetch: mf, prewarm: false });
    const r = await client.runFlow({
      base_url: "https://appstoreconnect.apple.com",
      steps: [
        { action: "click", target: { role: "button", name: "New Version" } },
        { action: "fill", target: { testid: "version" }, value: "1.2.0" },
      ],
    });
    expect(r.steps.map((s) => s.resolved_via)).toEqual(["role", "testid"]);
  });
});

describe("error surfacing — failed flow is DATA, transport/auth THROW", () => {
  it("a failed flow (status:'failed') is returned, NOT thrown — the failing step is readable", async () => {
    const flow: FlowResult = {
      run_id: "f2",
      status: "failed",
      steps: [
        { index: 0, action: "goto", status: "ok", ms: 40 },
        { index: 1, action: "click", status: "failed", ms: 5000, error: "locator not found", screenshot_url: `${BASE}/artifact?key=fail.png` },
      ],
    };
    const mf = fetchMock(() => json(flow));
    const client = createLensClient({ baseUrl: BASE, token: TOKEN, fetch: mf, prewarm: false });
    const r = await client.runFlow({ base_url: "https://a.dev", steps: [{ action: "goto", url: "/" }] });
    expect(r.status).toBe("failed");
    const failed = r.steps.find((s) => s.status === "failed");
    expect(failed?.index).toBe(1);
    expect(failed?.error).toContain("locator not found");
    expect(failed?.screenshot_url).toContain("/artifact");
  });

  it("401 throws a LensClientError (kind auth) and is NOT retried", async () => {
    let posts = 0;
    const mf = fetchMock((url) => {
      if (url.endsWith("/capture")) { posts++; return json({ error: "bad token" }, 401); }
      return json({ ok: true });
    });
    const client = createLensClient({ baseUrl: BASE, token: "wrong", fetch: mf, prewarm: false });
    await expect(client.capture({ url: "https://a.dev" })).rejects.toMatchObject({ name: "LensClientError", kind: "auth", status: 401 });
    expect(posts).toBe(1); // terminal, no retry
  });

  it("503 throws (kind unavailable) and is NOT retried", async () => {
    let posts = 0;
    const mf = fetchMock((url) => {
      if (url.endsWith("/flow")) { posts++; return json({}, 503); }
      return json({ ok: true });
    });
    const client = createLensClient({ baseUrl: BASE, token: TOKEN, fetch: mf, prewarm: false });
    await expect(client.runFlow({ base_url: "https://a.dev", steps: [{ action: "goto", url: "/" }] }))
      .rejects.toMatchObject({ kind: "unavailable", status: 503 });
    expect(posts).toBe(1);
  });
});

describe("cold-start retry", () => {
  it("retries a 502 then succeeds", async () => {
    let capCalls = 0;
    const mf = fetchMock((url) => {
      if (url.endsWith("/capture")) { capCalls++; return capCalls === 1 ? json({}, 502) : json(CAPTURE_OK); }
      return json({ ok: true });
    });
    const client = createLensClient({ baseUrl: BASE, token: TOKEN, fetch: mf, prewarm: false, retryBackoffMs: 1 });
    const r = await client.capture({ url: "https://a.dev" });
    expect(r.run_id).toBe("r1");
    expect(capCalls).toBe(2); // one 502, one 200
  });

  it("retries a network error then succeeds", async () => {
    let capCalls = 0;
    const mf = fetchMock((url) => {
      if (url.endsWith("/capture")) { capCalls++; return capCalls === 1 ? "throw" : json(CAPTURE_OK); }
      return json({ ok: true });
    });
    const client = createLensClient({ baseUrl: BASE, token: TOKEN, fetch: mf, prewarm: false, retryBackoffMs: 1 });
    const r = await client.capture({ url: "https://a.dev" });
    expect(r.status).toBe("ok");
    expect(capCalls).toBe(2);
  });

  it("gives up after exhausting 502 retries and throws", async () => {
    let capCalls = 0;
    const mf = fetchMock((url) => {
      if (url.endsWith("/capture")) { capCalls++; return json({}, 502); }
      return json({ ok: true });
    });
    const client = createLensClient({ baseUrl: BASE, token: TOKEN, fetch: mf, prewarm: false, retries: 2, retryBackoffMs: 1 });
    await expect(client.capture({ url: "https://a.dev" })).rejects.toBeInstanceOf(LensClientError);
    expect(capCalls).toBe(3); // initial + 2 retries
  });
});

describe("prewarm + health", () => {
  it("prewarm (default) GETs /health before the POST", async () => {
    const mf = fetchMock((url) => (url.endsWith("/health") ? json({ ok: true }) : json(CAPTURE_OK)));
    const client = createLensClient({ baseUrl: BASE, token: TOKEN, fetch: mf, retryBackoffMs: 1 });
    await client.capture({ url: "https://a.dev" });
    expect(mf.urls[0]).toBe(`${BASE}/health`);
    expect(mf.urls[1]).toBe(`${BASE}/capture`);
  });

  it("health() returns true/false and never throws", async () => {
    const up = createLensClient({ baseUrl: BASE, token: TOKEN, fetch: fetchMock(() => json({ ok: true })) });
    expect(await up.health()).toBe(true);
    const down = createLensClient({ baseUrl: BASE, token: TOKEN, fetch: fetchMock(() => "throw") });
    expect(await down.health()).toBe(false);
  });
});

describe("fetchArtifact — same-origin token gate", () => {
  it("attaches the Bearer for a same-origin artifact URL", async () => {
    const mf = fetchMock(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const client = createLensClient({ baseUrl: BASE, token: TOKEN, fetch: mf });
    const bytes = await client.fetchArtifact(`${BASE}/artifact?key=x.png`);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(authOf(mf.inits[0])).toBe(`Bearer ${TOKEN}`);
  });

  it("does NOT attach the Bearer for a foreign-host URL", async () => {
    const mf = fetchMock(() => new Response(new Uint8Array([1]), { status: 200 }));
    const client = createLensClient({ baseUrl: BASE, token: TOKEN, fetch: mf });
    await client.fetchArtifact("https://evil.example/artifact?key=x.png");
    expect(authOf(mf.inits[0])).toBeUndefined();
  });
});

describe("env defaults", () => {
  it("reads LENS_CLOUD_URL + LENS_CLOUD_TOKEN when opts are omitted", async () => {
    process.env.LENS_CLOUD_URL = "https://lens.example";
    process.env.LENS_CLOUD_TOKEN = "env_token";
    const mf = fetchMock(() => json(CAPTURE_OK));
    const client = createLensClient({ fetch: mf, prewarm: false });
    expect(client.baseUrl).toBe("https://lens.example");
    await client.capture({ url: "https://a.dev" });
    expect(mf.urls[0]).toBe("https://lens.example/capture");
    expect(authOf(mf.inits[0])).toBe("Bearer env_token");
  });
});

describe("createLensProxy (Hono) — forwards with server-side token", () => {
  it("proxies POST /capture to the hosted Lens with the Bearer", async () => {
    const mf = fetchMock((url) => (url.endsWith("/capture") ? json(CAPTURE_OK) : json({ ok: true })));
    const app = new Hono();
    app.route("/api/lens", createLensProxy({ baseUrl: BASE, token: TOKEN, fetch: mf }));
    const res = await app.request("/api/lens/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://a.dev" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ run_id: "r1" });
    const up = mf.urls.findIndex((u) => u.endsWith("/capture"));
    expect(mf.urls[up]).toBe(`${BASE}/capture`);
    expect(authOf(mf.inits[up])).toBe(`Bearer ${TOKEN}`); // token added server-side
  });

  it("proxies GET /artifact with the Bearer and GET /health without auth", async () => {
    const mf = fetchMock((url) =>
      url.includes("/artifact")
        ? new Response(new Uint8Array([9]), { status: 200, headers: { "content-type": "image/png" } })
        : json({ ok: true, service: "lens-cloud" }),
    );
    const app = new Hono();
    app.route("/api/lens", createLensProxy({ baseUrl: BASE, token: TOKEN, fetch: mf }));

    await app.request("/api/lens/artifact?key=lens-cloud/r1.png");
    const art = mf.urls.findIndex((u) => u.includes("/artifact"));
    expect(authOf(mf.inits[art])).toBe(`Bearer ${TOKEN}`);

    await app.request("/api/lens/health");
    const h = mf.urls.findIndex((u) => u.endsWith("/health"));
    expect(authOf(mf.inits[h])).toBeUndefined();
  });
});
