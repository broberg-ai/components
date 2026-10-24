/**
 * @broberg/phone — ring a person over the phone network (46elks), play a
 * message, ask for one key press to acknowledge, and learn how it went.
 *
 * Built for an alarm that must WAKE someone (Buzz). Facts from 46elks' own
 * docs, 24/10 2026 (plan-doc docs/features/F107-phone.md):
 *   - POST https://api.46elks.com/a1/calls, Basic auth, form-encoded;
 *   - no text-to-speech in production — the call PLAYS an audio URL, which the
 *     app makes with @broberg/ai-sdk `ai.tts` (Azure, Danish, EU) and hosts;
 *   - the `ivr` action POSTs the pressed digits to `next` as `result`;
 *   - `whenhangup` receives `state` = success | failed | busy;
 *   - 46elks does NOT sign webhooks, so every webhook URL carries our own
 *     secret token, and a hook without it is refused.
 *
 * Same contract as @broberg/sms / webpush / nativepush: never throws, failures
 * carry a `kind` (auth | payload | transient), `status` is known at boot,
 * no keys = ship-dark. Phone numbers are personal data: they appear masked in
 * every reason this package writes. Zero dependencies, no database.
 */
import { timingSafeEqual } from "node:crypto";

export type SenderStatus = "ready" | "no-keys" | "invalid-keys";
export type FailureKind = "auth" | "payload" | "transient";

export type PhoneConfig = {
  /** 46elks API username + password (Basic auth). */
  username: string;
  password: string;
  /** Caller id: one of your voice-enabled 46elks numbers, E.164. */
  from: string;
  /** Put into every webhook URL and checked on the way back — at least 16 characters. */
  webhookSecret: string;
  /** Test override. */
  apiOrigin?: string;
  fetch?: typeof fetch;
};

export type CallOptions = {
  /** A public URL to the message as audio (MP3/WAV) — e.g. made with `ai.tts`. */
  audioUrl: string;
  /** Your endpoint that receives both webhooks; `?event=ivr|hangup&t=<secret>&ack=<digit>` is appended. */
  webhookBase: string;
  /** The key that acknowledges. Default "1". */
  ackDigit?: string;
  /** Seconds to let it ring. 46elks default 60. */
  timeoutSeconds?: number;
  /** Seconds to wait for a key press, 1–30. Default 10. */
  inputTimeoutSeconds?: number;
  /** How many times the message is replayed while waiting. Default 3. */
  repeat?: number;
};

export type CallResult =
  | { ok: true; callId: string }
  | { ok: false; kind: FailureKind; statusCode: number | null; reason: string };

export type HangupEvent = {
  callId: string;
  /** success = the call connected · busy · failed (rejected, unreachable or not answered). */
  outcome: "answered" | "busy" | "failed";
  /** No pickup time on the hook: nobody answered. Not live-verified against 46elks yet. */
  neverAnswered: boolean;
  durationSeconds: number;
};

export type IvrEvent = {
  callId: string;
  /** The person pressed exactly the acknowledging key. */
  acknowledged: boolean;
  /** What was pressed ("" when nothing). */
  digits: string;
  /** 46elks' reason when no valid input came ("noinput"). */
  why?: string;
};

export type Parsed<T> = { ok: true; event: T } | { ok: false; reason: "bad-token" | "bad-body" };

const E164 = /^\+[1-9]\d{6,14}$/;
const API = "https://api.46elks.com";

/** "+4512345678" → "+45******78" — enough to recognise, not enough to call. */
export function maskNumber(n: string): string {
  return n.length <= 5 ? "***" : `${n.slice(0, 3)}${"*".repeat(n.length - 5)}${n.slice(-2)}`;
}

