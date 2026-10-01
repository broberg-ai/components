// F036.6 — write access only when asked for, explicitly, by an app that
// enabled it, and never without an audit record. Every refusal also asserts
// that createSession was NOT called: a 400 after minting would still have
// minted.
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createLensMintHandler, parseMintMode, type LensMintOptions, type LensSessionContext } from "../src/index";
import { createLensRoute } from "../src/next";
import { lensSessionHandler } from "../src/hono";

const SECRET = "test-mint-secret-abc123";
const AUTH = `Bearer ${SECRET}`;

function opts(over: Partial<LensMintOptions> = {}) {
  const seen: LensSessionContext[] = [];
  const audit = vi.fn();
  const o: LensMintOptions = {
    secret: SECRET,
    principal: "lens@app.local",
    writePrincipal: "lens-writer@app.local",
    onWriteMint: audit,
    createSession: (ctx) => {
      seen.push(ctx);
      return { name: "s", value: `${ctx.mode}:${ctx.principal}` };
    },
    ...over,
  };
  return { o, seen, audit };
}
const call = (o: LensMintOptions, body?: string | null) =>
  createLensMintHandler(o)({ authorization: AUTH, host: "app.dk", secure: true, body });

describe("read stays the default — 0.1.3 behaviour unchanged", () => {
  it.each([[undefined], [null], [""], ["   "], ["{}"], ['{"mode":"read"}']])("body %j → read principal", async (body) => {
    const { o, seen, audit } = opts();
    const r = await call(o, body);
    expect(r.status).toBe(200);
    expect(seen.map((c) => [c.mode, c.principal])).toEqual([["read", "lens@app.local"]]);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("write needs BOTH keys", () => {
  it('{"mode":"write","writes":true} → write principal, audited before the cookie', async () => {
    const { o, seen, audit } = opts();
    const r = await call(o, '{"mode":"write","writes":true}');
    expect(r.status).toBe(200);
    expect(seen.map((c) => [c.mode, c.principal])).toEqual([["write", "lens-writer@app.local"]]);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]![0]).toMatchObject({ principal: "lens-writer@app.local", host: "app.dk" });
    expect((r.body as { cookies: Array<{ value: string }> }).cookies[0]!.value).toBe("write:lens-writer@app.local");
  });

  it.each([
    ['{"mode":"write"}'],
    ['{"writes":true}'],
    ['{"mode":"write","writes":"true"}'],
    ['{"mode":"read","writes":true}'],
    ['{"mode":"admin"}'],
    ["[1]"],
    ['"write"'],
    ["{not json"],
  ])("%s → 400, nothing minted, nothing audited", async (body) => {
    const { o, seen, audit } = opts();
    const r = await call(o, body);
    expect(r.status).toBe(400);
    expect(seen).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("a valid write request on an app WITHOUT writePrincipal → 403, nothing minted", async () => {
    const { o, seen } = opts({ writePrincipal: undefined, onWriteMint: undefined });
    const r = await call(o, '{"mode":"write","writes":true}');
    expect(r.status).toBe(403);
    expect(seen).toEqual([]);
  });

  it("an unauthenticated write request is 401 before the body is even judged", async () => {
    const { o, seen } = opts();
    const r = await createLensMintHandler(o)({ authorization: "Bearer nope", host: "app.dk", secure: true, body: "{bad" });
    expect(r.status).toBe(401);
    expect(seen).toEqual([]);
  });
});

describe("audit fails closed", () => {
  it.each([
    ["throws", () => { throw new Error("audit db down"); }],
    ["rejects", () => Promise.reject(new Error("audit db down"))],
  ])("onWriteMint %s → 500 and NO cookie leaves", async (_n, hook) => {
    const { o } = opts({ onWriteMint: hook });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await call(o, '{"mode":"write","writes":true}');
    spy.mockRestore();
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: "lens-session mint failed" });
  });
});

describe("construction guards for the write identity", () => {
  it.each([
    ["blank", { writePrincipal: "  " }, /blank/],
    ["cb@webhouse.dk", { writePrincipal: "CB@webhouse.dk" }, /cb@webhouse\.dk/i],
    ["same as principal", { writePrincipal: "Lens@App.local" }, /differ/],
    ["without onWriteMint", { onWriteMint: undefined }, /onWriteMint/],
  ] as const)("%s → throws", (_n, over, re) => {
    expect(() => createLensMintHandler(opts(over as Partial<LensMintOptions>).o)).toThrow(re);
  });
});

describe("both adapters forward the body", () => {
  const post = (body?: string) =>
    new Request("https://app.dk/api/lens-session", { method: "POST", headers: { authorization: AUTH }, body });

  it("/next: write body → write principal; half body → 400; no body → read", async () => {
    const { o, seen } = opts();
    const { POST } = createLensRoute(o);
    expect((await POST(post('{"mode":"write","writes":true}'))).status).toBe(200);
    expect((await POST(post('{"mode":"write"}'))).status).toBe(400);
    expect((await POST(post())).status).toBe(200);
    expect(seen.map((c) => c.mode)).toEqual(["write", "read"]);
  });

  it("/hono: write body → write principal; half body → 400; no body → read", async () => {
    const { o, seen } = opts();
    const app = new Hono().post("/api/lens-session", lensSessionHandler(o));
    expect((await app.request(post('{"mode":"write","writes":true}'))).status).toBe(200);
    expect((await app.request(post('{"mode":"write"}'))).status).toBe(400);
    expect((await app.request(post())).status).toBe(200);
    expect(seen.map((c) => c.mode)).toEqual(["write", "read"]);
  });
});

describe("parseMintMode — the contract in one function", () => {
  it("read by default, write only with both keys", () => {
    expect(parseMintMode(undefined)).toBe("read");
    expect(parseMintMode('{"mode":"write","writes":true}')).toBe("write");
    expect(parseMintMode('{"mode":"write"}')).toHaveProperty("error");
  });
});
