/**
 * @broberg/nativepush — push to NATIVE apps: Apple APNs + Google FCM (HTTP v1).
 * The sibling of @broberg/webpush (Web Push / VAPID), with the same contract:
 * a sender that never throws, reports `dead` tokens to prune, keeps every other
 * failure apart as `failed` with a `kind` to act on, and knows at boot whether
 * it can deliver at all.
 *
 * The APNs half is ported from buddy (apps/server/src/push/apns.ts, F086.6):
 * token auth with ONE ES256 JWT from the team .p8 key, reused under an hour,
 * HTTP/2 via node:http2 (APNs requires h2). Changes from buddy: the key is
 * passed in (not read from a path in env), the JWT is cached per sender (not
 * per process), one h2 connection serves a whole send, and the outcome is
 * classified instead of returned raw.
 *
 * Server-side only. No dependencies. No database — you own the tokens.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, constants, type ClientHttp2Session } from "node:http2";

// ── Types ────────────────────────────────────────────────────────────────

export type Platform = "ios" | "android";

/** One device: the token its app registered with APNs or FCM. */
export type NativeTarget = { platform: Platform; token: string };

export type ApnsConfig = {
  /** Contents of the AuthKey_<keyId>.p8 file (PKCS#8 PEM). The key, not a path. */
  key: string;
  /** The key's 10-character Key ID (JWT header `kid`). */
  keyId: string;
  /** Apple Developer Team ID (JWT claim `iss`). */
  teamId: string;
  /** The app's bundle id (the `apns-topic` header). */
  topic: string;
  /** Debug builds register against the SANDBOX; App Store/TestFlight builds
   *  against production. Required on purpose: a token sent to the wrong one
   *  answers 400 BadDeviceToken, which looks like a broken token and is not. */
  production: boolean;
  /** Test override of the APNs origin (e.g. a local h2c server). */
  host?: string;
};

/** A Firebase service account — the downloaded JSON, as a string or parsed. */
export type FcmServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type FcmConfig = {
  serviceAccount: string | FcmServiceAccount;
  /** Test/runtime override; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Test override of the FCM origin. */
  fcmOrigin?: string;
};

/** How loudly iOS may present it. `critical` breaks through silent mode and
 *  Focus — it needs Apple's Critical Alerts entitlement on the app, and
 *  without it iOS delivers it as an ordinary alert. `time-sensitive` breaks
 *  through Focus without the entitlement (needs the Time Sensitive capability). */
export type InterruptionLevel = "passive" | "active" | "time-sensitive" | "critical";

export type NativePushMessage = {
  title?: string;
  body?: string;
  /** Custom keys delivered to the app. FCM requires string values. */
  data?: Record<string, string>;
  level?: InterruptionLevel;
  /** A sound name, or a critical sound: `{ critical: true, volume: 0..1 }`. */
  sound?: string | { name?: string; critical?: boolean; volume?: number };
  /** Let an iOS Notification Service Extension rewrite the notification. */
  mutableContent?: boolean;
  /** Replaces an earlier notification with the same id (APNs collapse id, FCM collapse key). */
  collapseId?: string;
  /** Drop it if it cannot be delivered within this many seconds. */
  ttlSeconds?: number;
  badge?: number;
  android?: {
    /** Send `data` only, no `notification` block — the app decides what to
     *  show (e.g. a full-screen alarm). Title/body are copied into data. */
    dataOnly?: boolean;
    channelId?: string;
  };
};

/** Why a send failed. Opposite responses, so not a boolean:
 *  `auth` — the keys/config are wrong; every send fails until it is fixed.
 *  `payload` — this request was rejected; a code or data fix.
 *  `transient` — 429, 5xx, network; try again later. */
export type SendFailureKind = "auth" | "payload" | "transient";

export type SendFailure = {
  platform: Platform;
  token: string;
  /** HTTP status, or `null` when there was no response at all. Always present. */
  statusCode: number | null;
  kind: SendFailureKind;
  /** APNs `reason` / FCM error code or message, for logs. Branch on `kind`. */
  reason: string;
};

export type SendResult = {
  sent: number;
  /** Tokens the platform says are gone for good (APNs 410, FCM UNREGISTERED).
   *  THE ONLY LIST YOU MAY DELETE FROM. */
  dead: NativeTarget[];
  /** Everything else that did not go out. NEVER DELETE THESE: with wrong keys
   *  this is EVERY token, and deleting them would empty your table over a typo.
   *  Always an array. */
  failed: SendFailure[];
  /** Something was attempted, nothing was sent, and nothing was merely gone —
   *  what wrong keys look like from the outside. The thing to alarm on. */
  allFailed: boolean;
};

