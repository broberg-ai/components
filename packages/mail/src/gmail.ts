/**
 * F005.20 — send AS the user, from their own Gmail: the mail lands in their
 * Sent folder, in the right conversation, signed by their own domain.
 *
 *     const mailer = createMailer({ transport: gmailTransport({ getAccessToken }), live: true });
 *     await mailer.send({ to, subject, text, threadId, inReplyTo, references });
 *
 * The package never signs a JWT and never stores a token: the caller hands in a
 * function that returns a valid access token (a user's OAuth token with
 * gmail.send / gmail.compose / gmail.modify, or a delegated one — the caller's
 * business). The token never appears in an error, a log line or a result.
 *
 * Only messages.send. Drafts are a separate decision.
 */
import type { MailMessage, MailTransport, MailTransportRequest, MailTransportResult } from "./index.js";

export interface GmailTransportOptions {
  /** Returns a valid access token. Called once per send. */
  getAccessToken: () => Promise<string>;
  /** Gmail user id. Default "me" — the account the token belongs to. */
  userId?: string;
  /** Injectable fetch (tests / custom runtimes). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

const API = "https://gmail.googleapis.com/gmail/v1/users";

const list = (v: string | string[] | undefined): string[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function b64(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "utf8").toString("base64");
  let bin = "";
  for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin);
}
const b64url = (s: string) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** RFC 2047 for a header value that is not plain ASCII. */
const encodeWord = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`);

/** "Name <a@b>" with a non-ASCII name → encoded name, address untouched. */
function encodeAddress(a: string): string {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(a);
  if (!m) return a.trim();
  const name = m[1]!.replace(/^"(.*)"$/, "$1");
  return name ? `${encodeWord(name)} <${m[2]}>` : `<${m[2]}>`;
}

class HeaderInjection extends Error {}

/** A CR or LF in any header value would let a caller write extra headers. Refuse, never strip. */
function header(name: string, value: string): string {
  if (/[\r\n]/.test(value) || /[\r\n:]/.test(name)) throw new HeaderInjection(name);
  return `${name}: ${value}`;
}

/** The finished message as RFC 5322, ready for Gmail's `raw`. Exported for tests. */
export function buildMime(req: MailTransportRequest, boundary = `bm_${Math.random().toString(36).slice(2)}`): string {
  const m: MailMessage = req.message;
  const addr = (v: string | string[] | undefined) => list(v).map(encodeAddress).join(", ");
  const lines: string[] = [header("From", encodeAddress(req.from)), header("To", addr(m.to))];
  if (m.cc != null) lines.push(header("Cc", addr(m.cc)));
  if (m.bcc != null) lines.push(header("Bcc", addr(m.bcc)));
  if (m.replyTo != null) lines.push(header("Reply-To", addr(m.replyTo)));
  lines.push(header("Subject", encodeWord(m.subject)));
  if (m.inReplyTo) lines.push(header("In-Reply-To", m.inReplyTo));
  const refs = [...list(m.references), ...(m.inReplyTo && !list(m.references).includes(m.inReplyTo) ? [m.inReplyTo] : [])];
  if (refs.length) lines.push(header("References", refs.join(" ")));
  for (const [k, v] of Object.entries(m.headers ?? {})) lines.push(header(k, v));
  lines.push("MIME-Version: 1.0");
  const part = (type: string, body: string) => [`Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", b64(body)];
  if (req.html != null && req.text != null) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, "");
    lines.push(`--${boundary}`, ...part("text/plain", req.text), `--${boundary}`, ...part("text/html", req.html), `--${boundary}--`);
  } else if (req.html != null) {
    lines.push(...part("text/html", req.html));
  } else {
    lines.push(...part("text/plain", req.text ?? ""));
  }
  return lines.join("\r\n");
}

export function gmailTransport(options: GmailTransportOptions): MailTransport {
  const userId = options.userId ?? "me";
  return {
    name: "gmail",
    async send(req): Promise<MailTransportResult> {
      if (req.message.attachments?.length) return { ok: false, error: "gmail: attachments are not supported by this transport yet" };
      const doFetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
      if (!doFetch) return { ok: false, error: "gmail: no fetch available" };

      let raw: string;
      try {
        raw = b64url(buildMime(req));
      } catch (e) {
        if (e instanceof HeaderInjection) return { ok: false, error: `gmail: header ${e.message} contains a line break — refused` };
        throw e;
      }

      let token: string;
      try {
        token = await options.getAccessToken();
      } catch (e) {
        // The provider's own error may carry the credential; only its type leaves here.
        return { ok: false, error: `gmail: no access token (${e instanceof Error ? e.name : "error"})` };
      }
      if (!token) return { ok: false, error: "gmail: no access token" };
      const redact = (s: string) => s.split(token).join("[redacted]");

      try {
        const res = await doFetch(`${API}/${encodeURIComponent(userId)}/messages/send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ raw, ...(req.message.threadId ? { threadId: req.message.threadId } : {}) }),
        });
        const body = (await res.json().catch(() => ({}))) as { id?: string; threadId?: string; error?: { message?: string; status?: string } };
        if (!res.ok) {
          const why = body.error?.status ?? body.error?.message ?? `http_${res.status}`;
          return { ok: false, error: redact(`gmail_http_${res.status}: ${why}`) };
        }
        return { ok: true, ...(body.id ? { id: body.id } : {}), ...(body.threadId ? { threadId: body.threadId } : {}) };
      } catch (e) {
        return { ok: false, error: redact(`gmail: ${e instanceof Error ? e.message : "send_failed"}`) };
      }
    },
  };
}
