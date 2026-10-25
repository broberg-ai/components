// F108.1 — the guard lens-daemon and auth-relay each carried a copy of.
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { allowedHosts, checkLocalRequest, guardResponse } from "../src/index";
import { localRequestGuard } from "../src/hono";

const PORT = 7475;
const req = (method: string, host: string | null, contentType?: string, extra: Record<string, string> = {}) => {
  const headers = new Headers(extra);
  if (host !== null) headers.set("host", host);
  if (contentType) headers.set("content-type", contentType);
  return new Request(`http://127.0.0.1:${PORT}/x`, { method, headers, body: method === "GET" || method === "HEAD" || !contentType ? undefined : "{}" });
};

describe("Host — only this machine's loopback, on THIS port", () => {
  for (const h of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`, `LOCALHOST:${PORT}`]) {
    it(`accepts ${h}`, () => expect(checkLocalRequest(req("GET", h), { port: PORT })).toBeNull());
  }
  for (const h of ["evil.example:7475", "127.0.0.1:9999", "127.0.0.1", "localhost", "127.0.0.1.nip.io:7475", "0.0.0.0:7475"]) {
    it(`refuses ${h} with 421 and names the host`, () => {
      const r = checkLocalRequest(req("GET", h), { port: PORT });
      expect(r).toEqual({ status: 421, reason: "host", host: h.toLowerCase() });
    });
  }
  it("a missing Host header falls back to the URL's host (Bun's behaviour) and is judged the same way", () => {
    expect(checkLocalRequest(req("GET", null), { port: PORT })).toBeNull();
    const other = new Request("http://evil.example:7475/x");
    expect(checkLocalRequest(other, { port: PORT })?.status).toBe(421);
  });
  it("two daemons with different ports refuse each other's Host", () => {
    expect(checkLocalRequest(req("GET", "127.0.0.1:4000"), { port: 4001 })?.status).toBe(421);
    expect(checkLocalRequest(req("GET", "127.0.0.1:4001"), { port: 4000 })?.status).toBe(421);
  });
  it("a nonsense port throws at setup, not at the first request", () => {
    expect(() => allowedHosts(0)).toThrow(RangeError);
    expect(() => allowedHosts(70000)).toThrow(RangeError);
    expect(() => allowedHosts(NaN)).toThrow(RangeError);
  });
});

describe("writes — application/json only (a form cannot send it without a preflight)", () => {
  const H = `127.0.0.1:${PORT}`;
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const t of ["text/plain", "multipart/form-data; boundary=x", "application/x-www-form-urlencoded"]) {
      it(`${m} with ${t.split(";")[0]} → 415`, () => {
        const r = checkLocalRequest(req(m, H, t), { port: PORT });
        expect(r?.status).toBe(415);
      });
    }
    it(`${m} with application/json; charset=utf-8 passes`, () =>
      expect(checkLocalRequest(req(m, H, "application/json; charset=utf-8"), { port: PORT })).toBeNull());
  }
  it("POST with NO content type → 415", () => expect(checkLocalRequest(req("POST", H), { port: PORT })?.status).toBe(415));
  it("a body-less DELETE (MCP session close) passes — DELETE always needs a preflight cross-site", () =>
    expect(checkLocalRequest(req("DELETE", H), { port: PORT })).toBeNull());
  it("…but a DELETE that DOES carry a body must be JSON", () =>
    expect(checkLocalRequest(req("DELETE", H, undefined, { "content-length": "2" }), { port: PORT })?.status).toBe(415));
  it("GET and HEAD need no content type", () => {
    expect(checkLocalRequest(req("GET", H), { port: PORT })).toBeNull();
    expect(checkLocalRequest(req("HEAD", H), { port: PORT })).toBeNull();
  });
  it("Host is judged BEFORE the content type — a rebound page learns nothing about the write rule", () =>
    expect(checkLocalRequest(req("POST", "evil.example:7475", "text/plain"), { port: PORT })?.status).toBe(421));
});

describe("adapters", () => {
  it("guardResponse: JSON refusal with lens' default body, or null", async () => {
    const res = guardResponse(req("GET", "evil.example:7475"), { port: PORT, name: "lens daemon" })!;
    expect(res.status).toBe(421);
    expect(await res.json()).toEqual({ ok: false, error: 'lens daemon: refused Host "evil.example:7475" — only this machine\'s loopback address may call it' });
    expect(guardResponse(req("GET", `localhost:${PORT}`), { port: PORT })).toBeNull();
  });

  it("Hono middleware: refuses with the status and lets a legitimate call through; body is shapeable (auth-relay's {error})", async () => {
    const app = new Hono();
    app.use("*", localRequestGuard({ port: PORT, name: "ARS", body: (_r, message) => ({ error: message }) }));
    app.post("/x", (c) => c.json({ ok: true }));
    const bad = await app.request(`http://127.0.0.1:${PORT}/x`, { method: "POST", headers: { host: `127.0.0.1:${PORT}`, "content-type": "text/plain" }, body: "{}" });
    expect(bad.status).toBe(415);
    expect(await bad.json()).toEqual({ error: "ARS: a write must be Content-Type: application/json" });
    const good = await app.request(`http://127.0.0.1:${PORT}/x`, { method: "POST", headers: { host: `127.0.0.1:${PORT}`, "content-type": "application/json" }, body: "{}" });
    expect(good.status).toBe(200);
    const rebound = await app.request(`http://127.0.0.1:${PORT}/x`, { method: "POST", headers: { host: "evil.example:7475", "content-type": "application/json" }, body: "{}" });
    expect(rebound.status).toBe(421);
  });

  it("auth-relay's own contract case, verbatim: Host evil.example (no port) → 421; a text/plain write → 415", async () => {
    const app = new Hono();
    app.use("*", localRequestGuard({ port: PORT }));
    app.post("/v1/asks", (c) => c.json({ ok: true }));
    const url = `http://127.0.0.1:${PORT}/v1/asks`;
    const host = await app.request(url, { method: "POST", headers: { "content-type": "application/json", host: "evil.example" }, body: "{}" });
    expect(host.status).toBe(421);
    const type = await app.request(url, { method: "POST", headers: { host: `127.0.0.1:${PORT}`, "content-type": "text/plain" }, body: "{}" });
    expect(type.status).toBe(415);
  });
});
