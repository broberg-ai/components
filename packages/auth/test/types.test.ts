import { describe, it, expect } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  createTypedAuth,
  buildMagicLinkPlugin,
  buildPasskeyPlugin,
} from "../src/index.js";

/**
 * F008.7 — createTypedAuth gives a fully-typed instance: the plugin-augmented
 * api methods are reachable with NO `any` cast. The `type _X = typeof auth.api.…`
 * lines below are compile-only assertions enforced by `tsc --noEmit` (whose
 * include covers test/): if an endpoint dropped off the type, the build fails.
 */
const auth = createTypedAuth(
  { database: memoryAdapter({}), emailPassword: true },
  [
    buildMagicLinkPlugin({ mailer: { send: async () => ({ ok: true }) } }),
    buildPasskeyPlugin({ rpID: "example.com", rpName: "Example" }),
  ],
);

// Compile-only: these must exist + be callable with no cast.
type _SignInMagicLink = typeof auth.api.signInMagicLink;
type _PasskeyRegister = typeof auth.api.generatePasskeyRegistrationOptions;
const _assertFns: [_SignInMagicLink, _PasskeyRegister] = [
  auth.api.signInMagicLink,
  auth.api.generatePasskeyRegistrationOptions,
];

describe("createTypedAuth (F008.7 type-ergonomics)", () => {
  it("exposes magic-link + passkey api with no any cast", () => {
    expect(typeof auth.handler).toBe("function");
    expect(typeof _assertFns[0]).toBe("function");
    expect(typeof _assertFns[1]).toBe("function");
  });
});
