import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuth } from "../src/index.js";
import { mountAuth } from "../src/hono.js";
import { toNextHandler } from "../src/next.js";

/** F008.11 — the factories now refuse a boot with no signing secret at all, so
 *  a test that boots auth must bring one. Booting on Better Auth's public
 *  default is a configuration nobody should run, tests included. */
const TEST_SECRET = "test-only-secret-xK7pQ2mR9vTnW4bYcHsEdZgLjF8aU3o=";


const auth = createAuth({ database: memoryAdapter({}), secret: TEST_SECRET, baseURL: "http://localhost" });

describe("@broberg/auth/hono — mountAuth", () => {
  it("registers a GET+POST catch-all on /api/auth/* of a Hono app", () => {
    const app = new Hono();
    const on = vi.spyOn(app, "on");
    mountAuth(app, auth);
    expect(on).toHaveBeenCalledOnce();
    const [methods, path] = on.mock.calls[0];
    expect(methods).toEqual(["POST", "GET"]);
    expect(path).toBe("/api/auth/*");
  });

  it("honours a custom basePath", () => {
    const app = new Hono();
    const on = vi.spyOn(app, "on");
    mountAuth(app, auth, "/auth");
    expect(on.mock.calls[0][1]).toBe("/auth/*");
  });

  it("does not throw mounting on a real Hono app", () => {
    expect(() => mountAuth(new Hono(), auth)).not.toThrow();
  });
});

describe("@broberg/auth/next — toNextHandler", () => {
  it("returns { GET, POST } route handlers", () => {
    const handlers = toNextHandler(auth);
    expect(typeof handlers.GET).toBe("function");
    expect(typeof handlers.POST).toBe("function");
  });
});
