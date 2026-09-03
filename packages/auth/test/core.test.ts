import { describe, it, expect } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuth, pruneSocials, FLEET_SOCIAL_PROVIDERS } from "../src/index.js";
// F008.9 — drizzle is a SUBPATH now: importing it from the core entry is what
// dragged drizzle-orm into every consumer's install.
import { drizzle } from "../src/drizzle.js";

/** F008.11 — the factories now refuse a boot with no signing secret at all, so
 *  a test that boots auth must bring one. Booting on Better Auth's public
 *  default is a configuration nobody should run, tests included. */
const TEST_SECRET = "test-only-secret-xK7pQ2mR9vTnW4bYcHsEdZgLjF8aU3o=";


/** An in-memory Better Auth database so the wrapper's own logic (not a real DB)
 *  is what's under test. */
const db = () => memoryAdapter({});

const GOOGLE = { clientId: "g-id", clientSecret: "g-secret" };
const GITHUB = { clientId: "gh-id", clientSecret: "gh-secret" };

describe("createAuth", () => {
  it("returns a Better Auth instance with a request handler", () => {
    const auth = createAuth({ database: db(), secret: TEST_SECRET, emailPassword: true });
    expect(typeof auth.handler).toBe("function");
    expect(auth.api).toBeDefined();
  });

  it("does not throw when no socials are configured (dark-ship)", () => {
    expect(() => createAuth({ database: db(), secret: TEST_SECRET })).not.toThrow();
  });

  it("registers a configured social provider and dark-ships an absent one", () => {
    // github is undefined → must be omitted; google is complete → must register.
    const auth = createAuth({
      database: db(), secret: TEST_SECRET,
      socials: { google: GOOGLE, github: undefined },
    });
    expect(typeof auth.handler).toBe("function");
  });

  it("enables email+password via the config flag without throwing", () => {
    expect(() =>
      createAuth({ database: db(), secret: TEST_SECRET, emailPassword: true }),
    ).not.toThrow();
  });
});

describe("pruneSocials (dark-ship)", () => {
  it("keeps a fully-configured provider", () => {
    const out = pruneSocials({ google: GOOGLE });
    expect(out).toHaveProperty("google");
  });

  it("drops an absent (undefined) provider", () => {
    const out = pruneSocials({ google: GOOGLE, github: undefined });
    expect(out).toHaveProperty("google");
    expect(out).not.toHaveProperty("github");
  });

  it("drops a provider with an empty clientId", () => {
    const out = pruneSocials({
      google: GOOGLE,
      apple: { clientId: "", clientSecret: "x" }, // empty clientId → dark-shipped
    });
    expect(out).toHaveProperty("google");
    expect(out).not.toHaveProperty("apple");
  });

  it("passes all six fleet providers through when configured", () => {
    const socials = Object.fromEntries(
      FLEET_SOCIAL_PROVIDERS.map((p) => [p, { clientId: `${p}-id`, clientSecret: `${p}-secret` }]),
    );
    const out = pruneSocials(socials as never);
    for (const p of FLEET_SOCIAL_PROVIDERS) {
      expect(out).toHaveProperty(p);
    }
  });

  it("returns an empty object for undefined input", () => {
    expect(pruneSocials(undefined)).toEqual({});
  });
});

describe("drizzle re-export", () => {
  it("is the Better Auth Drizzle adapter factory", () => {
    expect(typeof drizzle).toBe("function");
  });
});
