// F099.12 — the headless engine: everything the popup does, nothing it looks like.
// Runs with NO DOM at all — that is the point.
import { describe, expect, it } from "vitest";
import { createClipper, type ClipperState } from "../src/engine";
import { DestinationError, type Destination, type Session } from "../src/transport";
import type { KeyValueStorage } from "../src/auth";
import type { Clip } from "../src/extract";

const S: Session = { accessToken: "t", sub: "u", expiresAt: Date.now() + 60_000 };
const memory = (): KeyValueStorage & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
};
const auth = (start: Session | null = null) => {
  let s = start;
  return { async login() { s = S; return S; }, async session() { return s; }, async logout() { s = null; } };
};
const dest = (over: Partial<Destination> = {}): Destination & { sent: string[] } => {
  const d = {
    sent: [] as string[], id: "jam", label: "Jam",
    targets: async () => [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    async send(u: Parameters<Destination["send"]>[0], ctx: Parameters<Destination["send"]>[1]) { d.sent.push(`${ctx.target.id}:${u.length}`); },
    ...over,
  };
  return d as Destination & { sent: string[] };
};
const chat: Clip = { url: "https://claude.ai/chat/x", title: "x", anchor: "x", units: [{ kind: "turn", role: "user", content: "hej", position: 0 }] };
const page: Clip = { url: "https://example.com", title: "p", units: [{ kind: "page", content: "p", position: 0 }] };

describe("F099.12 — createClipper (no DOM)", () => {
  it("start → logged out; login → ready with targets; clip → done with the result and the clip", async () => {
    const d = dest();
    const c = createClipper({ auth: auth(), destination: d, getClip: async () => chat, storage: memory() });
    const seen: ClipperState["phase"]["kind"][] = [];
    c.subscribe((s) => seen.push(s.phase.kind));
    await c.start();
    expect(c.getState().phase).toStrictEqual({ kind: "logged_out" });
    await c.login();
    expect(c.getState()).toMatchObject({ phase: { kind: "ready" }, target: "a" });
    expect(c.getState().targets?.map((t) => t.id)).toStrictEqual(["a", "b"]);
    await c.clip();
    const run = c.getState().run;
    expect(run.kind).toBe("done");
    expect(run.kind === "done" && run.result).toMatchObject({ state: "sent", sent: 1 });
    expect(run.kind === "done" && run.clip).toBe(chat);
    expect(d.sent).toStrictEqual(["a:1"]);
    expect(seen).toContain("logging_in");
  });

  it("the chosen target is remembered per destination", async () => {
    const store = memory();
    const c1 = createClipper({ auth: auth(S), destination: dest(), getClip: async () => chat, storage: store });
    await c1.start();
    await c1.choose("b");
    const c2 = createClipper({ auth: auth(S), destination: dest(), getClip: async () => chat, storage: store });
    await c2.start();
    expect(c2.getState().target).toBe("b");
  });

  it("consent: nothing is sent until clip({ consent: true }) — then it is remembered for that conversation", async () => {
    const store = memory(); const d = dest({ requiresConsent: true });
    const c = createClipper({ auth: auth(S), destination: d, getClip: async () => chat, storage: store });
    await c.start();
    await c.clip();
    expect(c.getState().consentFor).toBe("x");
    expect(d.sent).toStrictEqual([]);
    await c.clip({ consent: true });
    expect(d.sent).toStrictEqual(["a:1"]);
    expect(store.data.get("broberg-web-clipper:consent:jam:x")).toBe(true);
    expect(c.getState().consentFor).toBeNull();
  });

  it("consent on a page that is no conversation → notAConversation, never a silent blink", async () => {
    const c = createClipper({ auth: auth(S), destination: dest({ requiresConsent: true }), getClip: async () => page, storage: memory() });
    await c.start();
    await c.clip();
    expect(c.getState()).toMatchObject({ notAConversation: true, consentFor: null });
  });

  it("401 on the targets and a refresh that does not help → logged_out «login_again»; a failed login says why", async () => {
    const expired = { ...auth(S), session: async (o?: { refresh?: boolean }) => (o?.refresh ? null : S) };
    const c = createClipper({ auth: expired, destination: dest({ targets: async () => { throw new DestinationError(401); } }), getClip: async () => chat, storage: memory() });
    await c.start();
    expect(c.getState().phase).toStrictEqual({ kind: "logged_out", reason: "login_again" });
    const bad = createClipper({ auth: { ...auth(), login: async () => { throw new Error("vinduet blev lukket"); } }, destination: dest(), getClip: async () => chat, storage: memory() });
    await bad.login();
    expect(bad.getState().phase).toStrictEqual({ kind: "logged_out", reason: "login_failed", message: "vinduet blev lukket" });
  });

  it("fields reach send() as ctx.fields; a failing getClip is an error state, not a throw", async () => {
    let got: unknown;
    const d = dest({ send: async (_u, ctx) => { got = ctx.fields; } });
    const c = createClipper({ auth: auth(S), destination: d, getClip: async () => chat, storage: memory() });
    await c.start();
    await c.clip({ fields: { tags: "a, b" } });
    expect(got).toStrictEqual({ tags: "a, b" });
    const broken = createClipper({ auth: auth(S), destination: dest(), getClip: async () => { throw new Error("chrome:// sider kan ikke klippes"); }, storage: memory() });
    await broken.start();
    await expect(broken.clip()).resolves.toBeUndefined();
    expect(broken.getState().run).toStrictEqual({ kind: "error", message: "chrome:// sider kan ikke klippes" });
  });

  it("the module has no DOM, Preact or CSS in it", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/engine.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "preact|document\.|\.css"|className|<div/);
  });
});
