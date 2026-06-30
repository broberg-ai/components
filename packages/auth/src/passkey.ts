import { passkey as passkeyPlugin, type PasskeyOptions } from "@better-auth/passkey";

/**
 * Passkey / WebAuthn sign-in (biometri, PIN, security key). NOT OAuth — the
 * public-key credential ceremony is handled by Better Auth's passkey plugin
 * (powered by SimpleWebAuthn). This module just registers it from `cfg`.
 */

export interface PasskeyConfig {
  /** Relying-Party ID — the registrable domain, e.g. "xrt81.com" (no scheme/port). */
  rpID: string;
  /** Relying-Party display name shown in the OS passkey prompt, e.g. "XRT81". */
  rpName: string;
  /** Expected origin(s), e.g. "https://xrt81.com". Defaults to the app's baseURL. */
  origin?: string | string[];
  /** Advanced WebAuthn options passed straight to the Better Auth passkey plugin. */
  options?: Omit<PasskeyOptions, "rpID" | "rpName" | "origin">;
}

/** Build the Better Auth passkey plugin from `cfg`. Return type annotated to keep
 *  emitted declarations portable (the inferred type otherwise leaks a pnpm-internal
 *  path — TS2742). */
export function buildPasskeyPlugin(cfg: PasskeyConfig): ReturnType<typeof passkeyPlugin> {
  return passkeyPlugin({
    rpID: cfg.rpID,
    rpName: cfg.rpName,
    ...(cfg.origin ? { origin: cfg.origin } : {}),
    ...cfg.options,
  });
}
