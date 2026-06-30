import { describe, it, expect } from "vitest";
import {
  googleConfigured,
  appleConfigured,
  microsoftConfigured,
  magicLinkConfigured,
  passkeyConfigured,
  emailPasswordConfigured,
  configuredMethods,
} from "../src/guards.js";

const creds = { clientId: "id", clientSecret: "secret" };

describe("dark-ship guards", () => {
  it("a social guard is true when configured, false when absent", () => {
    expect(googleConfigured({ socials: { google: creds } })).toBe(true);
    expect(googleConfigured({ socials: {} })).toBe(false);
    expect(googleConfigured({})).toBe(false);
  });

  it("a social guard is false when clientId is empty", () => {
    expect(appleConfigured({ socials: { apple: { clientId: "", clientSecret: "x" } } })).toBe(false);
  });

  it("microsoft is recognised", () => {
    expect(microsoftConfigured({ socials: { microsoft: { clientId: "m", clientSecret: "s" } } })).toBe(true);
  });

  it("emailPassword / magicLink / passkey guards reflect their config", () => {
    expect(emailPasswordConfigured({ emailPassword: true })).toBe(true);
    expect(emailPasswordConfigured({})).toBe(false);
    expect(passkeyConfigured({ passkey: { rpID: "x", rpName: "X" } })).toBe(true);
    expect(passkeyConfigured({})).toBe(false);
    // magicLink needs a mailer-shaped object; truthiness is enough for the guard.
    expect(magicLinkConfigured({ magicLink: { mailer: { send: async () => ({ ok: true }) } } })).toBe(true);
    expect(magicLinkConfigured({})).toBe(false);
  });

  it("configuredMethods reports the full enabled set", () => {
    const methods = configuredMethods({
      emailPassword: true,
      socials: { google: creds, github: creds },
    });
    expect(methods.emailPassword).toBe(true);
    expect(methods.google).toBe(true);
    expect(methods.github).toBe(true);
    expect(methods.apple).toBe(false);
    expect(methods.passkey).toBe(false);
  });
});
