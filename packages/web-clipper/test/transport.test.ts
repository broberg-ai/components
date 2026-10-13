// F099.4 — the destination plug-in point and the sender.
import { describe, expect, it } from "vitest";
import { sendClip, chainFps, DestinationError, type Destination, type Session, type SessionSource, type SendContext, type Target } from "../src/transport";
import type { Clip, Unit } from "../src/extract";

const T: Target = { id: "kb-1", label: "Hjerne" };
const S = (tok = "t1"): Session => ({ accessToken: tok, sub: "user-1", expiresAt: Date.now() + 60_000 });
const turns = (n: number, edit?: { at: number; text: string }): Unit[] =>
  Array.from({ length: n }, (_, i) => ({ kind: "turn", role: i % 2 ? "assistant" : "user", content: edit?.at === i ? edit.text : `tur ${i}`, position: i }));
const clip = (units: Unit[]): Clip => ({ url: "https://chatgpt.com/c/abc", title: "chat", anchor: "abc", units });
const noSleep = { sleep: async () => {} };

/** An append-only destination that stores what it receives, deduplicating on the idempotency key. */
function fakeStore(script: Array<number | "net" | "ok"> = []) {
  const held: string[] = [];          // chain fps, in order (the current line)
  const calls: { units: Unit[]; ctx: SendContext }[] = [];
  let received = 0;                   // units the backend actually accepted (after dedupe)
  const dest: Destination = {
    id: "fake", label: "Fake", appendOnly: true,
    targets: async () => [T],
    lastSeen: async () => [...held],
    async send(units, ctx) {
      calls.push({ units, ctx });
      const next = script.shift();
      if (typeof next === "number") throw new DestinationError(next);
      if (next === "net") throw new TypeError("fetch failed");
      if (ctx.branch) held.length = ctx.branch.forkAt;
      for (const k of ctx.idempotencyKeys) if (!held.includes(k)) { held.push(k); received++; }
    },
  };
  return { dest, held, calls, get received() { return received; } };
}
const auth = (sessions: Array<Session | null> = [S()]): SessionSource & { refreshes: number } => {
  const a = { refreshes: 0, async session(o?: { refresh?: boolean }) { if (o?.refresh) { a.refreshes++; return sessions[a.refreshes] ?? null; } return sessions[0] ?? null; } };
  return a;
};

describe("F099.4 — sends only what is new, keyed by the chain fingerprint", () => {
  it("first send: all units, idempotency keys = chain fps; second send of the same clip: nothing", async () => {
    const f = fakeStore();
    const units = turns(4);
    const r1 = await sendClip({ destination: f.dest, target: T, clip: clip(units), auth: auth(), ...noSleep });
    expect(r1).toStrictEqual({ state: "sent", mode: "append", sent: 4, idempotencyKeys: await chainFps(units) });
    expect(f.calls[0]!.ctx.idempotencyKeys).toStrictEqual(await chainFps(units));
    const r2 = await sendClip({ destination: f.dest, target: T, clip: clip(units), auth: auth(), ...noSleep });
    expect(r2).toStrictEqual({ state: "sent", mode: "same", sent: 0, idempotencyKeys: [] });
    expect(f.calls).toHaveLength(1);
  });

  it("two new turns: only those two are sent", async () => {
    const f = fakeStore();
    await sendClip({ destination: f.dest, target: T, clip: clip(turns(4)), auth: auth(), ...noSleep });
    const r = await sendClip({ destination: f.dest, target: T, clip: clip(turns(6)), auth: auth(), ...noSleep });
    expect(r.state === "sent" && r.sent).toBe(2);
    expect(f.calls[1]!.units.map((u) => u.position)).toStrictEqual([4, 5]);
  });

  it("an edited earlier turn opens a branch from there — the marker reaches the destination", async () => {
    const f = fakeStore();
    await sendClip({ destination: f.dest, target: T, clip: clip(turns(4)), auth: auth(), ...noSleep });
    const r = await sendClip({ destination: f.dest, target: T, clip: clip(turns(4, { at: 2, text: "redigeret" })), auth: auth(), ...noSleep });
    expect(r.state === "sent" && r.mode).toBe("branch");
    expect(f.calls[1]!.ctx.branch).toStrictEqual({ forkAt: 2, parentChainFp: (await chainFps(turns(4)))[1] });
    expect(f.calls[1]!.units.map((u) => u.position)).toStrictEqual([2, 3]);
  });

  it("a destination WITHOUT appendOnly gets the whole clip every time (Trail)", async () => {
    const sends: number[] = [];
    const trail: Destination = { id: "trail", label: "Trail", targets: async () => [T], async send(u) { sends.push(u.length); } };
    const page = clip([{ kind: "page", content: "# side", position: 0 }]);
    await sendClip({ destination: trail, target: T, clip: page, auth: auth(), ...noSleep });
    await sendClip({ destination: trail, target: T, clip: page, auth: auth(), ...noSleep });
    expect(sends).toStrictEqual([1, 1]);
  });
});

describe("F099.4 — appendOnly decides whether the destination is asked what it holds", () => {
  it("a destination that HAS lastSeen but is not appendOnly is not asked, and gets the whole clip", async () => {
    let asked = 0;
    const sends: number[] = [];
    const d: Destination = { id: "d", label: "D", targets: async () => [T], lastSeen: async () => { asked++; return []; }, async send(u) { sends.push(u.length); } };
    await sendClip({ destination: d, target: T, clip: clip(turns(3)), auth: auth(), ...noSleep });
    await sendClip({ destination: d, target: T, clip: clip(turns(3)), auth: auth(), ...noSleep });
    expect(asked).toBe(0);
    expect(sends).toStrictEqual([3, 3]);
  });
});

