import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { NextRequest } from "next/server";
import { deviceFromRequest, deriveDevice } from "../src/index";
import { deviceFromNextRequest, deviceFromNextHeaders } from "../src/next";
import { deviceMiddleware, deviceFromContext } from "../src/hono";
import { UA_FIXTURES } from "./fixtures";

const IPHONE = UA_FIXTURES.find((f) => f.label === "iPhone 15")!.ua;
const URL_PWA = "https://example.dk/dashboard?src=pwa";
const URL_PLAIN = "https://example.dk/dashboard";

describe("AC#1 — one structural reader, four real request shapes", () => {
  it("a real fetch Request, a real NextRequest, a real Hono c.req.raw and a bare literal all agree", async () => {
    const headers = { "user-agent": IPHONE };

    // 1. a real fetch Request
    const fetchReq = new Request(URL_PWA, { headers });

    // 2. a real NextRequest from the actual next package
    const nextReq = new NextRequest(URL_PWA, { headers });

    // 3. a REAL Hono context's raw request, captured from a running app
    let honoRaw: { headers: Headers; url: string } | null = null;
    const app = new Hono();
    app.get("/dashboard", (c) => {
      honoRaw = c.req.raw;
      return c.text("ok");
    });
    await app.request(URL_PWA, { headers });
    expect(honoRaw, "hono handler never ran").not.toBeNull();

    // 4. a bare structural literal
    const literal = { headers: new Headers(headers), url: URL_PWA };

    const results = [fetchReq, nextReq, honoRaw!, literal].map((r) => deviceFromRequest(r));
    for (const got of results) expect(got).toEqual(results[0]);

    // and the answer is actually right, not merely consistent
    expect(results[0]!.os.family).toBe("iOS");
    expect(results[0]!.formFactor).toBe("mobile");
    expect(results[0]!.launch).toBe("installed");
  });

  it("accepts a plain header object and a relative URL", () => {
    const got = deviceFromRequest({ headers: { "user-agent": IPHONE }, url: "/dashboard?src=pwa" });
    expect(got.launch).toBe("installed");
    expect(got.os.family).toBe("iOS");
  });
});

describe("AC#2 — the launch marker is read from the request's own query string", () => {
  it("?src=pwa → installed, without it → browser", () => {
    const headers = { "user-agent": IPHONE };
    expect(deviceFromRequest(new Request(URL_PWA, { headers })).launch).toBe("installed");
    expect(deviceFromRequest(new Request(URL_PLAIN, { headers })).launch).toBe("browser");
  });

  it("the parameter name is overridable without touching the core", () => {
    const req = new Request("https://example.dk/?launch=standalone", {
      headers: { "user-agent": IPHONE },
    });
    expect(deviceFromRequest(req).launch).toBe("browser"); // wrong param → not found
    expect(deviceFromRequest(req, { launchParam: "launch" }).launch).toBe("installed");
  });

  it("NO url at all → `unknown`, never `browser`", () => {
    // "We looked and found nothing" and "we could not look" are different
    // facts. Reporting the second as `browser` would hide installed traffic.
    const got = deviceFromRequest({ headers: { "user-agent": IPHONE } });
    expect(got.launch).toBe("unknown");
    // the core, told explicitly there is no marker, still says browser
    expect(deriveDevice({ headers: { "user-agent": IPHONE } }).launch).toBe("browser");
  });
});

