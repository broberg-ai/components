// F041.4 — a rejected token arrives as a REDIRECT to the login page, not a 401.
// A real local HTTP server, so fetch's own redirect behaviour is what is tested
// (a mocked fetch would only test our mock). Measured against the live service
// 15/9: Bearer <wrong> → 307 → /login → 200, 12,057 bytes of HTML.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCron, CronError } from "../src/index";

const LOGIN_HTML = '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"><title>Sign in</title></head><body>' + "x".repeat(12_000) + "</body></html>";

let server: Server;
let base = "";
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/api/jobs/moved")) {
      res.writeHead(308, { location: "/api/v2/jobs/moved" }).end();
    } else if (req.url?.startsWith("/api/jobs")) {
      res.writeHead(307, { location: "/login" }).end(); // what cronjobs does with a bad token
    } else if (req.url === "/login") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(LOGIN_HTML);
    } else if (req.url === "/api/html") {
      res.writeHead(200, { "content-type": "text/html" }).end(LOGIN_HTML);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("a bad token is a redirect, and the client says so (F041.4)", () => {
  it("307 → /login throws a CronError with status 307 and the Location — it does not resolve with HTML", async () => {
    const cron = createCron({ baseUrl: base, token: "wrong" });
    const err = await cron.listJobs().then(
      (v) => ({ resolved: v }),
      (e) => e,
    );
    expect(err).toBeInstanceOf(CronError);
    expect((err as CronError).status).toBe(307);
    expect((err as CronError).location).toBe("/login");
    expect((err as CronError).message).toContain("not accepted");
  });

  it("a LEGITIMATE redirect (308 to a moved endpoint) names status + target and does NOT claim the token is bad", async () => {
    const cron = createCron({ baseUrl: base, token: "fine" });
    const err = (await cron.getJob("moved").catch((e) => e)) as CronError;
    expect(err).toBeInstanceOf(CronError);
    expect(err.status).toBe(308);
    expect(err.location).toBe("/api/v2/jobs/moved");
    expect(err.message).toContain("/api/v2/jobs/moved");
    expect(err.message).not.toMatch(/token/i);
  });
});

describe("a 200 that is not JSON is not data (F041.4)", () => {
  it("throws naming the content-type and the first ~80 chars — not the whole page, not a bare 'unexpected error'", async () => {
    // A custom fetch that answers 200 HTML for the client's path, as a CDN error page would.
    const fetchHtml = ((_: RequestInfo | URL, init?: RequestInit) =>
      fetch(`${base}/api/html`, init)) as typeof fetch;
    const cron = createCron({ baseUrl: base, token: "t", fetch: fetchHtml });
    const err = (await cron.listJobs().catch((e) => e)) as CronError;
    expect(err).toBeInstanceOf(CronError);
    expect(err.status).toBe(200);
    expect(err.message).toContain("cron_not_json");
    expect(err.message).toContain("text/html");
    expect(err.message).toContain("<!DOCTYPE html>");
    expect(err.message.length).toBeLessThan(300); // not the 12 kB page
    expect(err.message).not.toMatch(/unexpected error/i);
  });
});
