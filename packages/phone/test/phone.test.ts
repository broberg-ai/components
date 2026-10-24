// F107.1 — @broberg/phone against a fake 46elks (injected fetch). Facts it
// mirrors are from 46elks' docs: make-call, voice-ivr, call-actions.
import { describe, expect, it } from "vitest";
import { createPhone, classifyStatus, maskNumber } from "../src/index";

const SECRET = "s3cret-token-0123456789";
const CFG = { username: "u123", password: "p456", from: "+4570000000", webhookSecret: SECRET };

function fakeElks(status = 200, body = '{"id":"c1","state":"ongoing","direction":"outgoing"}') {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { status, ok: status < 300, text: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
}
const OPTS = { audioUrl: "https://buzz.example/a/alarm-1.mp3", webhookBase: "https://buzz.example/hooks/elks" };

describe("status at boot", () => {
  it("nothing → no-keys; bad caller id or short secret → invalid-keys; all good → ready", () => {
    expect(createPhone().status).toBe("no-keys");
    expect(createPhone({ ...CFG, from: "70000000" }).status).toBe("invalid-keys");
    expect(createPhone({ ...CFG, webhookSecret: "short" }).status).toBe("invalid-keys");
    expect(createPhone(CFG).status).toBe("ready");
  });
  it("ship-dark: a call without keys is a failed result, not a crash, and nothing is sent", async () => {
    const g = fakeElks();
    expect(await createPhone({ fetch: g.f }).call("+4512345678", OPTS)).toEqual({ ok: false, kind: "auth", statusCode: null, reason: "no-keys" });
    expect(g.calls.length).toBe(0);
  });
});

describe("call — the request 46elks gets", () => {
  it("POST /a1/calls, Basic auth, form body with from/to, voice_start = ivr action, whenhangup", async () => {
    const g = fakeElks();
    const r = await createPhone({ ...CFG, fetch: g.f }).call("+4512345678", { ...OPTS, ackDigit: "1", timeoutSeconds: 45 });
    expect(r).toEqual({ ok: true, callId: "c1" });
    const { url, init } = g.calls[0];
    expect(url).toBe("https://api.46elks.com/a1/calls");
    expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("u123:p456").toString("base64")}`);
    const form = new URLSearchParams(String(init.body));
    expect([form.get("from"), form.get("to"), form.get("timeout")]).toEqual(["+4570000000", "+4512345678", "45"]);
    const ivr = JSON.parse(form.get("voice_start")!);
    expect(ivr).toEqual({
      ivr: OPTS.audioUrl, digits: 1, timeout: 10, repeat: 3,
      next: `https://buzz.example/hooks/elks?event=ivr&t=${SECRET}&ack=1`,
    });
    expect(form.get("whenhangup")).toBe(`https://buzz.example/hooks/elks?event=hangup&t=${SECRET}`);
  });
  it("the key-press wait is clamped to 46elks' 1–30 s", async () => {
    const g = fakeElks();
    await createPhone({ ...CFG, fetch: g.f }).call("+4512345678", { ...OPTS, inputTimeoutSeconds: 99 });
    expect(JSON.parse(new URLSearchParams(String(g.calls[0].init.body)).get("voice_start")!).timeout).toBe(30);
  });
  it("a bad number, a bad ack key or a non-URL is a payload failure before anything is sent", async () => {
    const g = fakeElks();
    const p = createPhone({ ...CFG, fetch: g.f });
    expect(await p.call("12345678", OPTS)).toMatchObject({ ok: false, kind: "payload" });
    expect(await p.call("+4512345678", { ...OPTS, ackDigit: "12" })).toMatchObject({ ok: false, kind: "payload" });
    expect(await p.call("+4512345678", { ...OPTS, audioUrl: "alarm.mp3" })).toMatchObject({ ok: false, kind: "payload" });
    expect(g.calls.length).toBe(0);
  });
  it("401 auth · 400 payload · 429/500 transient · network transient — and the number is masked in the reason", async () => {
    for (const [status, kind] of [[401, "auth"], [400, "payload"], [429, "transient"], [500, "transient"]] as const) {
      const r = await createPhone({ ...CFG, fetch: fakeElks(status, "nope").f }).call("+4512345678", OPTS);
      expect(r).toMatchObject({ ok: false, kind, statusCode: status });
      expect(JSON.stringify(r)).not.toContain("+4512345678");
      expect(JSON.stringify(r)).toContain("+45******78");
    }
    const boom = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    expect(await createPhone({ ...CFG, fetch: boom }).call("+4512345678", OPTS)).toMatchObject({ ok: false, kind: "transient", statusCode: null });
  });
  it("a 200 without a call id is not a success", async () => {
    expect(await createPhone({ ...CFG, fetch: fakeElks(200, "{}").f }).call("+4512345678", OPTS)).toMatchObject({ ok: false, kind: "transient" });
  });
});

