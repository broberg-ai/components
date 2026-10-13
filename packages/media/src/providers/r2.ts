// Cloudflare R2 provider. R2 speaks the S3 API, so this is a thin SigV4 layer
// over aws4fetch (tiny, zero-dep, runs in Node/Bun/edge/Workers). No AWS SDK.
import { AwsClient } from "aws4fetch";
import type {
  ListOptions,
  ListResult,
  MediaBody,
  MediaObject,
  MediaStore,
  R2Config,
  SignedUrlOptions,
  UploadOptions,
} from "../types";
import { safeKey } from "../safe-key";
import { clampLimit, deleteUnder, folderPrefix } from "../list";

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : XML_ENTITIES[e.toLowerCase()]!,
  );

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

    // S3 ListObjectsV2. The XML is small and flat; three fields are read
    // without pulling in a parser.
    async list(folder: string, opts: ListOptions = {}): Promise<ListResult> {
      const q = new URLSearchParams({ "list-type": "2", prefix: prefix + folderPrefix(folder, "r2", true), "max-keys": String(clampLimit(opts.limit)) });
      if (opts.cursor) q.set("continuation-token", opts.cursor);
      const res = await aws.fetch(`${base}?${q.toString()}`, { method: "GET" });
      if (!res.ok) {
        throw new Error(`media(r2): list failed ${res.status} ${await res.text().catch(() => "")}`.trim());
      }
      const xml = await res.text();
      const keys = [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) => decodeXml(m[1]!).slice(prefix.length)).sort();
      const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
      const next = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];
      return truncated && next ? { keys, cursor: decodeXml(next) } : { keys };
    },

    async deletePrefix(folder: string) {
      return deleteUnder(this, folder, "r2");
    },

    // F099.20 — S3 multipart, signed with the same SigV4 client. The server keeps the keys;
    // the client only ever sees short-lived presigned part addresses.
    multipart: {
      async create(key, opts) {
        const headers: Record<string, string> = {};
        if (opts?.contentType) headers["content-type"] = opts.contentType;
        const res = await aws.fetch(`${objectUrl(key)}?uploads`, { method: "POST", headers });
        const xml = await res.text().catch(() => "");
        if (!res.ok) throw new Error(`media(r2): multipart create failed ${res.status} ${xml}`.trim());
        const uploadId = xml.match(/<UploadId>([\s\S]*?)<\/UploadId>/)?.[1];
        if (!uploadId) throw new Error("media(r2): multipart create answered without an UploadId");
        return { key: normalize(key), uploadId: decodeXml(uploadId) };
      },
      async presignPart(key, uploadId, partNumber, opts) {
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) throw new Error(`media(r2): partNumber must be 1–10000, got ${partNumber}`);
        if (!uploadId) throw new Error("media(r2): uploadId is required");
        const q = new URLSearchParams({ partNumber: String(partNumber), uploadId, "X-Amz-Expires": String(opts?.expiresIn ?? 3600) });
        const signed = await aws.sign(`${objectUrl(key)}?${q.toString()}`, { method: "PUT", aws: { signQuery: true } });
        return signed.url;
      },
      async complete(key, uploadId, parts) {
        if (!parts.length) throw new Error("media(r2): complete needs at least one part");
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i]!;
          if (!Number.isInteger(p.partNumber) || p.partNumber < 1 || p.partNumber > 10000) throw new Error(`media(r2): bad partNumber ${p.partNumber}`);
          if (i > 0 && p.partNumber <= parts[i - 1]!.partNumber) throw new Error("media(r2): parts must be in ascending order without repeats");
          if (typeof p.etag !== "string" || !p.etag) throw new Error(`media(r2): part ${p.partNumber} has no ETag`);
        }
        const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const body = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${esc(p.etag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
        const res = await aws.fetch(`${objectUrl(key)}?${new URLSearchParams({ uploadId }).toString()}`, { method: "POST", body, headers: { "content-type": "application/xml" } });
        const xml = await res.text().catch(() => "");
        // S3 can answer 200 with an <Error> in the body — that is a failure, not a success.
        if (!res.ok || /<Error>/.test(xml)) throw new Error(`media(r2): multipart complete failed ${res.status} ${xml}`.trim());
        return { key: normalize(key) };
      },
      async abort(key, uploadId) {
        const res = await aws.fetch(`${objectUrl(key)}?${new URLSearchParams({ uploadId }).toString()}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) throw new Error(`media(r2): multipart abort failed ${res.status}`);
      },
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
