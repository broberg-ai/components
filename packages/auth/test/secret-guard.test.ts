import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth";
import { createAuth, createTypedAuth, secretsFrom } from "../src/index.js";

/**
 * F008.11 — Better Auth boots on a signing secret printed in its own source
 * unless NODE_ENV is exactly "production" and TEST is unset. These tests seal
 * both halves: the hole (measured in a spawned process, because Better Auth
 * reads NODE_ENV at module load) and our refusal of it (measured in-process,
 * because ours reads at call time).
 */

/** The literal in better-auth's `dist/context/create-context.mjs:78`. */
const DEFAULT_SECRET = "better-auth-secret-12345678901234567890";
const REAL_SECRET = "Q0uAcCPzHqUBNw4bTqu5Ky6tvVKf8pJb2GmzXcSdVfE=";

const db = () => memoryAdapter({});

/** The five env states. `undefined` means the variable is absent, which is a
 *  different thing from empty — `isTest()` reads TEST for truthiness and
 *  `nodeENV` defaults to "development" when NODE_ENV is missing entirely. */
const STATES: Array<{ name: string; NODE_ENV?: string; TEST?: string }> = [
  { name: "NODE_ENV unset" },
  { name: "development", NODE_ENV: "development" },
  { name: "production", NODE_ENV: "production" },
  { name: "production + TEST=1", NODE_ENV: "production", TEST: "1" },
  { name: "test", NODE_ENV: "test" },
];

// ---------------------------------------------------------------------------
// The hole itself. Spawned, because `isProduction` is a module-load const: a
// probe that assigns NODE_ENV after a hoisted import measures the wrong moment
// and reports "production is fine". Env must precede process start.
// ---------------------------------------------------------------------------

const BASELINE = `
const DEFAULT = ${JSON.stringify(DEFAULT_SECRET)};
const { betterAuth } = await import("better-auth");
const { memoryAdapter } = await import("better-auth/adapters/memory");
try {
  const auth = betterAuth({ database: memoryAdapter({}), emailAndPassword: { enabled: true } });
  const ctx = await auth.$context;
  console.log(ctx.secret === DEFAULT ? "BOOTS_ON_DEFAULT" : "BOOTS_ON_OTHER");
} catch {
  console.log("THROWS");
}
`;

function bootBetterAuthWith(state: { NODE_ENV?: string; TEST?: string }): string {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
  if (state.NODE_ENV !== undefined) env.NODE_ENV = state.NODE_ENV;
  if (state.TEST !== undefined) env.TEST = state.TEST;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", BASELINE], {
    cwd: new URL("..", import.meta.url).pathname,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return out.trim().split("\n").pop() ?? "";
}

describe("the hole this guard exists for (better-auth, spawned)", () => {
  it("boots on the PUBLIC default secret in four of five env states", () => {
    const measured = Object.fromEntries(
      STATES.map((s) => [s.name, bootBetterAuthWith(s)]),
    );
    expect(measured).toEqual({
      "NODE_ENV unset": "BOOTS_ON_DEFAULT",
      development: "BOOTS_ON_DEFAULT",
      production: "THROWS",
      "production + TEST=1": "BOOTS_ON_DEFAULT",
      test: "BOOTS_ON_DEFAULT",
    });
  });
});

// ---------------------------------------------------------------------------
// Our refusal. In-process is the honest setup here: the guard reads
// process.env at CALL time, so it cannot care when the value arrived — and the
// lazy-read test below is what proves that rather than assuming it.
// ---------------------------------------------------------------------------

let saved: Record<string, string | undefined>;
const KEYS = ["NODE_ENV", "TEST", "BETTER_AUTH_SECRET", "AUTH_SECRET", "BETTER_AUTH_SECRETS"];

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function applyState(state: { NODE_ENV?: string; TEST?: string }) {
  if (state.NODE_ENV !== undefined) process.env.NODE_ENV = state.NODE_ENV;
  if (state.TEST !== undefined) process.env.TEST = state.TEST;
}

describe.each(STATES)("createAuth in $name", (state) => {
  it("throws on the public default secret", () => {
    applyState(state);
    expect(() => createAuth({ database: db(), secret: DEFAULT_SECRET })).toThrow(
      /IS Better Auth's default secret/,
    );
  });

  it("throws when no secret resolves at all", () => {
    applyState(state);
    expect(() => createAuth({ database: db() })).toThrow(/no signing secret/);
  });
});

