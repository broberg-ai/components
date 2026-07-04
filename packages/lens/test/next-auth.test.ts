// @broberg/lens/next-auth — offline unit. The JWE `encode` is injected (a fake),
// so this seals the helper's own logic — cookie-name selection, the salt==name
// gotcha, sub defaulting, maxAge, secure flag — with NO real next-auth install
// and NO real crypto. The real encode is next-auth's responsibility, not ours.

import { describe, it, expect } from "vitest";
import { nextAuthLensSession, nextAuthCookieName } from "../src/next-auth";
import type { LensSessionContext } from "../src/index";

const CTX: LensSessionContext = {
  principal: "lens@myapp.local",
  host: "myapp.dev",
  secure: true,
  ttlMs: 600_000,
  expiresAt: 0,
};

describe("nextAuthCookieName", () => {
  it("maps secure → __Secure- prefix, dev → bare authjs name", () => {
    expect(nextAuthCookieName(true)).toBe("__Secure-authjs.session-token");
    expect(nextAuthCookieName(false)).toBe("authjs.session-token");
  });
});

describe("nextAuthLensSession (F051)", () => {
  it("secure mode: __Secure- cookie, salt === cookie name (gotcha #1) + secure flag (gotcha #2)", async () => {
    let seen: any;
    const hook = nextAuthLensSession({
      authSecret: "s3cr3t",
      claims: { id: "u1", email: "a@b.c", name: "A" },
      secure: true,
      encode: async (p) => {
        seen = p;
        return "JWT-A";
      },
    });
    const cookie = await hook(CTX);
    expect(cookie.name).toBe("__Secure-authjs.session-token");
    expect(seen.salt).toBe("__Secure-authjs.session-token"); // salt MUST equal the cookie name
    expect(seen.secret).toBe("s3cr3t");
    expect(seen.token.sub).toBe("u1"); // sub defaults to claims.id
    expect(cookie.value).toBe("JWT-A");
    expect(cookie.secure).toBe(true);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
  });

  it("dev/insecure mode: bare authjs cookie + matching salt; sub falls back to email", async () => {
    let seen: any;
    const hook = nextAuthLensSession({
      authSecret: "x",
      claims: { email: "user@ex.com" },
      secure: false,
      encode: async (p) => {
        seen = p;
        return "JWT-B";
      },
    });
    const cookie = await hook(CTX);
    expect(cookie.name).toBe("authjs.session-token");
    expect(seen.salt).toBe("authjs.session-token");
    expect(seen.token.sub).toBe("user@ex.com"); // no id → email
    expect(cookie.secure).toBe(false);
  });

  it("maxAge defaults to the core's clamped TTL (seconds)", async () => {
    let seen: any;
    const hook = nextAuthLensSession({
      authSecret: "x",
      claims: { id: "u" },
      secure: false,
      encode: async (p) => {
        seen = p;
        return "J";
      },
    });
    await hook({ ...CTX, ttlMs: 300_000 });
    expect(seen.maxAge).toBe(300);
  });

  it("an explicit sub in claims wins over id/email", async () => {
    let seen: any;
    const hook = nextAuthLensSession({
      authSecret: "x",
      claims: { sub: "explicit", id: "u1" },
      secure: false,
      encode: async (p) => {
        seen = p;
        return "J";
      },
    });
    await hook(CTX);
    expect(seen.token.sub).toBe("explicit");
  });

  it("a __Secure- cookieName override forces secure:true even when secure=false", async () => {
    const hook = nextAuthLensSession({
      authSecret: "x",
      claims: { id: "u" },
      secure: false,
      cookieName: "__Secure-custom",
      encode: async () => "J",
    });
    const cookie = await hook(CTX);
    expect(cookie.name).toBe("__Secure-custom");
    expect(cookie.secure).toBe(true); // gotcha #2 enforced
  });
});
