import { describe, it, expect } from "vitest";
import { buildPasskeyPlugin } from "../src/passkey.js";

/**
 * F008.12 — the guard that makes "Face ID" a guarantee instead of a platform
 * habit. Every case here is driven through the hook the plugin will actually
 * call, not through an assertion that the option was passed along.
 */

const base = { rpID: "example.com", rpName: "Example" };

/** The shape SimpleWebAuthn hands `afterVerification`, narrowed to what we read. */
const verification = (userVerified: boolean) => ({ authenticationInfo: { userVerified } });

/** Reach the hook the way Better Auth will: off the built plugin's options. */
function afterVerificationOf(plugin: unknown) {
  const opts = (plugin as { options?: { authentication?: { afterVerification?: Function } } }).options;
  return opts?.authentication?.afterVerification;
}
function authenticatorSelectionOf(plugin: unknown) {
  return (plugin as { options?: { authenticatorSelection?: { userVerification?: string } } }).options
    ?.authenticatorSelection;
}

describe("requireUserVerification: true", () => {
  it("REJECTS an assertion whose UV flag is clear", async () => {
    const hook = afterVerificationOf(buildPasskeyPlugin({ ...base, requireUserVerification: true }));
    expect(hook).toBeTypeOf("function");
    await expect(
      hook!({ verification: verification(false) } as never),
    ).rejects.toThrow(/verify you/i);
  });

  it("ACCEPTS an assertion whose UV flag is set", async () => {
    const hook = afterVerificationOf(buildPasskeyPlugin({ ...base, requireUserVerification: true }));
    await expect(hook!({ verification: verification(true) } as never)).resolves.toBeUndefined();
  });

  it("rejects a MISSING flag, not just a false one — absent must never read as verified", async () => {
    // A shape without the field is what a version bump or a different verifier
    // could hand us. Defaulting that to "verified" is how a guard reports on a
    // check it never made.
    const hook = afterVerificationOf(buildPasskeyPlugin({ ...base, requireUserVerification: true }));
    await expect(hook!({ verification: {} } as never)).rejects.toThrow(/verify you/i);
    await expect(hook!({} as never)).rejects.toThrow(/verify you/i);
  });

  it("asks for user verification at REGISTRATION too", () => {
    const sel = authenticatorSelectionOf(buildPasskeyPlugin({ ...base, requireUserVerification: true }));
    expect(sel?.userVerification).toBe("required");
  });

  it("keeps the consumer's OTHER authenticatorSelection choices", () => {
    const sel = authenticatorSelectionOf(
      buildPasskeyPlugin({
        ...base,
        requireUserVerification: true,
        options: { authenticatorSelection: { residentKey: "required", authenticatorAttachment: "platform" } },
      }),
    );
    expect(sel).toMatchObject({
      residentKey: "required",
      authenticatorAttachment: "platform",
      userVerification: "required",
    });
  });

  it("CHAINS the consumer's own afterVerification instead of replacing it", async () => {
    let sawIt = false;
    const hook = afterVerificationOf(
      buildPasskeyPlugin({
        ...base,
        requireUserVerification: true,
        options: { authentication: { afterVerification: async () => { sawIt = true; } } },
      }),
    );
    await hook!({ verification: verification(true) } as never);
    expect(sawIt).toBe(true);
  });

  it("does NOT run the consumer's hook when the guard rejects", async () => {
    let sawIt = false;
    const hook = afterVerificationOf(
      buildPasskeyPlugin({
        ...base,
        requireUserVerification: true,
        options: { authentication: { afterVerification: async () => { sawIt = true; } } },
      }),
    );
    await expect(hook!({ verification: verification(false) } as never)).rejects.toThrow();
    expect(sawIt).toBe(false);
  });
});

describe("the default — OFF, so a released version does not start refusing today's logins", () => {
  it("adds NO afterVerification hook of its own", () => {
    expect(afterVerificationOf(buildPasskeyPlugin(base))).toBeUndefined();
  });

  it("NEGATIVE CONTROL: the same UV=0 assertion is accepted, because nothing rejects it", async () => {
    // Without this, "the guard rejects UV=0" could be true of the plugin rather
    // than of the guard, and every test above would pass for the wrong reason.
    const hook = afterVerificationOf(
      buildPasskeyPlugin({ ...base, options: { authentication: { afterVerification: async () => {} } } }),
    );
    await expect(hook!({ verification: verification(false) } as never)).resolves.toBeUndefined();
  });

  it("leaves Better Auth's own authenticatorSelection default alone", () => {
    expect(authenticatorSelectionOf(buildPasskeyPlugin(base))?.userVerification).toBeUndefined();
  });

  it("passes the consumer's afterVerification through untouched", async () => {
    let calls = 0;
    const own = async () => { calls++; };
    const hook = afterVerificationOf(
      buildPasskeyPlugin({ ...base, options: { authentication: { afterVerification: own } } }),
    );
    await hook!({ verification: verification(false) } as never);
    expect(calls).toBe(1);
  });
});
