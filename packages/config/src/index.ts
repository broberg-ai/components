// @broberg/config — the fleet's single-source config helper (F004).
// "One source, trickle down": validate + type process.env once at boot, define
// typed business constants in one place, and coerce loose env strings safely —
// so no value is re-declared (and drifts) across files. Framework-agnostic:
// runs in Node, Bun and edge. `zod` is a peer dependency (only the schema you
// pass touches it; this package imports nothing from zod at runtime).
import type { z } from "zod";

/**
 * Validate + type an environment object against a Zod schema, failing fast with
 * a readable list of every offending key. Call it once at boot, export the
 * result, and never read `process.env` directly afterwards.
 *
 * @param schema A `z.object({...})` describing the env you require.
 * @param source Defaults to `process.env`; pass any record to test.
 * @throws If validation fails — the message lists each missing/invalid key.
 *
 * @example
 * import { z } from "zod";
 * export const env = parseEnv(z.object({
 *   PORT: z.coerce.number().int().positive().default(3000),
 *   DATABASE_URL: z.string().min(1),
 *   MAIL_LIVE: z.enum(["true", "false"]).default("false"),
 * }));
 * env.PORT; // number
 */
export function parseEnv<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  source: Record<string, string | undefined> = process.env,
): z.infer<z.ZodObject<T>> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

/**
 * Identity function that brands a config object as the single typed source for a
 * set of business constants (fee tiers, shop settings, magic numbers). It adds
 * no runtime behaviour — its only job is to give you one typed import boundary
 * so the values aren't re-declared (and drift) across files.
 *
 * @example
 * export const FEES = defineConfig({ platformPercent: 5, payoutDelayDays: 7 });
 */
export function defineConfig<T>(config: T): T {
  return config;
}

/**
 * Read an integer env var, falling back when it's absent/empty. Throws on a
 * present-but-non-integer value — a typo'd number should fail loudly, not coerce
 * to `NaN`. The no-Zod escape hatch for the lightweight plain-object pattern.
 *
 * @param source Defaults to `process.env`; pass any record to test.
 */
export function coerceInt(
  name: string,
  fallback: number,
  source: Record<string, string | undefined> = process.env,
): number {
  const raw = source[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error(`Config error: ${name} must be an integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

/**
 * Read a floating-point env var, falling back when it's absent/empty. Throws on
 * a present-but-non-numeric value — a typo should fail loudly, not coerce to
 * `NaN`. The float sibling of {@link coerceInt}: use it for ratios / multipliers
 * where a non-integer is valid (e.g. `3.0`). `Infinity`/`NaN` are rejected.
 *
 * @param source Defaults to `process.env`; pass any record to test.
 */
export function coerceNum(
  name: string,
  fallback: number,
  source: Record<string, string | undefined> = process.env,
): number {
  const raw = source[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Config error: ${name} must be a number, got ${JSON.stringify(raw)}`);
  }
  return n;
}

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

/**
 * Read a boolean env var, falling back when it's absent/empty. Accepts
 * true/false/1/0/yes/no/on/off (case-insensitive); throws on anything else so a
 * typo can't silently read as `false`.
 *
 * @param source Defaults to `process.env`; pass any record to test.
 */
export function coerceBool(
  name: string,
  fallback: boolean,
  source: Record<string, string | undefined> = process.env,
): boolean {
  const raw = source[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  throw new Error(`Config error: ${name} must be a boolean (true/false/1/0), got ${JSON.stringify(raw)}`);
}

/**
 * In production (`NODE_ENV === 'production'`), assert that every required key on a
 * config object is truthy — so a missing secret crashes the boot instead of
 * silently shipping a dev default. A no-op outside production.
 *
 * @param nodeEnv Defaults to `process.env.NODE_ENV`; pass a value to test.
 * @throws Listing every falsy required key when running in production.
 */
export function productionGuard<T extends object>(
  config: T,
  requiredKeys: (keyof T)[],
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (nodeEnv !== "production") return;
  const missing = requiredKeys.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required production config: ${missing.map(String).join(", ")}`);
  }
}
