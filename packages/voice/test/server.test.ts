import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AccessToken, TokenVerifier } from "livekit-server-sdk";
import { createRoomToken, verifyWebhook, VoiceError } from "../src/server";

const creds = { apiKey: "APIkey123", apiSecret: "a-secret-that-is-long-enough-for-hs256-0123456789" };

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(VoiceError);
    return (e as VoiceError).code;
  }
  throw new Error("expected a VoiceError, got success");
}

describe("createRoomToken", () => {
  it("is accepted by LiveKit's own verifier with the right secret and refused with a wrong one", async () => {
    const jwt = await createRoomToken({ ...creds, room: "jam:42", identity: "u1", name: "Ida" });
    const claims = await new TokenVerifier(creds.apiKey, creds.apiSecret).verify(jwt);
    expect(claims.sub).toBe("u1");
    expect(claims.name).toBe("Ida");
    await expect(new TokenVerifier(creds.apiKey, "another-secret-of-adequate-length-000000000").verify(jwt)).rejects.toThrow();
  });

  it("binds one room, microphone only, no data channel", async () => {
    const jwt = await createRoomToken({ ...creds, room: "jam:42", identity: "u1" });
    const { video } = await new TokenVerifier(creds.apiKey, creds.apiSecret).verify(jwt);
    expect(video).toEqual({
      room: "jam:42",
      roomJoin: true,
      canSubscribe: true,
      canPublish: true,
      canPublishSources: ["microphone"],
      canPublishData: false,
    });
  });

  it("canPublish:false makes a listen-only ticket: join and hear, publish nothing", async () => {
    const jwt = await createRoomToken({ ...creds, room: "jam:42", identity: "reader", canPublish: false });
    const { video } = await new TokenVerifier(creds.apiKey, creds.apiSecret).verify(jwt);
    expect(video).toEqual({ room: "jam:42", roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false });
  });

  it("is valid for 10 minutes by default, and for the ttl given", async () => {
    const verify = (jwt: string) => new TokenVerifier(creds.apiKey, creds.apiSecret).verify(jwt);
    const d = await verify(await createRoomToken({ ...creds, room: "r", identity: "u" }));
    expect(d.exp! - d.nbf!).toBe(600);
    const c = await verify(await createRoomToken({ ...creds, room: "r", identity: "u", ttl: 120 }));
    expect(c.exp! - c.nbf!).toBe(120);
  });

  it("refuses an empty room", async () => {
    expect(await codeOf(createRoomToken({ ...creds, room: " ", identity: "u" }))).toBe("invalid_room");
  });

  it("refuses an empty identity", async () => {
    expect(await codeOf(createRoomToken({ ...creds, room: "r", identity: "" }))).toBe("invalid_identity");
  });

  it("refuses missing credentials instead of falling back to LIVEKIT_* from the environment", async () => {
    process.env.LIVEKIT_API_KEY = "env-key";
    process.env.LIVEKIT_API_SECRET = "env-secret-that-is-long-enough-000000000000";
    try {
      expect(await codeOf(createRoomToken({ ...creds, apiKey: "", room: "r", identity: "u" }))).toBe("missing_credentials");
      expect(await codeOf(createRoomToken({ ...creds, apiSecret: "", room: "r", identity: "u" }))).toBe("missing_credentials");
    } finally {
      delete process.env.LIVEKIT_API_KEY;
      delete process.env.LIVEKIT_API_SECRET;
    }
  });

  it("refuses a ttl outside 1..3600 seconds", async () => {
    expect(await codeOf(createRoomToken({ ...creds, room: "r", identity: "u", ttl: 3601 }))).toBe("invalid_ttl");
    expect(await codeOf(createRoomToken({ ...creds, room: "r", identity: "u", ttl: 0 }))).toBe("invalid_ttl");
  });
});

/** Sign a body the way the LiveKit server does: a JWT whose sha256 claim is the body's hash. */
async function signedHeader(body: string, secret = creds.apiSecret): Promise<string> {
  const at = new AccessToken(creds.apiKey, secret);
  at.sha256 = createHash("sha256").update(body).digest("base64");
  return at.toJwt();
}

describe("verifyWebhook", () => {
  const body = JSON.stringify({ event: "participant_joined", room: { name: "jam:42" }, participant: { identity: "u1" } });

  it("returns the event for a correctly signed body", async () => {
    const ev = await verifyWebhook(body, await signedHeader(body), creds);
    expect(ev.event).toBe("participant_joined");
    expect(ev.room?.name).toBe("jam:42");
    expect(ev.participant?.identity).toBe("u1");
  });

  it("refuses a changed body, a wrong secret and a missing header", async () => {
    const header = await signedHeader(body);
    expect(await codeOf(verifyWebhook(body.replace("u1", "u2"), header, creds))).toBe("invalid_webhook");
    expect(await codeOf(verifyWebhook(body, await signedHeader(body, "another-secret-of-adequate-length-000000000"), creds))).toBe("invalid_webhook");
    expect(await codeOf(verifyWebhook(body, undefined, creds))).toBe("invalid_webhook");
    expect(await codeOf(verifyWebhook(body, header, { ...creds, apiSecret: "" }))).toBe("missing_credentials");
  });
});
