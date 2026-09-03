import { twoFactor as twoFactorPlugin } from "better-auth/plugins/two-factor";
import { renderSVG } from "uqr";

/**
 * Two-factor authentication by authenticator app — Microsoft Authenticator,
 * Google Authenticator, 1Password, Authy, any of them.
 *
 * **There is no Microsoft or Google integration here, and that is the point.**
 * They all implement TOTP (RFC 6238): a 6-digit code derived from a shared
 * secret and the current 30-second window. Nothing in this module talks to a
 * vendor. We generate a secret, show it as a QR code, and verify codes — so an
 * app nobody has heard of works exactly as well as the two famous ones.
 *
 * Better Auth's plugin owns all of the crypto, and it already handles the
 * things a hand-rolled TOTP gets wrong: the secret is encrypted at rest,
 * recovery codes are encrypted by default, enrolment requires a valid code
 * before 2FA switches on, and repeated failures lock the account rather than
 * allowing an online brute-force.
 *
 * ⚠️ **READ {@link AuthConfig.secrets} BEFORE YOU SHIP THIS.** The TOTP secret
 * and the recovery codes are both encrypted with the app's key. On a lone
 * `secret` string that ciphertext carries no version marker, so a key rotation
 * makes every 2FA user's account unopenable — including via their recovery
 * codes, which use the same key. `secretsFrom()` is what prevents it.
 */

/** Options for {@link buildTwoFactorPlugin} — Better Auth's own, plus a required issuer. */
export interface TwoFactorConfig {
  /**
   * The name the authenticator app shows above the code, e.g. "WebHouse".
   * Required on purpose: it is what the user reads when picking between six
   * entries in their app, and a default would brand every consumer the same.
   */
  issuer: string;
  /** Advanced options passed straight to Better Auth's two-factor plugin. */
  options?: Omit<Parameters<typeof twoFactorPlugin>[0], "issuer">;
}

/** Build the Better Auth two-factor plugin from `cfg`. Return type annotated to
 *  keep emitted declarations portable (the inferred type otherwise leaks a
 *  pnpm-internal path — TS2742), matching `buildPasskeyPlugin`. */
export function buildTwoFactorPlugin(cfg: TwoFactorConfig): ReturnType<typeof twoFactorPlugin> {
  return twoFactorPlugin({
    issuer: cfg.issuer,
    ...cfg.options,
  });
}

/**
 * Render the `totpURI` Better Auth hands back at enrolment as a scannable QR
 * code. Better Auth returns the URI as a **string** and renders nothing, so
 * without this every consuming repo picks its own encoder and pushes the secret
 * through it differently.
 *
 * ```ts
 * const { totpURI } = await auth.api.enableTwoFactor({ ... });
 * totpQr(totpURI)              // inline SVG — a browser or a server
 * totpQr(totpURI, "dataUri")   // for an <img src="…">
 * ```
 *
 * ⚠️ **`totpURI` IS A CREDENTIAL, NOT A DISPLAY STRING.** It contains the shared
 * secret in plain text — `otpauth://totp/Issuer:user@x.dk?secret=JBSWY3…`.
 * Anyone who reads it has the second factor. Never log it, never put it in an
 * error message, never send it to an analytics call. It goes from the enrolment
 * response into this function and nowhere else.
 *
 * ⚠️ **DO NOT PUT THIS IN AN EMAIL.** Both formats are unreliable in mail
 * clients (Outlook renders neither inline SVG nor an SVG data-URI), and the
 * reason not to is stronger than the rendering: mailing a QR code mails the
 * secret, to an inbox, in a message that is stored and forwarded. 2FA enrolment
 * belongs in an authenticated session.
 */
export function totpQr(totpURI: string, format: "svg" | "dataUri" = "svg"): string {
  if (!totpURI) throw new Error("@broberg/auth: totpQr() needs the totpURI from enrolment");
  const svg = renderSVG(totpURI);
  if (format === "svg") return svg;
  // Base64, so the result is safe in an src attribute with no further escaping.
  //
  // NO `Buffer`, NO `btoa`, NO `TextEncoder` — encoded by hand, and that is not
  // over-engineering. The first version was `Buffer.from(svg, "utf8")`, which
  // THROWS "Buffer is not defined" in a browser while the README claimed the
  // helper works there. The second version was `typeof btoa === "function" ?
  // btoa(...) : Buffer.from(...)` — still resting on one global being present.
  // A base64 encoder is twelve lines; depending on the runtime to supply one is
  // how this became a two-release mistake.
  //
  // btoa() would also be wrong on its own: it operates on latin-1, so any
  // non-ASCII byte is mangled. uqr emits ASCII today, which is exactly the kind
  // of fact that stops being true without anyone noticing.
  return `data:image/svg+xml;base64,${toBase64(utf8Bytes(svg))}`;
}

/** UTF-8 bytes, without TextEncoder. */
function utf8Bytes(str: string): number[] {
  const out: number[] = [];
  for (const ch of str) {
    let cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

/** RFC 4648 base64, without Buffer or btoa. */
function toBase64(bytes: number[]): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!, b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += A[b0 >> 2]! + A[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!;
    out += b1 === undefined ? "==" : A[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]! + (b2 === undefined ? "=" : A[b2 & 63]!);
  }
  return out;
}