describe("F099.4 — the response rules", () => {
  it("5xx and network failures are retried with backoff, then succeed", async () => {
    const f = fakeStore([503, "net", "ok"]);
    const slept: number[] = [];
    const r = await sendClip({ destination: f.dest, target: T, clip: clip(turns(2)), auth: auth(), sleep: async (ms) => { slept.push(ms); }, backoffMs: 100 });
    expect(r.state).toBe("sent");
    expect(slept).toStrictEqual([100, 200]);
    expect(f.received).toBe(2);
  });

  it("5xx until attempts run out → 'unavailable', never 'login_required'", async () => {
    const f = fakeStore([503, 503, 503, 503]);
    const r = await sendClip({ destination: f.dest, target: T, clip: clip(turns(2)), auth: auth(), ...noSleep });
    expect(r).toMatchObject({ state: "unavailable", status: 503, sent: 0 });
  });

  it("a 4xx other than 401 gives up at once with a named state", async () => {
    const f = fakeStore([422]);
    const r = await sendClip({ destination: f.dest, target: T, clip: clip(turns(2)), auth: auth(), ...noSleep });
    expect(r).toMatchObject({ state: "refused", status: 422 });
    expect(f.calls).toHaveLength(1);
  });

  it("0.8.3 — a refused LATER batch reports how many units arrived before it (owner 13/10)", async () => {
    const f = fakeStore(["ok", 413]);
    const r = await sendClip({ destination: f.dest, target: T, clip: clip(turns(5)), auth: auth(), batchSize: 2, ...noSleep });
    expect(r).toStrictEqual({ state: "refused", status: 413, message: expect.any(String), sent: 2 });
    const first = await sendClip({ destination: fakeStore([422]).dest, target: T, clip: clip(turns(2)), auth: auth(), ...noSleep });
    expect(first).toMatchObject({ state: "refused", sent: 0 });
  });

  it("401 → refresh ONCE, resend with the fresh session, succeed", async () => {
    const f = fakeStore([401, "ok"]);
    const a = auth([S("old"), S("new")]);
    const r = await sendClip({ destination: f.dest, target: T, clip: clip(turns(2)), auth: a, ...noSleep });
    expect(r.state).toBe("sent");
    expect(a.refreshes).toBe(1);
    expect(f.calls.map((c) => c.ctx.session.accessToken)).toStrictEqual(["old", "new"]);
  });

  it("401 twice → 'login_required' (the UI says «log ind igen»), and only one refresh", async () => {
    const f = fakeStore([401, 401]);
    const a = auth([S("old"), S("new")]);
    expect(await sendClip({ destination: f.dest, target: T, clip: clip(turns(2)), auth: a, ...noSleep })).toStrictEqual({ state: "login_required" });
    expect(a.refreshes).toBe(1);
  });

  it("401 and the refresh is refused (BID login ended) → 'login_required'", async () => {
    const f = fakeStore([401]);
    expect(await sendClip({ destination: f.dest, target: T, clip: clip(turns(2)), auth: auth([S(), null]), ...noSleep })).toStrictEqual({ state: "login_required" });
  });

  it("no session at all → 'login_required' and nothing is sent", async () => {
    const f = fakeStore();
    expect(await sendClip({ destination: f.dest, target: T, clip: clip(turns(2)), auth: auth([null]), ...noSleep })).toStrictEqual({ state: "login_required" });
    expect(f.calls).toHaveLength(0);
  });

  it("consent gate: a requiresConsent destination gets nothing until recording is on", async () => {
    const f = fakeStore();
    const dest = { ...f.dest, requiresConsent: true };
    expect(await sendClip({ destination: dest, target: T, clip: clip(turns(2)), auth: auth(), ...noSleep })).toStrictEqual({ state: "consent_required" });
    expect(f.calls).toHaveLength(0);
    expect((await sendClip({ destination: dest, target: T, clip: clip(turns(2)), auth: auth(), consented: true, ...noSleep })).state).toBe("sent");
  });
});

describe("F099.4 — interrupted and resumed: nothing twice, nothing lost", () => {
  it("fails after half; the next run sends exactly the rest, once", async () => {
    // batch 1 (units 0-1) ok; batch 2 (units 2-3) fails on every attempt.
    const f = fakeStore(["ok", 503, 503, 503, 503]);
    const units = turns(4);
    const r1 = await sendClip({ destination: f.dest, target: T, clip: clip(units), auth: auth(), batchSize: 2, ...noSleep });
    expect(r1).toMatchObject({ state: "unavailable", sent: 2 });
    expect(f.held).toStrictEqual((await chainFps(units)).slice(0, 2));

    const before = f.calls.length;
    const r2 = await sendClip({ destination: f.dest, target: T, clip: clip(units), auth: auth(), batchSize: 2, ...noSleep });
    expect(r2).toMatchObject({ state: "sent", sent: 2 });
    const resumed = f.calls.slice(before);
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.units.map((u) => u.position)).toStrictEqual([2, 3]);
    expect(f.held).toStrictEqual(await chainFps(units));
    expect(f.received).toBe(4);
  });
});
