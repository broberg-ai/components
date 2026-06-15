// Cloudflare R2 provider. R2 speaks the S3 API, so this is a thin SigV4 layer
// over aws4fetch (tiny, zero-dep, runs in Node/Bun/edge/Workers). No AWS SDK.
import { AwsClient } from "aws4fetch";
import type { MediaBody, MediaStore, R2Config, SignedUrlOptions, UploadOptions } from "../types";

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
  // R2 always uses region "auto"; the S3 service signs the request.
  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: "auto",
    service: "s3",
    retries: 2, // modest resilience against R2's transient 5xx/429 (aws4fetch defaults to 10)
  });

  const fullKey = (key: string) => prefix + key.replace(/^\/+/, "");
  const objectUrl = (key: string) => `${base}/${encodeKey(fullKey(key))}`;

  return {
    async upload(key: string, body: MediaBody, opts?: UploadOptions) {
      const headers: Record<string, string> = {};
      if (opts?.contentType) headers["content-type"] = opts.contentType;
      if (opts?.cacheControl) headers["cache-control"] = opts.cacheControl;
      const res = await aws.fetch(objectUrl(key), { method: "PUT", body: body as BodyInit, headers });
      if (!res.ok) {
        throw new Error(`media(r2): upload failed ${res.status} ${await res.text().catch(() => "")}`.trim());
      }
      return { key: fullKey(key) };
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
  };
}
