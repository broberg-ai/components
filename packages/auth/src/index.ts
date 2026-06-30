import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { buildMagicLinkPlugin, type MagicLinkConfig } from "./magic-link.js";
import { buildPasskeyPlugin, type PasskeyConfig } from "./passkey.js";

/**
 * @broberg/auth — a thin, opinionated wrapper around Better Auth.
 *
 * It does NOT re-abstract Better Auth's API; it assembles `BetterAuthOptions`
 * from a fleet-shaped config and returns `betterAuth(options)` unchanged. The
 * one opinion this core layer adds is DARK-SHIP: a social provider whose config
 * is absent/incomplete (e.g. an env var that isn't set) is silently omitted —
 * never registered, never a crash. Magic-link, passkey and the per-stack mount
 * helpers live in dedicated modules (F008.2–F008.4).
 */

/** Better Auth's own social-provider config map — we reuse its types verbatim
 *  so this package never hardcodes a provider's field names. */
export type SocialProviders = NonNullable<BetterAuthOptions["socialProviders"]>;
export type SocialProviderName = keyof SocialProviders;

/** The fleet's v1 social providers (the D.3.1 set). Informational — Better Auth
 *  supports more; these are the ones the wrapper is documented/tested against. */
export const FLEET_SOCIAL_PROVIDERS = [
  "google",
  "apple",
  "github",
  "microsoft",
  "linkedin",
  "facebook",
] as const;

/** Fleet auth config — a thin surface over `BetterAuthOptions`. */
export interface AuthConfig {
  /** Better Auth database option. Pass `drizzle(db, { provider })` (re-exported
   *  below) or any Better Auth adapter/dialect. */
  database: BetterAuthOptions["database"];
  /** Public base URL of the app (e.g. https://xrt81.com). */
  baseURL?: string;
  /** Signing secret. Falls back to Better Auth's BETTER_AUTH_SECRET env when unset. */
  secret?: string;
  /** Enable email + password sign-in. */
  emailPassword?: boolean;
  /** Enable magic-link sign-in, delivered through @broberg/mail. Omitted when
   *  unset (dark-ship) — no magic-link endpoints register without a mailer. */
  magicLink?: MagicLinkConfig;
  /** Enable passkey / WebAuthn sign-in. Omitted when unset (dark-ship). */
  passkey?: PasskeyConfig;
  /**
   * Social providers, keyed exactly as Better Auth expects. Each entry may be
   * `undefined` — such providers are DARK-SHIPPED (omitted, not registered).
   */
  socials?: { [K in SocialProviderName]?: SocialProviders[K] | undefined };
  /** Extra Better Auth plugins (magic-link/passkey are wired by their own helpers). */
  plugins?: BetterAuthOptions["plugins"];
  /** Escape hatch: extra BetterAuthOptions merged last, for reaching Better Auth directly. */
  extend?: Partial<BetterAuthOptions>;
}

/** Re-export Better Auth's Drizzle adapter so a consumer wires their DB in one
 *  line: `database: drizzle(db, { provider: "sqlite" })`. */
export const drizzle = drizzleAdapter;

/** A social-provider entry is "configured" when it carries a truthy clientId —
 *  the universal minimum across all six providers. Incomplete entries dark-ship. */
function providerConfigured(cfg: unknown): boolean {
  return Boolean(
    cfg &&
      typeof cfg === "object" &&
      "clientId" in cfg &&
      (cfg as { clientId?: unknown }).clientId,
  );
}

/** Strip dark-shipped (absent/incomplete) providers so Better Auth only ever
 *  sees live ones. Exported so consumers can render login buttons for exactly
 *  the providers that will work. */
export function pruneSocials(socials: AuthConfig["socials"]): SocialProviders {
  const out: Record<string, unknown> = {};
  for (const [name, cfg] of Object.entries(socials ?? {})) {
    if (providerConfigured(cfg)) out[name] = cfg;
  }
  return out as SocialProviders;
}

/** Assemble `BetterAuthOptions` from the fleet config: dark-ship unconfigured
 *  social providers, and register the magic-link plugin only when a mailer is
 *  given. Exported (separately from `createAuth`) so the assembly is unit-
 *  testable without constructing a live Better Auth instance. */
export function buildAuthOptions(config: AuthConfig): BetterAuthOptions {
  const socialProviders = pruneSocials(config.socials);
  const plugins = [...(config.plugins ?? [])];
  if (config.magicLink) plugins.push(buildMagicLinkPlugin(config.magicLink));
  if (config.passkey) plugins.push(buildPasskeyPlugin(config.passkey));
  return {
    database: config.database,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.secret ? { secret: config.secret } : {}),
    ...(config.emailPassword ? { emailAndPassword: { enabled: true } } : {}),
    socialProviders,
    ...(plugins.length ? { plugins } : {}),
    ...config.extend,
  };
}

/** Build a fleet-configured Better Auth instance. Thin wrapper: assembles
 *  `BetterAuthOptions` (dark-shipping unconfigured methods) and returns
 *  `betterAuth(options)`. */
export function createAuth(config: AuthConfig) {
  return betterAuth(buildAuthOptions(config));
}

/** The configured Better Auth instance type returned by `createAuth`. */
export type Auth = ReturnType<typeof createAuth>;

/** A single Better Auth plugin (the element type of the options `plugins` array). */
export type AuthPlugin = NonNullable<BetterAuthOptions["plugins"]>[number];

/**
 * Like {@link createAuth}, but you pass the plugin tuple EXPLICITLY so the
 * returned instance is FULLY TYPED — plugin-augmented `api.*` methods
 * (`auth.api.signInMagicLink`, the passkey endpoints, …) are statically
 * available with NO `any` cast (F008.7).
 *
 * Why a separate factory: `createAuth` dark-ships magic-link/passkey
 * CONDITIONALLY at runtime, so its return type can't know which plugins are
 * present. Here you opt in by passing the plugins, so the `const P` tuple flows
 * into Better Auth's inference. Social providers + email/password still
 * dark-ship; build the plugins with the re-exported `buildMagicLinkPlugin` /
 * `buildPasskeyPlugin` (or any Better Auth plugin).
 *
 *   const auth = createTypedAuth(
 *     { database: drizzle(db, { provider: "sqlite" }), socials: { google } },
 *     [buildMagicLinkPlugin({ mailer }), buildPasskeyPlugin({ rpID, rpName })],
 *   );
 *   await auth.api.signInMagicLink({ body: { email } });   // fully typed, no cast
 */
export function createTypedAuth<const P extends AuthPlugin[]>(
  config: Omit<AuthConfig, "magicLink" | "passkey" | "plugins" | "extend">,
  plugins: P,
) {
  const socialProviders = pruneSocials(config.socials);
  return betterAuth({
    database: config.database,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.secret ? { secret: config.secret } : {}),
    ...(config.emailPassword ? { emailAndPassword: { enabled: true } } : {}),
    socialProviders,
    plugins,
  });
}

export {
  buildMagicLinkPlugin,
  makeMagicLinkSender,
  type MagicLinkConfig,
} from "./magic-link.js";

export { buildPasskeyPlugin, type PasskeyConfig } from "./passkey.js";

export {
  googleConfigured,
  appleConfigured,
  githubConfigured,
  microsoftConfigured,
  linkedinConfigured,
  facebookConfigured,
  emailPasswordConfigured,
  magicLinkConfigured,
  passkeyConfigured,
  configuredMethods,
  type GuardInput,
} from "./guards.js";

export type { BetterAuthOptions };
