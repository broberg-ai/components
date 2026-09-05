import { APIError } from "better-auth/api";
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
  /**
   * Require that the authenticator ACTUALLY VERIFIED THE USER — a face, a
   * fingerprint or a device passcode — and refuse the sign-in when it did not.
   *
   * **This is the difference between "the right phone" and "the right person."**
   * Without it a passkey proves possession of a device; with it, the assertion
   * also carries proof that the device checked who was holding it.
   *
   * WHY IT IS NOT THE DEFAULT — measured in `@better-auth/passkey@1.6.23`:
   * the authentication ceremony hardcodes `userVerification: "preferred"` and
   * the server hardcodes `requireUserVerification: false`, so an assertion with
   * the UV flag clear is accepted today. Turning this on by default would start
   * refusing sign-ins that work right now.
   *
   * AND WHY IT STILL MATTERS ON A PLATFORM WHERE IT CHANGES NOTHING: on iOS the
   * UV flag is always set — iOS verifies locally before it will produce an
   * assertion at all, so an iPhone shows Face ID whether or not the server asked.
   * The guarantee therefore holds today because of the PLATFORM, not because
   * anything enforces it. A security key, an Android device or a future browser
   * need not behave the same, and for an unlock-the-app flow the guarantee is
   * the entire feature.
   *
   * ⚠️ **This is DEVICE-OWNER verification, not Face ID.** With no Face ID or
   * Touch ID configured but a passcode set, iOS falls back to the passcode and
   * still reports the user as verified. Never promise a user a face and then
   * accept a four-digit code.
   *
   * @default false
   */
  requireUserVerification?: boolean;
  /** Advanced WebAuthn options passed straight to the Better Auth passkey plugin. */
  options?: Omit<PasskeyOptions, "rpID" | "rpName" | "origin">;
}

/** SimpleWebAuthn's verified results, narrowed to the one field this module
 *  reads. Structural on purpose: the full types live in a transitive dependency,
 *  and importing them would put a pnpm-internal path in our emitted declarations
 *  (TS2742). Registration and authentication put the same flag under DIFFERENT
 *  keys, which is the whole reason both are named here. */
type VerifiedUV = {
  authenticationInfo?: { userVerified?: boolean };
  registrationInfo?: { userVerified?: boolean };
};

/** The refusal, worded the same way whichever ceremony produced it. */
function userVerificationRequired(what: "register" | "sign in"): never {
  // 401, not 400: the credential is well-formed and the ceremony completed —
  // what is missing is proof of WHO used it.
  throw APIError.from("UNAUTHORIZED", {
    code: "USER_VERIFICATION_REQUIRED",
    message: `To ${what} here the device must verify you (Face ID, Touch ID, fingerprint or device passcode). The authenticator completed without doing so.`,
  });
}

/** Build the Better Auth passkey plugin from `cfg`. Return type annotated to keep
 *  emitted declarations portable (the inferred type otherwise leaks a pnpm-internal
 *  path — TS2742). */
export function buildPasskeyPlugin(cfg: PasskeyConfig): ReturnType<typeof passkeyPlugin> {
  const { requireUserVerification, options } = cfg;

  // The consumer's own hook must survive. Replacing it with ours would be a
  // silent bug in exactly the place a consumer put their audit logging.
  const consumerAfterVerification = options?.authentication?.afterVerification;

  const consumerAfterRegistration = options?.registration?.afterVerification;

  const authentication: PasskeyOptions["authentication"] = requireUserVerification
    ? {
        ...options?.authentication,
        afterVerification: async (args) => {
          const verification = args.verification as VerifiedUV;
          if (verification?.authenticationInfo?.userVerified !== true) userVerificationRequired("sign in");
          await consumerAfterVerification?.(args);
        },
      }
    : options?.authentication;

  // REGISTRATION IS GUARDED TOO, and not for symmetry. Asking for
  // `userVerification: "required"` in the options is only a REQUEST — Better
  // Auth verifies the registration with `requireUserVerification: false`
  // (dist/index.mjs:339), so a credential can still be enrolled without it. That
  // credential then fails the authentication guard at EVERY later sign-in: the
  // enrolment appears to succeed and the login never works, with the failure
  // surfacing somewhere else, later, to someone who did not enrol it.
  const registration: PasskeyOptions["registration"] = requireUserVerification
    ? {
        ...options?.registration,
        afterVerification: async (args) => {
          const verification = args.verification as VerifiedUV;
          if (verification?.registrationInfo?.userVerified !== true) userVerificationRequired("register");
          return consumerAfterRegistration?.(args);
        },
      }
    : options?.registration;

  return passkeyPlugin({
    rpID: cfg.rpID,
    rpName: cfg.rpName,
    ...(cfg.origin ? { origin: cfg.origin } : {}),
    ...options,
    ...(requireUserVerification
      ? {
          // Registration IS configurable (unlike authentication), so ask for it
          // up front too: a credential enrolled without user verification is one
          // the guard above will refuse at every later sign-in.
          authenticatorSelection: {
            ...options?.authenticatorSelection,
            userVerification: "required",
          },
        }
      : {}),
    ...(authentication ? { authentication } : {}),
    ...(registration ? { registration } : {}),
  });
}
