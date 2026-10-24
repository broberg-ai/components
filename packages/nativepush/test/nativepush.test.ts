// F106.1 — @broberg/nativepush against a local HTTP/2 server (APNs) and an
// injected fetch (Google OAuth + FCM). Keys are generated here; nothing real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, constants, type Http2Server } from "node:http2";
import { generateKeyPairSync, verify, createPublicKey } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createNativePushSender, classifyApns, classifyFcm, apnsPayload, fcmMessage, type NativeTarget } from "../src/index";

const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const P8 = ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const RSA_PEM = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SA = { project_id: "buzz-test", client_email: "push@buzz-test.iam.gserviceaccount.com", private_key: RSA_PEM, token_uri: "https://oauth.test/token" };

// ── a fake APNs: answers per token from this table ─────────────────────────
type Seen = { path: string; headers: Record<string, string | string[] | undefined>; body: string };
const seen: Seen[] = [];
const APNS_ANSWERS: Record<string, [number, string?]> = {
  ok1: [200], ok2: [200], gone: [410, "Unregistered"], badtoken: [400, "BadDeviceToken"],
  authbad: [403, "InvalidProviderToken"], big: [413, "PayloadTooLarge"], busy: [429, "TooManyRequests"], down: [500, "InternalServerError"],
};
let server: Http2Server;
let host: string;
beforeAll(async () => {
  server = createServer();
  server.on("stream", (stream, headers) => {
    let body = "";
    stream.setEncoding("utf8");
    stream.on("data", (c) => (body += c));
    stream.on("end", () => {
      const path = String(headers[constants.HTTP2_HEADER_PATH]);
      seen.push({ path, headers, body });
      const [status, reason] = APNS_ANSWERS[path.split("/").pop()!] ?? [200];
      stream.respond({ ":status": status });
      stream.end(reason ? JSON.stringify({ reason }) : "");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const apns = () => ({ key: P8, keyId: "ABC123DEFG", teamId: "TEAM123456", topic: "dk.buzz.app", production: false, host });
const ios = (token: string): NativeTarget => ({ platform: "ios", token });
const android = (token: string): NativeTarget => ({ platform: "android", token });

// ── a fake Google: OAuth token endpoint + FCM v1 ───────────────────────────
function fakeGoogle(answers: Record<string, [number, string?]> = {}, tokenStatus = 200) {
  const calls: { url: string; body: string; auth?: string }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = String(init.body ?? "");
    calls.push({ url, body, auth: (init.headers as Record<string, string>)?.authorization });
    const json = (status: number, obj: unknown) => ({ ok: status < 300, status, json: async () => obj }) as unknown as Response;
    if (url === SA.token_uri) return tokenStatus === 200 ? json(200, { access_token: "ya29.test", expires_in: 3600 }) : json(tokenStatus, { error: "invalid_grant" });
    const token = JSON.parse(body).message.token as string;
    const [status, code] = answers[token] ?? [200];
    return status === 200 ? json(200, { name: "projects/buzz-test/messages/1" }) : json(status, { error: { status: code, details: code ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: code }] : [] } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("status at boot — ready / no-keys / invalid-keys, synchronously", () => {
  it("nothing configured → no-keys on both", () => {
    expect(createNativePushSender().status).toEqual({ apns: "no-keys", fcm: "no-keys" });
  });
  it("valid keys → ready", () => {
    expect(createNativePushSender({ apns: apns(), fcm: { serviceAccount: JSON.stringify(SA) } }).status).toEqual({ apns: "ready", fcm: "ready" });
  });
  it("a broken .p8, an RSA key passed as .p8, a service account without a key → invalid-keys", () => {
    expect(createNativePushSender({ apns: { ...apns(), key: "not a key" } }).status.apns).toBe("invalid-keys");
    expect(createNativePushSender({ apns: { ...apns(), key: RSA_PEM } }).status.apns).toBe("invalid-keys");
    expect(createNativePushSender({ fcm: { serviceAccount: { ...SA, private_key: "" } } }).status.fcm).toBe("invalid-keys");
    expect(createNativePushSender({ fcm: { serviceAccount: "{not json" } }).status.fcm).toBe("invalid-keys");
  });
});

describe("ship-dark — no keys never crash, and say so per token", () => {
  it("every target fails as auth / no-keys, nothing is dead, allFailed is true", async () => {
    const r = await createNativePushSender().send([ios("a"), android("b")], { title: "t" });
    expect(r.sent).toBe(0);
    expect(r.dead).toEqual([]);
    expect(r.failed.map((f) => [f.platform, f.kind, f.reason, f.statusCode])).toEqual([["ios", "auth", "no-keys", null], ["android", "auth", "no-keys", null]]);
    expect(r.allFailed).toBe(true);
  });
  it("an empty send is not a failure", async () => {
    expect(await createNativePushSender().send([], { title: "t" })).toEqual({ sent: 0, dead: [], failed: [], allFailed: false });
  });
});

describe("APNs (ported from buddy) — the request", () => {
  it("one ES256 provider token that verifies with the public key, and the right headers + payload", async () => {
    seen.length = 0;
    const s = createNativePushSender({ apns: apns(), now: () => 1_800_000_000_000 });
    const r = await s.send([ios("ok1")], {
      title: "Alarm", body: "Pumpe 3", level: "critical", sound: { critical: true, volume: 0.8 }, mutableContent: true,
      data: { alarmId: "a1" }, collapseId: "a1", ttlSeconds: 60,
    });
    expect(r).toEqual({ sent: 1, dead: [], failed: [], allFailed: false });
    const h = seen[0].headers;
    expect(seen[0].path).toBe("/3/device/ok1");
    expect([h["apns-topic"], h["apns-push-type"], h["apns-priority"], h["apns-collapse-id"], h["apns-expiration"]]).toEqual(["dk.buzz.app", "alert", "10", "a1", String(1_800_000_000 + 60)]);
    const jwt = String(h.authorization).replace(/^bearer /, "");
    const [hd, cl, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(hd, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(JSON.parse(Buffer.from(cl, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: 1_800_000_000 });
    const ok = verify("sha256", Buffer.from(`${hd}.${cl}`), { key: createPublicKey(ec.privateKey), dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"));
    expect(ok).toBe(true);
    expect(JSON.parse(seen[0].body)).toEqual({
      alarmId: "a1",
      aps: { alert: { title: "Alarm", body: "Pumpe 3" }, sound: { critical: 1, name: "default", volume: 0.8 }, "interruption-level": "critical", "mutable-content": 1 },
    });
  });
  it("the provider token is reused under 50 minutes and re-minted after", async () => {
    seen.length = 0;
    let t = 1_800_000_000_000;
    const s = createNativePushSender({ apns: apns(), now: () => t });
    await s.send([ios("ok1")], { title: "a" });
    t += 49 * 60_000;
    await s.send([ios("ok1")], { title: "b" });
    t += 2 * 60_000;
    await s.send([ios("ok1")], { title: "c" });
    const auths = seen.map((x) => x.headers.authorization);
    expect(auths[0]).toBe(auths[1]);
    expect(auths[2]).not.toBe(auths[1]);
  });
  it("passive goes at priority 5; time-sensitive is a plain level without a critical sound", async () => {
    seen.length = 0;
    const s = createNativePushSender({ apns: apns() });
    await s.send([ios("ok1")], { title: "x", level: "passive" });
    await s.send([ios("ok2")], { title: "x", level: "time-sensitive", sound: "default" });
    expect(seen[0].headers["apns-priority"]).toBe("5");
    expect(JSON.parse(seen[1].body).aps).toEqual({ alert: { title: "x" }, sound: "default", "interruption-level": "time-sensitive" });
  });
});

describe("APNs — every answer lands in the right list", () => {
  it("200 sent · 410 dead · 403 auth · 400 BadDeviceToken payload (NOT dead) · 413 payload · 429/500 transient", async () => {
    const s = createNativePushSender({ apns: apns() });
    const r = await s.send(["ok1", "gone", "authbad", "badtoken", "big", "busy", "down"].map(ios), { title: "t" });
    expect(r.sent).toBe(1);
    expect(r.dead).toEqual([ios("gone")]);
    const by = Object.fromEntries(r.failed.map((f) => [f.token, [f.kind, f.statusCode, f.reason]]));
    expect(by).toEqual({
      authbad: ["auth", 403, "InvalidProviderToken"],
      badtoken: ["payload", 400, "BadDeviceToken"],
      big: ["payload", 413, "PayloadTooLarge"],
      busy: ["transient", 429, "TooManyRequests"],
      down: ["transient", 500, "InternalServerError"],
    });
    expect(r.allFailed).toBe(false);
  });
  it("an unreachable APNs is transient for every token, never a throw", async () => {
    const s = createNativePushSender({ apns: { ...apns(), host: "http://127.0.0.1:1" } });
    const r = await s.send([ios("a"), ios("b")], { title: "t" });
    expect(r.failed.map((f) => [f.kind, f.statusCode])).toEqual([["transient", null], ["transient", null]]);
    expect(r.allFailed).toBe(true);
  });
  it("classifyApns, directly", () => {
    expect([200, 410, 401, 403, 400, 413, 429, 500, 503].map(classifyApns)).toEqual(["sent", "dead", "auth", "auth", "payload", "payload", "transient", "transient", "transient"]);
  });
});

describe("FCM HTTP v1", () => {
  it("OAuth via a RS256 service-account JWT, fetched ONCE for several sends", async () => {
    const g = fakeGoogle();
    const s = createNativePushSender({ fcm: { serviceAccount: SA, fetch: g.f } });
    await s.send([android("t1"), android("t2")], { title: "a" });
    await s.send([android("t3")], { title: "b" });
    const tokenCalls = g.calls.filter((c) => c.url === SA.token_uri);
    expect(tokenCalls.length).toBe(1);
    const assertion = new URLSearchParams(tokenCalls[0].body).get("assertion")!;
    const [hd, cl, sig] = assertion.split(".");
    const claims = JSON.parse(Buffer.from(cl, "base64url").toString());
    expect([claims.iss, claims.aud, claims.scope]).toEqual([SA.client_email, SA.token_uri, "https://www.googleapis.com/auth/firebase.messaging"]);
    expect(verify("sha256", Buffer.from(`${hd}.${cl}`), createPublicKey(rsa.privateKey), Buffer.from(sig, "base64url"))).toBe(true);
    const sends = g.calls.filter((c) => c.url !== SA.token_uri);
    expect(sends.map((c) => c.url)).toEqual(Array(3).fill("https://fcm.googleapis.com/v1/projects/buzz-test/messages:send"));
    expect(sends.every((c) => c.auth === "Bearer ya29.test")).toBe(true);
  });
  it("high priority always; data-only carries title/body in data and has no notification block", () => {
    const m = fcmMessage("tok", { title: "Alarm", body: "Pumpe 3", data: { alarmId: "a1" }, android: { dataOnly: true }, ttlSeconds: 30 }) as { message: Record<string, unknown> };
    expect(m.message).toEqual({ token: "tok", data: { alarmId: "a1", title: "Alarm", body: "Pumpe 3" }, android: { priority: "high", ttl: "30s" } });
    const n = fcmMessage("tok", { title: "Hej", android: { channelId: "alarms" } }) as { message: Record<string, unknown> };
    expect(n.message).toEqual({ token: "tok", notification: { title: "Hej", body: undefined }, android: { priority: "high", notification: { channel_id: "alarms" } } });
  });
  it("UNREGISTERED dead · 401/403 auth · SENDER_ID_MISMATCH auth · 400 payload · 429/503 transient", async () => {
    const g = fakeGoogle({ gone: [404, "UNREGISTERED"], denied: [403, "PERMISSION_DENIED"], other: [403, "SENDER_ID_MISMATCH"], bad: [400, "INVALID_ARGUMENT"], slow: [429, "QUOTA_EXCEEDED"], down: [503, "UNAVAILABLE"] });
    const s = createNativePushSender({ fcm: { serviceAccount: SA, fetch: g.f } });
    const r = await s.send(["ok", "gone", "denied", "other", "bad", "slow", "down"].map(android), { title: "t" });
    expect(r.sent).toBe(1);
    expect(r.dead).toEqual([android("gone")]);
    expect(Object.fromEntries(r.failed.map((f) => [f.token, f.kind]))).toEqual({ denied: "auth", other: "auth", bad: "payload", slow: "transient", down: "transient" });
  });
  it("the token endpoint refusing the service account is auth for every Android target", async () => {
    const g = fakeGoogle({}, 400);
    const r = await createNativePushSender({ fcm: { serviceAccount: SA, fetch: g.f } }).send([android("a"), android("b")], { title: "t" });
    expect(r.failed.map((f) => [f.kind, f.statusCode])).toEqual([["auth", 400], ["auth", 400]]);
    expect(r.allFailed).toBe(true);
  });
  it("a token from ANOTHER Firebase project (403 SENDER_ID_MISMATCH) is a config fault — auth, never dead", () => {
    expect(classifyFcm(403, "SENDER_ID_MISMATCH")).toBe("auth");
  });
  it("classifyFcm, directly", () => {
    expect([classifyFcm(404, "UNREGISTERED"), classifyFcm(403, undefined), classifyFcm(400, "INVALID_ARGUMENT"), classifyFcm(500, "INTERNAL")]).toEqual(["dead", "auth", "payload", "transient"]);
  });
});

describe("one send, both platforms", () => {
  it("iOS and Android in the same call, each to its own service", async () => {
    seen.length = 0;
    const g = fakeGoogle();
    const s = createNativePushSender({ apns: apns(), fcm: { serviceAccount: SA, fetch: g.f } });
    const r = await s.send([ios("ok1"), android("a1"), ios("gone")], { title: "Alarm", level: "critical" });
    expect(r).toEqual({ sent: 2, dead: [ios("gone")], failed: [], allFailed: false });
  });
  it("a critical sound carries critical:1 + volume (needs Apple's entitlement); a plain sound object becomes its name", () => {
    expect(JSON.parse(apnsPayload({ sound: { critical: true, volume: 0.5 } })).aps.sound).toEqual({ critical: 1, name: "default", volume: 0.5 });
    expect(JSON.parse(apnsPayload({ sound: { name: "siren.caf" } })).aps.sound).toBe("siren.caf");
  });
  it("apnsPayload without a title/body sends no alert", () => {
    expect(JSON.parse(apnsPayload({ data: { k: "v" } }))).toEqual({ k: "v", aps: {} });
  });
});