// createTypedAuth assembles its options with its OWN inline spread, not through
// buildAuthOptions — so guarding one factory leaves the other open. Asserted
// separately for exactly that reason.
describe.each(STATES)("createTypedAuth in $name", (state) => {
  it("throws on the public default secret", () => {
    applyState(state);
    expect(() =>
      createTypedAuth({ database: db(), secret: DEFAULT_SECRET }, []),
    ).toThrow(/IS Better Auth's default secret/);
  });

  it("throws when no secret resolves at all", () => {
    applyState(state);
    expect(() => createTypedAuth({ database: db() }, [])).toThrow(/no signing secret/);
  });
});

describe("positive controls — the guard is not simply 'always throws'", () => {
  it("accepts a secret passed in code", () => {
    expect(() => createAuth({ database: db(), secret: REAL_SECRET })).not.toThrow();
    expect(() => createTypedAuth({ database: db(), secret: REAL_SECRET }, [])).not.toThrow();
  });

  it("accepts a versioned secrets array", () => {
    const secrets = secretsFrom({ 2: REAL_SECRET, 1: "older-but-real-key-0123456789abcd" });
    expect(() => createAuth({ database: db(), secrets })).not.toThrow();
  });

  it("accepts BETTER_AUTH_SECRET from the environment", () => {
    process.env.BETTER_AUTH_SECRET = REAL_SECRET;
    expect(() => createAuth({ database: db() })).not.toThrow();
  });

  it("accepts AUTH_SECRET from the environment", () => {
    process.env.AUTH_SECRET = REAL_SECRET;
    expect(() => createAuth({ database: db() })).not.toThrow();
  });
});

describe("the paths a narrower guard would have missed", () => {
  it("refuses the default secret inside a secrets array — the path that never reaches Better Auth's own check", () => {
    const secrets = secretsFrom({ 2: REAL_SECRET, 1: DEFAULT_SECRET });
    expect(() => createAuth({ database: db(), secrets })).toThrow(
      /one of your `secrets` is Better Auth's default secret/,
    );
  });

  it("reads the environment at CALL time, not at module load", () => {
    // The module was imported with no BETTER_AUTH_SECRET set. If the guard had
    // captured env on import (the trap Better Auth's own isProduction falls
    // into), this assignment would be invisible to it and the call would throw.
    process.env.BETTER_AUTH_SECRET = REAL_SECRET;
    expect(() => createAuth({ database: db() })).not.toThrow();
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => createAuth({ database: db() })).toThrow(/no signing secret/);
  });

  it("names the fix, so a consumer need not read our source", () => {
    let message = "";
    try {
      createAuth({ database: db() });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).toContain("openssl rand -base64 32");
    expect(message).toContain("forge any session cookie");
  });
});

// ---------------------------------------------------------------------------
// The chain has SIX sources, not four. 0.4.0 read four, which was enough to
// pass every test above — because those tests came from the same incomplete
// reading of Better Auth's create-context.mjs. Each case below FAILED on 0.4.0.
// ---------------------------------------------------------------------------

describe("the two sources 0.4.0 missed", () => {
  it("BETTER_AUTH_SECRETS in env is a valid config Better Auth accepts on its own", async () => {
    process.env.BETTER_AUTH_SECRETS = `1:${REAL_SECRET}`;
    const ctx = await betterAuth({ database: db() }).$context;
    expect(ctx.secret).toBe(REAL_SECRET);
  });

  it("...so the guard must NOT refuse it (0.4.0 threw 'no signing secret')", () => {
    process.env.BETTER_AUTH_SECRETS = `1:${REAL_SECRET}`;
    expect(() => createAuth({ database: db() })).not.toThrow();
  });

  it("...but it must refuse the public default hiding in that variable", () => {
    process.env.BETTER_AUTH_SECRETS = `1:${DEFAULT_SECRET}`;
    expect(() => createAuth({ database: db() })).toThrow(
      /BETTER_AUTH_SECRETS contains Better Auth's default secret/,
    );
  });

  it("a secret passed through `extend` counts (0.4.0 threw on this valid config)", () => {
    expect(() => createAuth({ database: db(), extend: { secret: REAL_SECRET } })).not.toThrow();
  });

  it("and `extend` cannot smuggle the public default past the guard — it WINS over config.secret, because buildAuthOptions spreads it last", () => {
    expect(() =>
      createAuth({ database: db(), secret: REAL_SECRET, extend: { secret: DEFAULT_SECRET } }),
    ).toThrow(/IS Better Auth's default secret/);
  });

  it("same for a secrets array smuggled through `extend`", () => {
    expect(() =>
      createAuth({
        database: db(),
        extend: { secrets: [{ version: 1, value: DEFAULT_SECRET }] },
      }),
    ).toThrow(/one of your `secrets` is Better Auth's default secret/);
  });
});
