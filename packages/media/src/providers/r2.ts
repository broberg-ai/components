// Cloudflare R2 provider. R2 speaks the S3 API, so this is a thin SigV4 layer
// over aws4fetch (tiny, zero-dep, runs in Node/Bun/edge/Workers). No AWS SDK.
import { AwsClient } from "aws4fetch";
import type {
  MediaBody,
  MediaObject,
  MediaStore,
  R2Config,
  SignedUrlOptions,
  UploadOptions,
} from "../types";
import { safeKey } from "../safe-key";

// R2's S3 endpoint host. The EU jurisdiction pins data-residency and MUST match
// how the bucket was created (jurisdiction is immutable at creation).
const r2Host = (accountId: string, jurisdiction?: string) =>
  jurisdiction === "eu"
    ? `${accountId}.eu.r2.cloudflarestorage.com`
    : `${accountId}.r2.cloudflarestorage.com`;

// Encode each path segment but keep the "/" separators intact.
const encodeKey = (key: string) =>
  key.split("/").map(encodeURIComponent).join("/");

export function createR2Store(cfg: R2Config): MediaStore {
  const base = `https://${r2Host(cfg.accountId, cfg.jurisdiction)}/${cfg.bucket}`;
  const prefix = cfg.keyPrefix ? `${cfg.keyPrefix.replace(/\/+$/, "")}/` : "";
  const publicBase = cfg.publicBaseUrl ? cfg.publicBaseUrl.replace(/\/+$/, "") : undefined;
  // R2 always uses region "auto"; the S3 service signs the request.
  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: "auto",
    service: "s3",
    retries: 2, // modest resilience against R2's transient 5xx/429 (aws4fetch defaults to 10)
  });

  // Strip a leading slash so callers can pass "/logo.png" or "logo.png" alike,
  // and REFUSE anything that would climb out of the bucket or the prefix.
  //
  // Stripping alone is not enough and used to be all this did. `encodeKey`
  // below looks like it sanitises the key, but `encodeURIComponent("..")` is
  // ".." — a dot is not encoded — so `..` reaches the URL intact and the URL
  // parser collapses it. `volume` refused the same key; `r2` did not. See
  // ../safe-key.ts for the measurement (F086).
  const normalize = (key: string) => safeKey(key, "r2");
  // The prefix is validated WITH the key, so a prefix cannot smuggle one in
  // either — the same second pass volume has always done.
  const fullKey = (key: string) => safeKey(prefix + normalize(key), "r2");
  const objectUrl = (key: string) => `${base}/${encodeKey(fullKey(key))}`;

  return {
    async upload(key: string, body: MediaBody, opts?: UploadOptions) {
      const headers: Record<string, string> = {};
      if (opts?.contentType) headers["content-type"] = opts.contentType;
      if (opts?.cacheControl) headers["cache-control"] = opts.cacheControl;
      // Cloudflare R2 requires Content-Length on PUT. In a patched-fetch runtime
      // (e.g. Next.js standalone on Fly) a Uint8Array/ArrayBuffer body is streamed
      // chunked and the header is dropped → 411 MissingContentLength. Set it
      // explicitly when the body's byte length is known. Harmless elsewhere:
      // plain Node/undici computes it anyway; strings/Blobs/streams are left to
      // fetch (a string has no byteLength, so it's skipped, not sent wrong).
      const byteLength = (body as { byteLength?: unknown } | null)?.byteLength;
      if (typeof byteLength === "number") headers["content-length"] = String(byteLength);
      const res = await aws.fetch(objectUrl(key), { method: "PUT", body: body as BodyInit, headers });
      if (!res.ok) {
        throw new Error(`media(r2): upload failed ${res.status} ${await res.text().catch(() => "")}`.trim());
      }
      // Return the LOGICAL key (prefix applied internally) — safe to feed back
      // into signedUrl/delete/publicUrl without double-prefixing.
      return { key: normalize(key) };
    },

    async signedUrl(key: string, opts?: SignedUrlOptions) {
      const url = `${objectUrl(key)}?X-Amz-Expires=${opts?.expiresIn ?? 3600}`;
      const signed = await aws.sign(url, { method: "GET", aws: { signQuery: true } });
      return signed.url;
    },

    async delete(key: string) {
      const res = await aws.fetch(objectUrl(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new Error(`media(r2): delete failed ${res.status}`);
      }
    },

    async get(key: string): Promise<MediaObject | null> {
      const res = await aws.fetch(objectUrl(key), { method: "GET" });
      // 404 is an answer ("not there"); anything else that is not ok is a
      // failure to ASK, and must not be collapsed into the same null.
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`media(r2): get failed ${res.status} ${await res.text().catch(() => "")}`.trim());
      }
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? undefined,
      };
    },

    publicUrl(key: string): string {
      if (!publicBase) {
        throw new Error(
          "media(r2): publicUrl requires publicBaseUrl in the config (the bucket's " +
            "public R2 custom-domain or r2.dev URL). Public access is off until it is set.",
        );
      }
      return `${publicBase}/${encodeKey(fullKey(key))}`;
    },
  };
}
