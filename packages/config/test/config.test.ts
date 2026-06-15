import { describe, expect, it } from "vitest";
import { z } from "zod";
import { coerceBool, coerceInt, defineConfig, parseEnv, productionGuard } from "../src/index";

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
