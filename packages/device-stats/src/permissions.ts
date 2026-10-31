/**
 * @broberg/device-stats/permissions — what is ALREADY switched on (F078.4).
 *
 * Christian, 2026-08-28: *"kan vi ikke spørge om DET ER SLÅET til ikke om
 * brugere VIL slå det til? En status om det er slået til eller fra"* — exactly
 * so. Every read here is passive. This module is structurally incapable of
 * prompting, and a test greps the source to keep it that way: measuring a
 * permission by asking for it would turn an analytics library into a consent
 * dialog on somebody else's product, which is invisible in code review and
 * unmissable to the person using the app.
 *
 * FIVE STATES, NOT TWO. The reason was MEASURED (2026-08-28, via Lens, same page
 * and same module in both engines) after the documentation-based reason turned
 * out to be wrong:
 *
 *   WebKit    permissions.query present -> prompt · prompt · prompt · prompt
 *   Chromium  permissions.query present -> denied · denied · denied · denied
 *
 * Two engines, an identical page, opposite answers for every single name. A
 * permission read is not engine-independent, so the states have to be able to
 * say more than yes/no. `unsupported` and `error` cost nothing when the browser
 * DOES answer, and they are the difference between a wrong statistic and an
 * honest one when it does not.
 *
 * (iOS Safari is a different build again and remains UNVERIFIED — Playwright's
 * webkit is not it. Unmeasured is its own state, which is rather the point.)
 */

/**
 * `unsupported` = the browser has no opinion to give. `error` = asking failed.
 * Neither is `denied`, and `prompt` (not asked yet) is the most actionable state
 * of all — those people can still say yes.
 */
export type PermissionState = "granted" | "denied" | "prompt" | "unsupported" | "error";

/** A CAPABILITY, not a consent. See `platformAuthenticator`. */
export type AuthenticatorAvailability = "available" | "unavailable" | "unsupported" | "error";

/** The permissions we actually use. One we do not use is entropy collected for nothing. */
export const PERMISSION_NAMES = ["notifications", "geolocation", "camera", "microphone"] as const;
export type PermissionName = (typeof PERMISSION_NAMES)[number];

export interface PermissionFacts extends Record<PermissionName, PermissionState> {
  /**
   * Does this DEVICE offer Face ID / Touch ID / Windows Hello.
   *
   * F078.5 — READ THIS BEFORE YOU NAME IT «Face ID» ON A DASHBOARD. `available`
   * is ALSO what a device with only a PASSCODE answers: the browser's only
   * question (`isUserVerifyingPlatformAuthenticatorAvailable`) asks «can a
   * built-in authenticator verify the user», and the spec deliberately hides
   * HOW, because naming the modality would fingerprint the device. It does
   * NOT mean biometrics are enrolled and it can never say Face ID. For that,
   * a native app reports {@link BiometricFacts}.
   *
   * Deliberately outside the permission map and with its own state union, so
   * that `platformAuthenticator: "granted"` cannot be written. Face ID is not a
   * permission and no browser exposes one — this says the hardware is there, NOT
   * that anyone allowed anything, and NOT that they registered a passkey with
   * you. That last one is your own database's answer, not the device's.
   */
  platformAuthenticator: AuthenticatorAvailability;
}

// ---------------------------------------------------------------------------
// the environment, structurally — no DOM lib types, no vendor imports
// ---------------------------------------------------------------------------

interface PermissionStatusLike {
  state?: string;
}

export interface PermissionsNavigatorLike {
  permissions?: { query?: (desc: { name: string }) => Promise<PermissionStatusLike> };
}

export interface PermissionsGlobalLike {
  navigator?: PermissionsNavigatorLike;
  Notification?: { permission?: string };
  PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> };
}

function known(state: unknown): PermissionState | undefined {
  return state === "granted" || state === "denied" || state === "prompt" ? state : undefined;
}

