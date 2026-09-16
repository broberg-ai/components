/**
 * @broberg/sso — the thin client for Broberg ID.
 *
 * WHAT IS DELIBERATELY ABSENT, and stays absent (F084.4 AC#4 greps the
 * published tarball for it): password handling, passkey registration,
 * social-provider keys, email verification, and any client secret. All of it
 * lives in Broberg ID. A client that CAN do those things is a client somebody
 * eventually uses to do them — and then the identity rules exist in two places
 * and start to disagree.
 */
export {
  loadSsoConfig,
  SsoConfigError,
  DEFAULT_SESSION_MAX_AGE,
  type SsoConfig,
} from "./config.js";

export {
  createSsoClient,
  SsoError,
  type SsoClient,
  type SsoClaims,
  type LoginStart,
  type LoginResult,
  type BeginLoginOptions,
  type CreateSsoClientOptions,
  type Discovery,
} from "./client.js";

export { createJwksCache, JwksError, type JwksCache, type JwksCacheOptions } from "./jwks.js";

export {
  signSession,
  verifySession,
  signValue,
  verifyValue,
  cookieHeader,
  readCookie,
  type SessionPayload,
} from "./session.js";