describe("AC#4 + AC#5 — Stack B: real Hono app", () => {
  const build = (opts: Parameters<typeof deviceMiddleware>[0]) => {
    const app = new Hono();
    app.use("*", deviceMiddleware(opts));
    app.get("/dashboard", (c) => c.text("real body"));
    return app;
  };

  it("calls onDevice exactly once per request, with the right facts", async () => {
    const onDevice = vi.fn();
    const res = await build({ onDevice }).request(URL_PWA, {
      headers: { "user-agent": IPHONE },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("real body");
    expect(onDevice).toHaveBeenCalledTimes(1);
    const facts = onDevice.mock.calls[0]![0];
    expect(facts.os.family).toBe("iOS");
    expect(facts.launch).toBe("installed");
  });

  it("SHIP DARK — a THROWING sink does not break the request", async () => {
    const onDevice = vi.fn(() => {
      throw new Error("sink is down");
    });
    const onError = vi.fn();
    const res = await build({ onDevice, onError }).request(URL_PLAIN, {
      headers: { "user-agent": IPHONE },
    });
    // The test cannot pass by the sink never running: assert it WAS invoked.
    expect(onDevice).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("real body");
  });

  it("SHIP DARK — a REJECTING async sink does not break the request either", async () => {
    const onDevice = vi.fn(async () => {
      throw new Error("async sink is down");
    });
    const onError = vi.fn();
    const res = await build({ onDevice, onError }).request(URL_PLAIN, {
      headers: { "user-agent": IPHONE },
    });
    expect(onDevice).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1); // awaited, so it is caught here
    expect(res.status).toBe(200);
  });

  it("a sink that throws with NO onError is still silent", async () => {
    const app = build({
      onDevice: () => {
        throw new Error("boom");
      },
    });
    const res = await app.request(URL_PLAIN, { headers: { "user-agent": IPHONE } });
    expect(res.status).toBe(200);
  });

  it("deviceFromContext reads a real Hono context directly", async () => {
    let facts: ReturnType<typeof deviceFromContext> | null = null;
    const app = new Hono();
    app.get("/dashboard", (c) => {
      facts = deviceFromContext(c);
      return c.text("ok");
    });
    await app.request(URL_PWA, { headers: { "user-agent": IPHONE } });
    expect(facts!.launch).toBe("installed");
    expect(facts!.os.family).toBe("iOS");
  });
});

describe("AC#6 — Stack A: real NextRequest and headers()", () => {
  it("deviceFromNextRequest works on a real NextRequest", () => {
    const req = new NextRequest(URL_PWA, { headers: { "user-agent": IPHONE } });
    const got = deviceFromNextRequest(req);
    expect(got.launch).toBe("installed");
    expect(got.os.family).toBe("iOS");
    expect(got.formFactor).toBe("mobile");
  });

  it("falls back to nextUrl when url is absent", () => {
    const got = deviceFromNextRequest({
      headers: new Headers({ "user-agent": IPHONE }),
      nextUrl: { href: URL_PWA },
    });
    expect(got.launch).toBe("installed");
  });

  it("server component WITH searchParams → installed", () => {
    const headers = new Headers({ "user-agent": IPHONE });
    expect(deviceFromNextHeaders(headers, { searchParams: new URLSearchParams("src=pwa") }).launch)
      .toBe("installed");
    expect(deviceFromNextHeaders(headers, { searchParams: { src: "pwa" } }).launch)
      .toBe("installed");
  });

  it("server component WITHOUT searchParams → `unknown`, NOT a silent `browser`", () => {
    // headers() carries no URL. Defaulting to `browser` would label every
    // server render an un-installed visit and hide installed-PWA traffic.
    const got = deviceFromNextHeaders(new Headers({ "user-agent": IPHONE }));
    expect(got.launch).toBe("unknown");
    expect(got.os.family).toBe("iOS"); // everything else still derived
  });

  it("searchParams present but WITHOUT the marker → browser (looked, found none)", () => {
    const got = deviceFromNextHeaders(new Headers({ "user-agent": IPHONE }), {
      searchParams: new URLSearchParams("utm_source=mail"),
    });
    expect(got.launch).toBe("browser");
  });

  it("forwards Client Hints, so `source` is not silently downgraded", () => {
    const headers = new Headers({
      "user-agent": IPHONE,
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"iOS"',
    });
    const got = deviceFromNextHeaders(headers, { searchParams: new URLSearchParams("src=pwa") });
    expect(got.source).toBe("mixed");
  });
});

describe("AC#3 — no vendor type crosses the boundary", () => {
  it("the adapters accept hand-made structural objects, proving no vendor class is required", () => {
    const fromNext = deviceFromNextRequest({
      headers: new Headers({ "user-agent": IPHONE }),
      url: URL_PWA,
    });
    const fromHono = deviceFromContext({
      req: { raw: { headers: new Headers({ "user-agent": IPHONE }), url: URL_PWA } },
    });
    expect(fromNext).toEqual(fromHono);
    expect(fromNext.launch).toBe("installed");
  });
});
