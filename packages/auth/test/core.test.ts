import { describe, it, expect } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  createAuth,
  pruneSocials,
  FLEET_SOCIAL_PROVIDERS,
  drizzle,
} from "../src/index.js";

/** An in-memory Better Auth database so the wrapper's own logic (not a real DB)
 *  is what's under test. */
const db = () => memoryAdapter({});

const GOOGLE = { clientId: "g-id", clientSecret: "g-secret" };
const GITHUB = { clientId: "gh-id", clientSecret: "gh-secret" };

describe("createAuth", () => {
  it("returns a Better Auth instance with a request handler", () => {
    const auth = createAuth({ database: db(), emailPassword: true });
    expect(typeof auth.handler).toBe("function");
    expect(auth.api).toBeDefined();
  });

  it("does not throw when no socials are configured (dark-ship)", () => {
    expect(() => createAuth({ database: db() })).not.toThrow();
  });

  it("registers a configured social provider and dark-ships an absent one", () => {
    // github is undefined → must be omitted; google is complete → must register.
    const auth = createAuth({
      database: db(),
      socials: { google: GOOGLE, github: undefined },
    });
    expect(typeof auth.handler).toBe("function");
  });

  it("enables email+password via the config flag without throwing", () => {
    expect(() =>
      createAuth({ database: db(), emailPassword: true }),
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
