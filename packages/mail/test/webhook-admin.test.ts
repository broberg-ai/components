// components-F005.21 — webhook admin over Resend's headless webhook API, and a
// verifier that takes the old AND new secret during a rotation.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWebhookAdmin, handleMailWebhook, verifyWebhook } from "../src/webhook";

const WH = "4dd369bc-aa82-4ff3-97de-514ae3000ee0";
const KEY = "re_test_full_access";

type Call = { url: string; method: string; auth: string | null };
function fakeFetch(route: (url: string, method: string) => { status: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const h = new Headers(init?.headers);
    calls.push({ url, method, auth: h.get("authorization") });
    const r = route(url, method);
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { f, calls };
}
const admin = (f: typeof fetch, apiKey: string | undefined = KEY) => createWebhookAdmin({ apiKey, webhookId: WH, fetch: f });
const BASE = `https://api.resend.com/webhooks/${WH}`;

describe("createWebhookAdmin — the documented path, method and key", () => {
  it.each([
    ["listEvents", (a: ReturnType<typeof admin>) => a.listEvents({ limit: 50, after: "msg_a" }), "GET", `${BASE}/events?limit=50&after=msg_a`, { object: "list", has_more: false, data: [] }],
    ["getEvent", (a: ReturnType<typeof admin>) => a.getEvent("msg_1"), "GET", `${BASE}/events/msg_1`, { id: "msg_1" }],
    ["listAttempts", (a: ReturnType<typeof admin>) => a.listAttempts("msg_1", { limit: 5 }), "GET", `${BASE}/events/msg_1/attempts?limit=5`, { data: [] }],
    ["replay", (a: ReturnType<typeof admin>) => a.replay("msg_1"), "POST", `${BASE}/events/msg_1/replay`, { object: "webhook_event", id: "msg_1" }],
    ["rotateSecret", (a: ReturnType<typeof admin>) => a.rotateSecret(), "POST", `${BASE}/signing-secret/rotate`, { object: "webhook", id: WH, signing_secret: "whsec_new" }],
  ] as const)("%s", async (_n, run, method, url, body) => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body }));
    const r = await run(admin(f));
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ url, method, auth: `Bearer ${KEY}` }]);
  });

  it("limit is clamped to the documented 1–100", async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { data: [] } }));
    await admin(f).listEvents({ limit: 500 });
    await admin(f).listEvents({ limit: 0 });
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/events?limit=100`, `${BASE}/events?limit=1`]);
  });
});

describe("typed answers (the documented example responses)", () => {
  it("listEvents", async () => {
    const { f } = fakeFetch(() => ({
      status: 200,
      body: {
        object: "list",
        has_more: true,
        data: [
          { id: "msg_1srOsB4mXhCqCVwAxYRNnpFZhb3", type: "email.delivered", created_at: "2026-08-22T15:28:00.000Z", status: "failed" },
          { id: "msg_1srOrx2ZWZBpBUvZwXKQmoEYga2", type: "email.sent", created_at: "2026-08-22T15:27:42.000Z", status: "success" },
        ],
      },
    }));
    expect(await admin(f).listEvents()).toEqual({
      ok: true,
      value: {
        hasMore: true,
        items: [
          { id: "msg_1srOsB4mXhCqCVwAxYRNnpFZhb3", type: "email.delivered", createdAt: "2026-08-22T15:28:00.000Z", status: "failed" },
          { id: "msg_1srOrx2ZWZBpBUvZwXKQmoEYga2", type: "email.sent", createdAt: "2026-08-22T15:27:42.000Z", status: "success" },
        ],
      },
    });
  });

  it("getEvent carries nextAttemptAt and the payload untouched", async () => {
    const payload = { type: "email.sent", data: { email_id: "571f", to: ["a@b.dk"] } };
    const { f } = fakeFetch(() => ({
      status: 200,
      body: { object: "webhook_event", id: "msg_1", type: "email.sent", created_at: "2026-08-22T15:28:00.000Z", status: "attempting", next_attempt_at: "2026-08-22T15:33:00.000Z", payload },
    }));
    expect(await admin(f).getEvent("msg_1")).toEqual({
      ok: true,
      value: { id: "msg_1", type: "email.sent", createdAt: "2026-08-22T15:28:00.000Z", status: "attempting", nextAttemptAt: "2026-08-22T15:33:00.000Z", payload },
    });
  });

  it("listAttempts", async () => {
    const { f } = fakeFetch(() => ({
      status: 200,
      body: { object: "list", has_more: false, data: [{ id: "atmpt_1", http_status_code: 500, response: "{\"ok\":false}", sent_at: "2026-08-22T15:33:12.000Z" }] },
    }));
    expect(await admin(f).listAttempts("msg_1")).toEqual({
      ok: true,
      value: { hasMore: false, items: [{ id: "atmpt_1", httpStatusCode: 500, response: "{\"ok\":false}", sentAt: "2026-08-22T15:33:12.000Z" }] },
    });
  });

  it("rotateSecret returns the new secret", async () => {
    const { f } = fakeFetch(() => ({ status: 200, body: { object: "webhook", id: WH, signing_secret: "whsec_new" } }));
    expect(await admin(f).rotateSecret()).toEqual({ ok: true, value: { signingSecret: "whsec_new" } });
  });
});

describe("failures are told apart, and nothing throws", () => {
  it("404 → not_found", async () => {
    const { f } = fakeFetch(() => ({ status: 404, body: {} }));
    expect(await admin(f).getEvent("nope")).toEqual({ ok: false, reason: "not_found", detail: "the provider has no such webhook or event" });
  });
  it.each([401, 403])("%s → could_not_ask, and it says a send-only key cannot read", async (status) => {
    const { f } = fakeFetch(() => ({ status, body: {} }));
    const r = await admin(f).listEvents();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("could_not_ask");
      expect(r.detail).toContain("send-only key answers 401");
      expect(r.detail).toContain("this is NOT an empty result");
    }
  });
  it("5xx, a network error, no key → could_not_ask", async () => {
    expect(await admin(fakeFetch(() => ({ status: 502 })).f).listEvents()).toEqual({ ok: false, reason: "could_not_ask", detail: "the provider answered HTTP 502" });
    expect(await admin(fakeFetch(() => new Error("ECONNRESET")).f).replay("x")).toEqual({ ok: false, reason: "could_not_ask", detail: "could not reach the provider: ECONNRESET" });
    const { f, calls } = fakeFetch(() => ({ status: 200, body: {} }));
    expect(await admin(f, "").listEvents()).toEqual({ ok: false, reason: "could_not_ask", detail: "no API key, so the provider was never asked" });
    expect(calls).toEqual([]);
  });
});

describe("replayFailed — only what failed, bounded", () => {
  const ev = (id: string, status: string) => ({ id, type: "email.delivered", created_at: "2026-10-03T10:00:00Z", status });
  function twoPages() {
    return fakeFetch((url, method) => {
      if (method === "POST") return { status: 200, body: { object: "webhook_event", id: url.split("/events/")[1]!.split("/")[0] } };
      if (url.includes("after=e3")) return { status: 200, body: { has_more: false, data: [ev("e4", "failed"), ev("e5", "pending")] } };
      return { status: 200, body: { has_more: true, data: [ev("e1", "failed"), ev("e2", "success"), ev("e3", "attempting")] } };
    });
  }

  it("replays every failed event across pages, and nothing else", async () => {
    const { f, calls } = twoPages();
    const r = await admin(f).replayFailed();
    expect(r).toEqual({ replayed: ["e1", "e4"], errors: [], scanned: 5, complete: true });
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual([`${BASE}/events/e1/replay`, `${BASE}/events/e4/replay`]);
  });

  it("stops at max and says it is not complete", async () => {
    const { f, calls } = twoPages();
    const r = await admin(f).replayFailed({ max: 1 });
    expect(r.replayed).toEqual(["e1"]);
    expect(r.complete).toBe(false);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("a replay that fails is reported, not swallowed", async () => {
    const { f } = fakeFetch((url, method) =>
      method === "POST" ? { status: 422 } : { status: 200, body: { has_more: false, data: [ev("e1", "failed")] } },
    );
    expect(await admin(f).replayFailed()).toEqual({ replayed: [], errors: [{ id: "e1", detail: "the provider answered HTTP 422" }], scanned: 1, complete: true });
  });

  it("a listing it could not read is reported as such, never as 'nothing failed'", async () => {
    const { f } = fakeFetch(() => ({ status: 401 }));
    const r = await admin(f).replayFailed();
    expect(r.replayed).toEqual([]);
    expect(r.complete).toBe(false);
    expect(r.listError).toContain("send-only key");
  });
});

describe("verifyWebhook during a rotation — old and new secret", () => {
  const OLD = `whsec_${Buffer.from("den-gamle-noegle").toString("base64")}`;
  const NEW = `whsec_${Buffer.from("den-nye-noegle-xx").toString("base64")}`;
  const OTHER = `whsec_${Buffer.from("en-helt-anden-noegle").toString("base64")}`;
  function signedBy(secret: string, body = '{"type":"email.delivered","data":{}}') {
    const id = "msg_r";
    const at = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${at}.${body}`).digest("base64");
    return { body, headers: { "svix-id": id, "svix-timestamp": at, "svix-signature": `v1,${sig}` } };
  }

  it("a list with old and new accepts a payload signed by either", () => {
    for (const s of [OLD, NEW]) {
      const { body, headers } = signedBy(s);
      expect(verifyWebhook(body, headers, [OLD, NEW])).toEqual({ ok: true });
    }
  });
  it("a payload signed by neither is refused", () => {
    const { body, headers } = signedBy(OTHER);
    expect(verifyWebhook(body, headers, [OLD, NEW])).toEqual({ ok: false, reason: "no_signature_match" });
  });
  it("an empty list is no secret — refused, never accept-everything", () => {
    const { body, headers } = signedBy(OLD);
    expect(verifyWebhook(body, headers, [])).toEqual({ ok: false, reason: "no_secret" });
    expect(verifyWebhook(body, headers, [""])).toEqual({ ok: false, reason: "no_secret" });
  });
  it("handleMailWebhook takes the list too", async () => {
    const { body, headers } = signedBy(NEW);
    const r = await handleMailWebhook(body, headers, { secret: [OLD, NEW], onEvent: () => {} });
    expect(r.status).toBe(202);
  });
});
