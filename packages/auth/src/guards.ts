import type { AuthConfig, SocialProviderName } from "./index.js";

/**
 * Dark-ship guards. A consumer renders a login button for a method ONLY when its
 * guard returns true — so a provider without secrets never shows a dead button.
 * The guards take just the relevant slice of AuthConfig (no DB handle needed).
 */
export type GuardInput = Pick<
  AuthConfig,
  "socials" | "emailPassword" | "magicLink" | "passkey"
>;

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
