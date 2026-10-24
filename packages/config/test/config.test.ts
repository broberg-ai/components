import { describe, expect, it } from "vitest";
import { z } from "zod";
import { coerceBool, coerceInt, coerceNum, defineConfig, parseEnv, productionGuard } from "../src/index";

describe("parseEnv", () => {
  const schema = z.object({
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    MAIL_LIVE: z.enum(["true", "false"]).default("false"),
  });

  it("validates + types a valid source, coercing as the schema dictates", () => {
    const env = parseEnv(schema, { DATABASE_URL: "file:./x.db", PORT: "8080" });
    expect(env.PORT).toBe(8080); // coerced string → number
    expect(env.DATABASE_URL).toBe("file:./x.db");
    expect(env.MAIL_LIVE).toBe("false"); // default applied
  });

  it("throws listing every offending key when validation fails", () => {
    expect(() => parseEnv(schema, { PORT: "-1" })).toThrow(/Invalid environment configuration/);
    try {
      parseEnv(schema, { PORT: "-1" });
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("DATABASE_URL"); // missing required
      expect(msg).toContain("PORT"); // present but not positive
    }
  });

  it("defaults the source to process.env", () => {
    const s = z.object({ FOO_THAT_IS_NOT_SET: z.string().default("bar") });
    expect(parseEnv(s).FOO_THAT_IS_NOT_SET).toBe("bar");
  });
});

describe("defineConfig", () => {
  it("returns the object unchanged (identity / typed import boundary)", () => {
    const cfg = { platformPercent: 5, payoutDelayDays: 7 };
    expect(defineConfig(cfg)).toBe(cfg);
  });
});

describe("coerceInt", () => {
  it("uses the fallback when absent or empty", () => {
    expect(coerceInt("X", 42, {})).toBe(42);
    expect(coerceInt("X", 42, { X: "" })).toBe(42);
  });
  it("parses a present integer", () => {
    expect(coerceInt("X", 42, { X: "7" })).toBe(7);
  });
  it("throws on a present non-integer (loud, not NaN)", () => {
    expect(() => coerceInt("X", 42, { X: "abc" })).toThrow(/must be an integer/);
    expect(() => coerceInt("X", 42, { X: "1.5" })).toThrow(/must be an integer/);
  });
});

describe("coerceNum", () => {
  it("uses the fallback when absent or empty", () => {
    expect(coerceNum("X", 3, {})).toBe(3);
    expect(coerceNum("X", 3, { X: "" })).toBe(3);
  });
  it("parses a present float or integer", () => {
    expect(coerceNum("X", 1, { X: "3.0" })).toBe(3);
    expect(coerceNum("X", 1, { X: "2.5" })).toBe(2.5);
    expect(coerceNum("X", 1, { X: "7" })).toBe(7);
  });
  it("throws on a present non-number (loud, not NaN)", () => {
    expect(() => coerceNum("X", 1, { X: "abc" })).toThrow(/must be a number/);
    expect(() => coerceNum("X", 1, { X: "Infinity" })).toThrow(/must be a number/);
  });
});

describe("coerceBool", () => {
  it("parses true/false/1/0/yes/no/on/off case-insensitively", () => {
    for (const v of ["true", "1", "YES", "On"]) expect(coerceBool("B", false, { B: v })).toBe(true);
    for (const v of ["false", "0", "no", "OFF"]) expect(coerceBool("B", true, { B: v })).toBe(false);
  });
  it("uses the fallback when absent", () => {
    expect(coerceBool("B", true, {})).toBe(true);
    expect(coerceBool("B", false, {})).toBe(false);
  });
  it("throws on an unrecognised value", () => {
    expect(() => coerceBool("B", false, { B: "maybe" })).toThrow(/must be a boolean/);
  });
});

describe("productionGuard", () => {
  const cfg = { authSecret: "", resendApiKey: "set" };
  it("throws listing falsy required keys in production", () => {
    expect(() => productionGuard(cfg, ["authSecret", "resendApiKey"], "production")).toThrow(/authSecret/);
  });
  it("passes in production when all required keys are set", () => {
    expect(() => productionGuard({ a: "x", b: "y" }, ["a", "b"], "production")).not.toThrow();
  });
  it("is a no-op outside production even if keys are missing", () => {
    expect(() => productionGuard(cfg, ["authSecret"], "development")).not.toThrow();
  });
});

describe("F004.7 — productionGuard: what counts as blank is the caller's choice", () => {
  const machine = (v: unknown) => typeof v !== "string" || v.trim() === "";
  const real = "a".repeat(64);

  it("with the whitespace predicate: \"\" refused, \"   \" refused, a real 64-char value accepted — it discriminates, it does not just reject more", () => {
    const g = (v: string) => () => productionGuard({ SESSION_SECRET: v }, ["SESSION_SECRET"], "production", { blank: machine });
    expect(g("")).toThrow("Missing required production config: SESSION_SECRET");
    expect(g("   ")).toThrow("Missing required production config: SESSION_SECRET");
    expect(g(real)).not.toThrow();
  });

  it("DEFAULT UNCHANGED: with no option a whitespace value still boots exactly as 0.3.1 does (and \"\" is still refused)", () => {
    expect(() => productionGuard({ SESSION_SECRET: "   " }, ["SESSION_SECRET"], "production")).not.toThrow();
    expect(() => productionGuard({ SESSION_SECRET: "" }, ["SESSION_SECRET"], "production")).toThrow(/SESSION_SECRET/);
  });

  it("a human-chosen password with surrounding space passes and keeps its whitespace INTACT, even with the predicate on for the other keys", () => {
    const cfg = { SESSION_SECRET: real, PLATFORM_OWNER_PASSWORD: "  hunter2  " };
    productionGuard(cfg, ["SESSION_SECRET", "PLATFORM_OWNER_PASSWORD"], "production", { blank: machine });
    expect(cfg.PLATFORM_OWNER_PASSWORD).toBe("  hunter2  ");
    expect(cfg.SESSION_SECRET).toBe(real);
  });

  it("the predicate receives the key, so one key can be exempted from a whitespace rule", () => {
    const seen: string[] = [];
    const blank = (v: unknown, key: string) => { seen.push(key); return key === "PLATFORM_OWNER_PASSWORD" ? !v : machine(v); };
    expect(() => productionGuard({ A: real, PLATFORM_OWNER_PASSWORD: "   " }, ["A", "PLATFORM_OWNER_PASSWORD"], "production", { blank })).not.toThrow();
    expect(seen).toStrictEqual(["A", "PLATFORM_OWNER_PASSWORD"]);
  });

  it("outside production the predicate is never consulted", () => {
    let called = false;
    productionGuard({ A: "" }, ["A"], "development", { blank: () => { called = true; return true; } });
    expect(called).toBe(false);
  });
});