/**
 * Ask the Permissions API about one name.
 *
 * A THROWN `TypeError` MEANS "THIS BROWSER DOES NOT KNOW THAT NAME" — that is
 * how the Permissions API is specified to reject an unrecognised name, and it is
 * the branch this file exists for. Anything else that goes wrong is `error`.
 * Both are reported as themselves; a question that cannot be asked reads as
 * unasked, never as a refusal.
 */
async function queryPermission(
  nav: PermissionsNavigatorLike | undefined,
  name: string,
): Promise<PermissionState> {
  const query = nav?.permissions?.query;
  if (typeof query !== "function") return "unsupported";
  try {
    const status = await query.call(nav!.permissions, { name });
    return known(status?.state) ?? "unsupported";
  } catch (err) {
    return err instanceof TypeError ? "unsupported" : "error";
  }
}

/**
 * Notifications have a second, older source: `Notification.permission`. It is a
 * plain getter — reading it never prompts — and Safari supports it where it does
 * not support the Permissions API.
 *
 * The Permissions API wins when it answers, because it separates `prompt` from
 * `denied`. `Notification.permission`'s `"default"` means the same as `prompt`.
 */
async function readNotifications(g: PermissionsGlobalLike): Promise<PermissionState> {
  const viaApi = await queryPermission(g.navigator, "notifications");
  if (viaApi !== "unsupported") return viaApi;

  let raw: unknown;
  try {
    raw = g.Notification?.permission;
  } catch {
    return "error";
  }
  if (raw === "default") return "prompt";
  return known(raw) ?? "unsupported";
}

/**
 * Never prompts, never shows UI: it reports whether the platform authenticator
 * exists, not whether anyone will use it.
 */
async function readPlatformAuthenticator(g: PermissionsGlobalLike): Promise<AuthenticatorAvailability> {
  const check = g.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable;
  if (typeof check !== "function") return "unsupported";
  try {
    return (await check.call(g.PublicKeyCredential)) ? "available" : "unavailable";
  } catch {
    return "error";
  }
}

/**
 * Read what is already switched on. Passive, concurrent, and it never throws —
 * one failing read degrades that ONE fact and takes nothing else down with it.
 *
 * `globalLike` is injected so this is testable with no browser, and so the
 * consent gate in `collectDeviceDetail` can return BEFORE a global is ever
 * resolved.
 */
export async function readPermissionFacts(globalLike: PermissionsGlobalLike): Promise<PermissionFacts> {
  const [notifications, geolocation, camera, microphone, platformAuthenticator] = await Promise.all([
    readNotifications(globalLike),
    queryPermission(globalLike.navigator, "geolocation"),
    queryPermission(globalLike.navigator, "camera"),
    queryPermission(globalLike.navigator, "microphone"),
    readPlatformAuthenticator(globalLike),
  ]);
  return { notifications, geolocation, camera, microphone, platformAuthenticator };
}


// ---------------------------------------------------------------------------
// F078.5 — biometrics, as only a NATIVE app can report them
// ---------------------------------------------------------------------------

/**
 * WHO answered. Without it, «unknown» would mean both «the user has none» and
 * «we could not ask», and nothing in the data would separate them.
 */
export type BiometricSource = "native-ios" | "native-android" | "web-cannot-tell";

/**
 * Is a biometric ENROLLED — answerable on iOS (`LAContext.canEvaluatePolicy`)
 * AND on Android (`BiometricManager.canAuthenticate(BIOMETRIC_STRONG)`).
 * `unknown` only from a source that cannot ask (the web).
 */
export interface BiometricEnrolment {
  enrolled: "yes" | "no" | "no-hardware" | "unknown";
  source: BiometricSource;
}

/** The one reason Android's modality is unknown — stated, never inferred. */
export const ANDROID_MODALITY_REASON =
  "Android has no public API for WHICH biometric is enrolled or will be used; PackageManager.hasSystemFeature reports hardware, not enrolment" as const;