const HANGUP_URL = `https://buzz.example/hooks/elks?event=hangup&t=${SECRET}`;
const IVR_URL = `https://buzz.example/hooks/elks?event=ivr&t=${SECRET}&ack=1`;

describe("webhooks — 46elks does not sign them, so the token decides", () => {
  const p = createPhone(CFG);
  const body = { id: "c1", state: "success", start: "2026-10-24T10:00:00", duration: "12" };
  it("a hook with NO token is refused", () => {
    expect(p.parseHangup(body, "https://buzz.example/hooks/elks?event=hangup")).toEqual({ ok: false, reason: "bad-token" });
  });
  it("a hook with a WRONG token is refused — even one character off, for both hooks", () => {
    expect(p.parseHangup(body, HANGUP_URL.replace(SECRET, "s3cret-token-0123456780"))).toEqual({ ok: false, reason: "bad-token" });
    expect(p.parseIvr({ callid: "c1", result: "1" }, IVR_URL.replace(SECRET, "x"))).toEqual({ ok: false, reason: "bad-token" });
  });
  it("hangup outcome: success → answered, busy, failed; an unknown state is refused", () => {
    expect(p.parseHangup(new URLSearchParams({ id: "c1", state: "success", start: "2026-10-24T10:00:00", duration: "12" }), HANGUP_URL))
      .toEqual({ ok: true, event: { callId: "c1", outcome: "answered", neverAnswered: false, durationSeconds: 12 } });
    expect(p.parseHangup({ id: "c2", state: "busy" }, HANGUP_URL)).toMatchObject({ ok: true, event: { outcome: "busy" } });
    expect(p.parseHangup({ id: "c3", state: "failed", duration: "0" }, HANGUP_URL)).toMatchObject({ ok: true, event: { outcome: "failed" } });
    expect(p.parseHangup({ id: "c4", state: "weird" }, HANGUP_URL)).toEqual({ ok: false, reason: "bad-body" });
  });
  it("neverAnswered comes from the missing pickup time, not from the state", () => {
    expect(p.parseHangup({ id: "c5", state: "failed" }, HANGUP_URL)).toMatchObject({ ok: true, event: { neverAnswered: true } });
    expect(p.parseHangup({ id: "c6", state: "failed", start: "2026-10-24T10:00:00" }, HANGUP_URL)).toMatchObject({ ok: true, event: { neverAnswered: false } });
  });
  it("key press: only the ack digit acknowledges; another key, no input or failed does not", () => {
    expect(p.parseIvr(new URLSearchParams({ callid: "c1", from: "+4570000000", result: "1" }), IVR_URL)).toEqual({ ok: true, event: { callId: "c1", acknowledged: true, digits: "1" } });
    expect(p.parseIvr({ callid: "c1", result: "2" }, IVR_URL)).toMatchObject({ ok: true, event: { acknowledged: false, digits: "2" } });
    expect(p.parseIvr({ callid: "c1", result: "failed", why: "noinput" }, IVR_URL)).toEqual({ ok: true, event: { callId: "c1", acknowledged: false, digits: "", why: "noinput" } });
    expect(p.parseIvr({ callid: "c1", result: "5" }, IVR_URL.replace("ack=1", "ack=5"))).toMatchObject({ ok: true, event: { acknowledged: true } });
  });
  it("a phone without keys accepts no webhook at all", () => {
    expect(createPhone().parseIvr({ callid: "c1", result: "1" }, IVR_URL)).toEqual({ ok: false, reason: "bad-token" });
  });
});

describe("helpers", () => {
  it("classifyStatus and maskNumber", () => {
    expect([200, 201, 401, 403, 400, 404, 429, 500, 503].map(classifyStatus)).toEqual(["ok", "ok", "auth", "auth", "payload", "payload", "transient", "transient", "transient"]);
    expect(maskNumber("+4512345678")).toBe("+45******78");
  });
});
