// F104.9.12 — who is REALLY in a room, from the media server (jam W47 HØJ-1: consent to
// record must come from everyone in the room, and the browser's own list can be forged).
import { afterEach, describe, expect, it, vi } from "vitest";
import { listParticipants, VoiceError } from "../src/server";

const opts = { apiKey: "APIkey", apiSecret: "s".repeat(40), url: "https://voice.example" };
const seen: { url: string; auth: string | null; body: any }[] = [];
function serve(status: number, body: unknown) {
  seen.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: URL | string, init: any) => {
    seen.push({ url: String(url), auth: init?.headers?.Authorization ?? init?.headers?.authorization ?? null, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }));
}
afterEach(() => vi.unstubAllGlobals());
const claims = (auth: string) => JSON.parse(Buffer.from(auth.replace(/^Bearer /, "").split(".")[1]!, "base64url").toString());

describe("listParticipants (F104.9.12)", () => {
  it("asks the media server's RoomService for THIS room, with a room-admin ticket for that room only", async () => {
    serve(200, { participants: [] });
    await listParticipants("jam:42", opts);
    expect(seen[0]!.url).toBe("https://voice.example/twirp/livekit.RoomService/ListParticipants");
    expect(seen[0]!.body).toEqual({ room: "jam:42" });
    const c = claims(seen[0]!.auth!);
    expect([c.video.roomAdmin, c.video.room]).toEqual([true, "jam:42"]);
  });
  it("returns identity, name and joinedAt (epoch ms) per participant", async () => {
    serve(200, { participants: [{ identity: "u1", name: "Ada", joinedAt: "1795130000" }, { identity: "u2" }] });
    expect(await listParticipants("jam:42", opts)).toEqual([
      { identity: "u1", name: "Ada", joinedAt: 1795130000000 },
      { identity: "u2" },
    ]);
  });
  it("an unknown room is an empty room, not an error", async () => {
    serve(404, { code: "not_found", msg: "requested room does not exist" });
    expect(await listParticipants("jam:gone", opts)).toEqual([]);
  });
  it("any other failure THROWS VoiceError — never an empty list a caller could read as «nobody to ask»", async () => {
    serve(401, { code: "unauthenticated", msg: "invalid token" });
    await expect(listParticipants("jam:42", opts)).rejects.toMatchObject({ code: "room_service_failed" });
  });
  it("refuses missing credentials, an empty room and a non-https url before any call", async () => {
    serve(200, { participants: [] });
    await expect(listParticipants("jam:42", { ...opts, apiSecret: "" })).rejects.toBeInstanceOf(VoiceError);
    await expect(listParticipants(" ", opts)).rejects.toMatchObject({ code: "invalid_room" });
    await expect(listParticipants("jam:42", { ...opts, url: "http://voice.example" })).rejects.toMatchObject({ code: "invalid_control_url" });
    expect(seen).toEqual([]);
  });
});