/** Per platform, knowable at boot: `no-keys` is a deliberate dark ship,
 *  `invalid-keys` is always a bug. */
export type SenderStatus = "ready" | "no-keys" | "invalid-keys";

// ── Helpers ──────────────────────────────────────────────────────────────

const b64url = (b: Buffer | string): string => Buffer.from(b).toString("base64url");
const HOUR = 60 * 60;

function jwt(header: object, claims: object, key: KeyObject, ecdsa: boolean): string {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  // JWS ES256 wants raw r||s, not DER — ieee-p1363 gives exactly that.
  const sig = sign("sha256", Buffer.from(input), ecdsa ? { key, dsaEncoding: "ieee-p1363" } : key);
  return `${input}.${b64url(sig)}`;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── APNs ─────────────────────────────────────────────────────────────────

const APNS_SANDBOX = "https://api.sandbox.push.apple.com";
const APNS_PRODUCTION = "https://api.push.apple.com";

/** APNs status → outcome. Only 410 Unregistered is dead: 400 BadDeviceToken
 *  usually means sandbox/production were mixed up, and deleting on it would
 *  empty the table over one config flag. */
export function classifyApns(status: number): "sent" | "dead" | SendFailureKind {
  if (status === 200) return "sent";
  if (status === 410) return "dead";
  if (status === 401 || status === 403) return "auth";
  if (status === 400 || status === 404 || status === 405 || status === 413) return "payload";
  return "transient";
}

export function apnsPayload(m: NativePushMessage): string {
  const aps: Record<string, unknown> = {};
  if (m.title !== undefined || m.body !== undefined) aps.alert = { title: m.title, body: m.body };
  if (typeof m.sound === "string") aps.sound = m.sound;
  else if (m.sound) {
    aps.sound = m.sound.critical
      ? { critical: 1, name: m.sound.name ?? "default", volume: m.sound.volume ?? 1 }
      : (m.sound.name ?? "default");
  }
  if (m.badge !== undefined) aps.badge = m.badge;
  if (m.level) aps["interruption-level"] = m.level;
  if (m.mutableContent) aps["mutable-content"] = 1;
  return JSON.stringify({ ...(m.data ?? {}), aps });
}

// ── FCM ──────────────────────────────────────────────────────────────────

const FCM_ORIGIN = "https://fcm.googleapis.com";
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** FCM v1 error → outcome. UNREGISTERED is the only dead one. SENDER_ID_MISMATCH
 *  (the token belongs to another Firebase project) and THIRD_PARTY_AUTH_ERROR
 *  (FCM could not reach APNs with our credentials) arrive as 403/401 — config
 *  faults, never a reason to delete. */
export function classifyFcm(status: number, code: string | undefined): "dead" | SendFailureKind {
  if (code === "UNREGISTERED") return "dead";
  if (status === 401 || status === 403) return "auth";
  if (status === 400 || status === 404) return "payload";
  return "transient";
}

export function fcmMessage(token: string, m: NativePushMessage): object {
  const dataOnly = m.android?.dataOnly === true;
  const data: Record<string, string> = { ...(m.data ?? {}) };
  if (dataOnly) {
    if (m.title !== undefined) data.title = m.title;
    if (m.body !== undefined) data.body = m.body;
  }
  const android: Record<string, unknown> = { priority: "high" };
  if (m.ttlSeconds !== undefined) android.ttl = `${m.ttlSeconds}s`;
  if (m.collapseId) android.collapse_key = m.collapseId;
  if (!dataOnly && m.android?.channelId) android.notification = { channel_id: m.android.channelId };
  return {
    message: {
      token,
      ...(dataOnly || (m.title === undefined && m.body === undefined) ? {} : { notification: { title: m.title, body: m.body } }),
      ...(Object.keys(data).length ? { data } : {}),
      android,
    },
  };
}

// ── The sender ───────────────────────────────────────────────────────────

export type NativePushSenderOptions = {
  apns?: ApnsConfig;
  fcm?: FcmConfig;
  /** Clock override for tests (ms). */
  now?: () => number;
};

export function createNativePushSender(opts: NativePushSenderOptions = {}) {
  const now = opts.now ?? Date.now;

  // Boot-time readback: parse the keys now, so a broken key is known at start
  // and not on the first alarm.
  let apnsKey: KeyObject | null = null;
  let apnsStatus: SenderStatus = "no-keys";
  let apnsReason = "no APNs config";
  const a = opts.apns;
  if (a && a.key && a.keyId && a.teamId && a.topic) {
    try {
      const k = createPrivateKey({ key: a.key, format: "pem" });
      if (k.asymmetricKeyType !== "ec") throw new Error(`APNs key is ${k.asymmetricKeyType}, not an EC (.p8) key`);
      apnsKey = k;
      apnsStatus = "ready";
      apnsReason = "";
    } catch (err) {
      apnsStatus = "invalid-keys";
      apnsReason = errText(err);
    }
  } else if (a) {
    apnsReason = "APNs key, keyId, teamId or topic is empty";
  }

  let fcmAccount: FcmServiceAccount | null = null;
  let fcmKey: KeyObject | null = null;
  let fcmStatus: SenderStatus = "no-keys";
  let fcmReason = "no FCM config";
  if (opts.fcm?.serviceAccount) {
    try {
      const sa = typeof opts.fcm.serviceAccount === "string" ? (JSON.parse(opts.fcm.serviceAccount) as FcmServiceAccount) : opts.fcm.serviceAccount;
      if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error("service account lacks project_id, client_email or private_key");
      const k = createPrivateKey({ key: sa.private_key, format: "pem" });
      if (k.asymmetricKeyType !== "rsa") throw new Error(`service account key is ${k.asymmetricKeyType}, not RSA`);
      fcmAccount = sa;
      fcmKey = k;
      fcmStatus = "ready";
      fcmReason = "";
    } catch (err) {
      fcmStatus = "invalid-keys";
      fcmReason = errText(err);
    }
  }

  // APNs provider token: valid for an hour, refreshed at 50 minutes (buddy's rule).
  let apnsJwt: { token: string; at: number } | null = null;
  const providerToken = (): string => {
    const t = now();
    if (apnsJwt && t - apnsJwt.at < 50 * 60 * 1000) return apnsJwt.token;
    const token = jwt({ alg: "ES256", kid: a!.keyId }, { iss: a!.teamId, iat: Math.floor(t / 1000) }, apnsKey!, true);
    apnsJwt = { token, at: t };
    return token;
  };

  // FCM OAuth access token, cached until five minutes before it expires.
  const doFetch = opts.fcm?.fetch ?? fetch;
  let fcmToken: { token: string; until: number } | null = null;
  const accessToken = async (): Promise<string> => {
    const t = now();
    if (fcmToken && t < fcmToken.until) return fcmToken.token;
    const sa = fcmAccount!;
    const aud = sa.token_uri ?? GOOGLE_TOKEN_URI;
    const iat = Math.floor(t / 1000);
    const assertion = jwt({ alg: "RS256", typ: "JWT" }, { iss: sa.client_email, scope: FCM_SCOPE, aud, iat, exp: iat + HOUR }, fcmKey!, false);
    const r = await doFetch(aud, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!r.ok || !j.access_token) throw Object.assign(new Error(`token endpoint ${r.status}: ${j.error ?? "no access_token"}`), { statusCode: r.status });
    fcmToken = { token: j.access_token, until: t + ((j.expires_in ?? HOUR) - 300) * 1000 };
    return j.access_token;
  };

  async function sendApns(targets: NativeTarget[], m: NativePushMessage, out: SendResult): Promise<void> {
    const fail = (tg: NativeTarget, statusCode: number | null, kind: SendFailureKind, reason: string) =>
      out.failed.push({ platform: "ios", token: tg.token, statusCode, kind, reason });
    if (apnsStatus !== "ready") {
      for (const tg of targets) fail(tg, null, "auth", apnsStatus === "no-keys" ? "no-keys" : `invalid-keys: ${apnsReason}`);
      return;
    }
    let client: ClientHttp2Session;
    try {
      client = connect(a!.host ?? (a!.production ? APNS_PRODUCTION : APNS_SANDBOX));
    } catch (err) {
      for (const tg of targets) fail(tg, null, "transient", errText(err));
      return;
    }
    let connError: string | null = null;
    client.on("error", (err) => { connError = errText(err); });
    let bearer: string;
    try {
      bearer = providerToken();
    } catch (err) {
      client.close();
      for (const tg of targets) fail(tg, null, "auth", `could not sign the APNs token: ${errText(err)}`);
      return;
    }
    const payload = apnsPayload(m);
    const headers: Record<string, string> = {
      [constants.HTTP2_HEADER_METHOD]: "POST",
      authorization: `bearer ${bearer}`,
      "apns-topic": a!.topic,
      "apns-push-type": "alert",
      // 5 = deliver when convenient; anything that wants attention is 10.
      "apns-priority": m.level === "passive" ? "5" : "10",
      "content-type": "application/json",
    };
    if (m.collapseId) headers["apns-collapse-id"] = m.collapseId;
    if (m.ttlSeconds !== undefined) headers["apns-expiration"] = String(Math.floor(now() / 1000) + m.ttlSeconds);

    await Promise.all(targets.map((tg) => new Promise<void>((resolve) => {
      let status = 0;
      let raw = "";
      let req;
      try {
        req = client.request({ ...headers, [constants.HTTP2_HEADER_PATH]: `/3/device/${tg.token}` });
      } catch (err) {
        fail(tg, null, "transient", errText(err));
        resolve();
        return;
      }
      req.setEncoding("utf8");
      req.on("response", (h) => { status = Number(h[constants.HTTP2_HEADER_STATUS]) || 0; });
      req.on("data", (c: string) => { raw += c; });
      req.on("error", (err) => { fail(tg, status || null, "transient", errText(err)); resolve(); });
      req.on("end", () => {
        let reason = raw;
        try { reason = JSON.parse(raw).reason ?? raw; } catch { /* a non-JSON body is logged as-is */ }
        if (!status) fail(tg, null, "transient", connError ?? (reason || "no response"));
        else {
          const c = classifyApns(status);
          if (c === "sent") out.sent++;
          else if (c === "dead") out.dead.push(tg);
          else fail(tg, status, c, reason || `HTTP ${status}`);
        }
        resolve();
      });
      req.end(payload);
    })));
    client.close();
  }

  async function sendFcm(targets: NativeTarget[], m: NativePushMessage, out: SendResult): Promise<void> {
    const fail = (tg: NativeTarget, statusCode: number | null, kind: SendFailureKind, reason: string) =>
      out.failed.push({ platform: "android", token: tg.token, statusCode, kind, reason });
    if (fcmStatus !== "ready") {
      for (const tg of targets) fail(tg, null, "auth", fcmStatus === "no-keys" ? "no-keys" : `invalid-keys: ${fcmReason}`);
      return;
    }
    let bearer: string;
    try {
      bearer = await accessToken();
    } catch (err) {
      const sc = (err as { statusCode?: number }).statusCode ?? null;
      // The token endpoint refusing our service account is an auth fault for
      // every Android send; not reaching it at all is transient.
      const kind: SendFailureKind = sc !== null && sc >= 400 && sc < 500 && sc !== 429 ? "auth" : "transient";
      for (const tg of targets) fail(tg, sc, kind, errText(err));
      return;
    }
    const url = `${opts.fcm!.fcmOrigin ?? FCM_ORIGIN}/v1/projects/${fcmAccount!.project_id}/messages:send`;
    await Promise.all(targets.map(async (tg) => {
      try {
        const r = await doFetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify(fcmMessage(tg.token, m)),
        });
        if (r.ok) { out.sent++; return; }
        const j = (await r.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } };
        const code = j.error?.details?.find((d) => d.errorCode)?.errorCode ?? j.error?.status;
        const c = classifyFcm(r.status, code);
        if (c === "dead") out.dead.push(tg);
        else fail(tg, r.status, c, code ?? j.error?.message ?? `HTTP ${r.status}`);
      } catch (err) {
        fail(tg, null, "transient", errText(err));
      }
    }));
  }

  return {
    /** Per platform, decided at construction. */
    status: { apns: apnsStatus, fcm: fcmStatus } as { apns: SenderStatus; fcm: SenderStatus },
    /** Why a platform is not `ready` ("" when it is). */
    statusReason: { apns: apnsReason, fcm: fcmReason },
    /** Send one message to many devices. Never throws. */
    async send(targets: NativeTarget[], message: NativePushMessage): Promise<SendResult> {
      const out: SendResult = { sent: 0, dead: [], failed: [], allFailed: false };
      const ios = targets.filter((t) => t.platform === "ios");
      const android = targets.filter((t) => t.platform === "android");
      // Both halves catch every failure per token and resolve — nothing here throws.
      await Promise.all([ios.length ? sendApns(ios, message, out) : null, android.length ? sendFcm(android, message, out) : null]);
      out.allFailed = out.failed.length > 0 && out.sent === 0 && out.dead.length === 0;
      return out;
    },
  };
}

export type NativePushSender = ReturnType<typeof createNativePushSender>;