/** Why the web can never answer either question. */
export const WEB_BIOMETRICS_REASON =
  "no web API names a biometric or says one is enrolled; isUserVerifyingPlatformAuthenticatorAvailable is also true for a passcode" as const;

/**
 * WHICH biometric — answerable on iOS only (`LAContext.biometryType`).
 *
 * On Android it is `unknown` BY CONSTRUCTION: there is no public API for the
 * modality of the ENROLLED biometric, and `hasSystemFeature(FEATURE_FACE)`
 * reports that face HARDWARE exists — not that a face is enrolled or will be
 * used. The Android branch of this union cannot carry «face» or «fingerprint»;
 * a guess there would be a measurement on iOS and a guess on Android in the
 * same field, agreeing with whoever reads it.
 */
export type BiometricModality =
  | { modality: "face" | "fingerprint" | "iris" | "none"; source: "native-ios" }
  | { modality: "unknown"; source: "native-android"; reason: typeof ANDROID_MODALITY_REASON }
  | { modality: "unknown"; source: "web-cannot-tell"; reason: typeof WEB_BIOMETRICS_REASON };

/** Enrolment and modality are SEPARATE facts, each carrying its own source. */
export interface BiometricFacts {
  enrolment: BiometricEnrolment;
  modality: BiometricModality;
}

/** iOS: what the app read from LAContext. `biometryType` as LABiometryType names it. */
export interface IosBiometryReading {
  /** `canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` */
  canEvaluate: boolean;
  /** `LAError.biometryNotAvailable` — the device has no biometric hardware. */
  noHardware?: boolean;
  biometryType: "faceID" | "touchID" | "opticID" | "none";
}

export function biometricsFromIos(r: IosBiometryReading): BiometricFacts & { modality: Extract<BiometricModality, { source: "native-ios" }> } {
  const modality = r.biometryType === "faceID" ? "face" : r.biometryType === "touchID" ? "fingerprint" : r.biometryType === "opticID" ? "iris" : "none";
  return {
    enrolment: { enrolled: r.canEvaluate ? "yes" : r.noHardware ? "no-hardware" : "no", source: "native-ios" },
    modality: { modality, source: "native-ios" },
  };
}

/** Android: `BiometricManager.canAuthenticate(BIOMETRIC_STRONG)` by its constant's name. */
export type AndroidCanAuthenticate =
  | "BIOMETRIC_SUCCESS"
  | "BIOMETRIC_ERROR_NONE_ENROLLED"
  | "BIOMETRIC_ERROR_NO_HARDWARE"
  | "BIOMETRIC_ERROR_HW_UNAVAILABLE"
  | "BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED"
  | "BIOMETRIC_ERROR_UNSUPPORTED"
  | "BIOMETRIC_STATUS_UNKNOWN";

/**
 * Android. The return type pins `modality` to the Android branch, so a caller
 * cannot set «face» or «fingerprint» on an Android fact — that fails to compile.
 */
export function biometricsFromAndroid(
  canAuthenticate: AndroidCanAuthenticate,
): BiometricFacts & { modality: Extract<BiometricModality, { source: "native-android" }> } {
  const enrolled: BiometricEnrolment["enrolled"] =
    canAuthenticate === "BIOMETRIC_SUCCESS"
      ? "yes"
      : canAuthenticate === "BIOMETRIC_ERROR_NONE_ENROLLED"
        ? "no"
        : canAuthenticate === "BIOMETRIC_ERROR_NO_HARDWARE"
          ? "no-hardware"
          : "unknown";
  return {
    enrolment: { enrolled, source: "native-android" },
    modality: { modality: "unknown", source: "native-android", reason: ANDROID_MODALITY_REASON },
  };
}

/** No native report: what the WEB can say about biometrics — that it cannot tell. Never «none». */
export function biometricsUnknownOnWeb(): BiometricFacts {
  return {
    enrolment: { enrolled: "unknown", source: "web-cannot-tell" },
    modality: { modality: "unknown", source: "web-cannot-tell", reason: WEB_BIOMETRICS_REASON },
  };
}
