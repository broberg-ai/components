import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  createAuth,
  createTypedAuth,
  buildMagicLinkPlugin,
  buildPasskeyPlugin,
} from "../src/index.js";
import { mountAuth, getSession } from "../src/hono.js";
import { toNextHandler } from "../src/next.js";

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

/**
 * F008.8 — the plugin-narrowed `createTypedAuth` result must compose with the
 * mount helpers WITHOUT a cast. Better Auth's `Auth<O>` is invariant in `O`, so
 * a param typed as the wide `Auth` rejects a narrowed instance; the helpers
 * therefore accept the structural slice they actually use. These lines are
 * compile-only assertions — `tsc --noEmit` REDs if a param narrows back.
 */
const wideAuth = createAuth({ database: memoryAdapter({}), emailPassword: true });
const app = new Hono();

// The exact README happy-path: narrowed instance, no cast.
mountAuth(app, auth);
// The wide path must keep compiling (zero regression).
mountAuth(app, wideAuth);
// /next adapter accepts both too.
const _nextTyped = toNextHandler(auth);
const _nextWide = toNextHandler(wideAuth);

describe("mount helpers compose with createTypedAuth (F008.8)", () => {
  it("mountAuth accepts a plugin-narrowed instance with no cast", () => {
    expect(typeof app.fetch).toBe("function");
    expect(typeof _nextTyped.GET).toBe("function");
    expect(typeof _nextWide.POST).toBe("function");
  });

  it("getSession preserves the narrowed session return type", () => {
    // Compile-only: getSession must be callable on the narrowed instance and
    // its return kept as a Promise (no `any`), reachable via a fake context.
    type _SessionReturn = ReturnType<typeof getSession<typeof auth>>;
    const _isPromise: _SessionReturn extends Promise<unknown> ? true : false = true;
    expect(_isPromise).toBe(true);
  });
});
