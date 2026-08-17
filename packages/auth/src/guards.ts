import type { AuthConfig, SocialProviderName } from "./index.js";

/**
 * Dark-ship guards. A consumer renders a login button for a method ONLY when its
 * guard returns true — so a provider without secrets never shows a dead button.
 * The guards take just the relevant slice of AuthConfig (no DB handle needed).
 */
export type GuardInput = Pick<AuthConfig, "socials" | "emailPassword" | "magicLink"> & {
  /**
   * Whether passkey sign-in is wired. Deliberately NOT `Pick`ed from AuthConfig
   * and deliberately loose (F008.9): the passkey plugin now lives behind
   * `@broberg/auth/passkey`, so it is not a field on the core config any more —
   * but the guards answer "should I render this button", which the consumer
   * knows regardless of where the plugin was built. Typing it to the plugin
   * would drag `@better-auth/passkey` back into the core import graph, which is
   * the whole defect this split exists to fix.
   */
  passkey?: unknown;
};

/** A social provider is configured when its entry carries a truthy clientId. */
function socialConfigured(config: GuardInput, name: SocialProviderName): boolean {
  const cfg = config.socials?.[name];
  return Boolean(
    cfg &&
      typeof cfg === "object" &&
      "clientId" in cfg &&
      (cfg as { clientId?: unknown }).clientId,
  );
}

export const googleConfigured = (c: GuardInput): boolean => socialConfigured(c, "google");
export const appleConfigured = (c: GuardInput): boolean => socialConfigured(c, "apple");
export const githubConfigured = (c: GuardInput): boolean => socialConfigured(c, "github");
export const microsoftConfigured = (c: GuardInput): boolean => socialConfigured(c, "microsoft");
export const linkedinConfigured = (c: GuardInput): boolean => socialConfigured(c, "linkedin");
export const facebookConfigured = (c: GuardInput): boolean => socialConfigured(c, "facebook");

export const emailPasswordConfigured = (c: GuardInput): boolean => Boolean(c.emailPassword);
export const magicLinkConfigured = (c: GuardInput): boolean => Boolean(c.magicLink);
export const passkeyConfigured = (c: GuardInput): boolean => Boolean(c.passkey);

/** Every method's enabled state — drive a login screen's button list directly. */
export function configuredMethods(c: GuardInput): {
  emailPassword: boolean;
  magicLink: boolean;
  passkey: boolean;
  google: boolean;
  apple: boolean;
  github: boolean;
  microsoft: boolean;
  linkedin: boolean;
  facebook: boolean;
} {
  return {
    emailPassword: emailPasswordConfigured(c),
    magicLink: magicLinkConfigured(c),
    passkey: passkeyConfigured(c),
    google: googleConfigured(c),
    apple: appleConfigured(c),
    github: githubConfigured(c),
    microsoft: microsoftConfigured(c),
    linkedin: linkedinConfigured(c),
    facebook: facebookConfigured(c),
  };
}