/** 46elks answer → outcome. */
export function classifyStatus(status: number): "ok" | FailureKind {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "auth";
  if (status === 400 || status === 404 || status === 422) return "payload";
  return "transient";
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const field = (body: URLSearchParams | Record<string, unknown>, k: string): string | undefined => {
  const v = body instanceof URLSearchParams ? body.get(k) : body[k];
  return v === null || v === undefined ? undefined : String(v);
};

export function createPhone(config: Partial<PhoneConfig> = {}) {
  const missing = !config.username || !config.password || !config.from || !config.webhookSecret;
  let status: SenderStatus = missing ? "no-keys" : "ready";
  let statusReason = missing ? "46elks username, password, from or webhookSecret is empty" : "";
  if (!missing) {
    if (!E164.test(config.from!)) { status = "invalid-keys"; statusReason = "from is not an E.164 number"; }
    else if (config.webhookSecret!.length < 16) { status = "invalid-keys"; statusReason = "webhookSecret is shorter than 16 characters"; }
  }
  const doFetch = config.fetch ?? fetch;

  /** Is this webhook request ours? `url` is the full request URL (with query). */
  function tokenOk(url: string): boolean {
    if (status !== "ready") return false;
    let t: string | null = null;
    try { t = new URL(url).searchParams.get("t"); } catch { return false; }
    return t !== null && sameSecret(t, config.webhookSecret!);
  }

  return {
    status,
    statusReason,

    /** Place one call. Never throws. */
    async call(to: string, o: CallOptions): Promise<CallResult> {
      if (status !== "ready") return { ok: false, kind: "auth", statusCode: null, reason: status === "no-keys" ? "no-keys" : `invalid-keys: ${statusReason}` };
      if (!E164.test(to)) return { ok: false, kind: "payload", statusCode: null, reason: `not an E.164 number: ${maskNumber(to)}` };
      const ack = o.ackDigit ?? "1";
      if (!/^[0-9*#]$/.test(ack)) return { ok: false, kind: "payload", statusCode: null, reason: "ackDigit must be one key: 0-9, * or #" };
      let hook: (event: string) => string;
      try {
        const base = new URL(o.webhookBase);
        hook = (event) => {
          const u = new URL(base);
          u.searchParams.set("event", event);
          u.searchParams.set("t", config.webhookSecret!);
          if (event === "ivr") u.searchParams.set("ack", ack);
          return u.toString();
        };
        new URL(o.audioUrl);
      } catch {
        return { ok: false, kind: "payload", statusCode: null, reason: "webhookBase or audioUrl is not a URL" };
      }
      const ivr = {
        ivr: o.audioUrl,
        digits: 1,
        timeout: Math.min(30, Math.max(1, o.inputTimeoutSeconds ?? 10)),
        repeat: o.repeat ?? 3,
        next: hook("ivr"),
      };
      const form = new URLSearchParams({ from: config.from!, to, voice_start: JSON.stringify(ivr), whenhangup: hook("hangup") });
      if (o.timeoutSeconds !== undefined) form.set("timeout", String(o.timeoutSeconds));
      try {
        const r = await doFetch(`${config.apiOrigin ?? API}/a1/calls`, {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        });
        const c = classifyStatus(r.status);
        const text = await r.text().catch(() => "");
        if (c !== "ok") return { ok: false, kind: c, statusCode: r.status, reason: `${text.slice(0, 200) || `HTTP ${r.status}`} (to ${maskNumber(to)})` };
        let id: string | undefined;
        try { id = JSON.parse(text).id; } catch { /* handled below */ }
        if (!id) return { ok: false, kind: "transient", statusCode: r.status, reason: "46elks answered without a call id" };
        return { ok: true, callId: id };
      } catch (err) {
        return { ok: false, kind: "transient", statusCode: null, reason: `${err instanceof Error ? err.message : String(err)} (to ${maskNumber(to)})` };
      }
    },

    /** The `whenhangup` webhook. Pass the parsed form body and the full request URL. */
    parseHangup(body: URLSearchParams | Record<string, unknown>, url: string): Parsed<HangupEvent> {
      if (!tokenOk(url)) return { ok: false, reason: "bad-token" };
      const id = field(body, "id");
      const state = field(body, "state");
      if (!id || (state !== "success" && state !== "busy" && state !== "failed")) return { ok: false, reason: "bad-body" };
      return {
        ok: true,
        event: {
          callId: id,
          outcome: state === "success" ? "answered" : state,
          neverAnswered: !field(body, "start"),
          durationSeconds: Number(field(body, "duration") ?? 0) || 0,
        },
      };
    },

    /** The `ivr` `next` webhook — the key press. Pass the parsed form body and the full request URL. */
    parseIvr(body: URLSearchParams | Record<string, unknown>, url: string): Parsed<IvrEvent> {
      if (!tokenOk(url)) return { ok: false, reason: "bad-token" };
      const id = field(body, "callid");
      if (!id) return { ok: false, reason: "bad-body" };
      const ack = new URL(url).searchParams.get("ack") ?? "1";
      const result = field(body, "result") ?? "";
      const digits = result === "failed" ? "" : result;
      const why = field(body, "why");
      return { ok: true, event: { callId: id, acknowledged: digits === ack, digits, ...(why ? { why } : {}) } };
    },
  };
}

export type Phone = ReturnType<typeof createPhone>;
