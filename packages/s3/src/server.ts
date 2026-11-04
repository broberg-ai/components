// F111.1 — the server half of @broberg/s3. It holds the storage key and only ever
// hands the browser SHORT-LIVED, ONE-OBJECT signatures. Bytes never pass through
// the site's own server: the browser talks to the bucket directly.
import { AwsClient } from "aws4fetch";

/** Where a bucket lives and how to sign for it. R2 in the EU is the default. */
export interface S3Config {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Cloudflare R2 account id → https://<id>.eu.r2.cloudflarestorage.com */
  accountId?: string;
  /** R2 jurisdiction. Defaults to "eu"; a non-EU R2 bucket must say "default" explicitly. */
  jurisdiction?: "eu" | "default";
  /** Any other S3-compatible endpoint origin (Tigris, AWS, MinIO), e.g. "https://fly.storage.tigris.dev". */
  endpoint?: string;
  /** Signing region. "auto" for R2 and Tigris (default); the bucket's region for AWS. */
  region?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export interface UploadedPart { partNumber: number; etag: string; size?: number }

/** A stored object. `metadata` only when asked for (one HEAD per object). */
export interface StoredObject { key: string; size: number; lastModified: string; metadata?: Record<string, string> }

/** A multipart upload that has not been completed or aborted yet. */
export interface PendingUpload {
  key: string;
  uploadId: string;
  initiated: string;
  /** Bytes the bucket already holds for it (sum of its parts). */
  sentBytes: number;
  /** From the marker written at start; absent for uploads started without @broberg/s3's handler. */
  totalBytes?: number;
  filename?: string;
  metadata?: Record<string, string>;
  /** The marker existed but was not valid JSON. */
  markerUnreadable?: boolean;
}

export interface ObjectInfo { size: number; lastModified: string; contentType: string | null; metadata: Record<string, string> }

/** Hidden folder that holds one small JSON marker per upload in progress. Never listed by listObjects. */
export const PENDING_DIR = ".s3-pending";
// Keyed by the OBJECT key, never the uploadId: R2 hands out a different uploadId
// string in ListMultipartUploads than at CreateMultipartUpload (both valid, not
// comparable — measured live 4/11 2026), so an id-keyed marker is never found again.
export const markerKeyFor = (key: string) => {
  const i = key.lastIndexOf("/");
  return `${key.slice(0, i + 1)}${PENDING_DIR}/${encodeURIComponent(key.slice(i + 1))}.json`;
};
const isMarker = (key: string) => key.split("/").includes(PENDING_DIR);

export const MIN_PART_SIZE = 8 * 1024 * 1024;
export const DEFAULT_PART_SIZE = 16 * 1024 * 1024;
export const MAX_PARTS = 10_000;
/** The longest a signed URL may live. A leaked link is useless after this. */
export const MAX_EXPIRES_SECONDS = 900;
const MiB = 1024 * 1024;

/** Part size for `size` bytes: at least `preferred` (and 8 MiB), and few enough parts for S3's 10,000 cap. */
export function choosePartSize(size: number, preferred = DEFAULT_PART_SIZE): number {
  const need = Math.ceil(size / MAX_PARTS);
  return Math.ceil(Math.max(preferred, MIN_PART_SIZE, need) / MiB) * MiB;
}

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");
const xmlText = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];
const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xmlUnescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export interface S3Signer {
  /** Begin a multipart upload. */
  start(input: { key: string; contentType?: string; metadata?: Record<string, string> }): Promise<{ uploadId: string }>;
  /** A presigned PUT for one part of one upload. */
  signPart(input: { key: string; uploadId: string; partNumber: number; expiresIn?: number }): Promise<string>;
  /** Parts the bucket already holds for this upload (the truth a resume starts from). */
  listParts(input: { key: string; uploadId: string }): Promise<UploadedPart[]>;
  complete(input: { key: string; uploadId: string; parts: UploadedPart[] }): Promise<void>;
  abort(input: { key: string; uploadId: string }): Promise<void>;
  /** A presigned GET; `filename` makes the browser save it under that name. */
  signDownload(input: { key: string; expiresIn?: number; filename?: string }): Promise<string>;
  /** Size of a stored object, or null when it does not exist. */
  head(key: string): Promise<number | null>;
  /** Size, date, type and x-amz-meta of a stored object, or null. */
  headObject(key: string): Promise<ObjectInfo | null>;
  /** Every object under `prefix` (all pages). Upload markers are left out. */
  listObjects(input: { prefix: string; includeMetadata?: boolean }): Promise<StoredObject[]>;
  /** Every unfinished upload under `prefix`, with how far it has got. */
  listUploads(input: { prefix: string }): Promise<PendingUpload[]>;
  /** Small server-side write (markers, manifests). Not for user files — those go browser → bucket. */
  putObject(input: { key: string; body: string; contentType?: string }): Promise<void>;
  /** Read a small object as text, or null when it does not exist. */
  getText(key: string): Promise<string | null>;
  deleteObject(key: string): Promise<void>;
}

/** x-amz-meta values must be header-safe: keys lower-case [a-z0-9-], values URI-encoded, ≤ 2 KB in all. */
export function metaHeaders(meta?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  let total = 0;
  for (const [k, v] of Object.entries(meta ?? {})) {
    const key = k.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!key) continue;
    const val = encodeURIComponent(String(v));
    total += key.length + val.length;
    if (total > 2000) throw new S3Error("@broberg/s3: metadata is larger than 2 KB", 400);
    out[`x-amz-meta-${key}`] = val;
  }
  return out;
}

const readMeta = (h: Headers): Record<string, string> => {
  const m: Record<string, string> = {};
  h.forEach((v, k) => { if (k.startsWith("x-amz-meta-")) { try { m[k.slice(11)] = decodeURIComponent(v); } catch { m[k.slice(11)] = v; } } });
  return m;
};

export class S3Error extends Error {
  constructor(message: string, readonly status: number, readonly s3Code?: string) {
    super(message);
    this.name = "S3Error";
  }
}

function originOf(cfg: S3Config): string {
  if (cfg.endpoint) return cfg.endpoint.replace(/\/+$/, "");
  if (!cfg.accountId) throw new Error("@broberg/s3: set accountId (R2) or endpoint (other S3-compatible storage)");
  const j = cfg.jurisdiction ?? "eu";
  return j === "eu" ? `https://${cfg.accountId}.eu.r2.cloudflarestorage.com` : `https://${cfg.accountId}.r2.cloudflarestorage.com`;
}

export function createS3Signer(cfg: S3Config): S3Signer {
  for (const f of ["bucket", "accessKeyId", "secretAccessKey"] as const)
    if (!cfg[f]) throw new Error(`@broberg/s3: ${f} is required`);
  const origin = originOf(cfg);
  const doFetch = cfg.fetch ?? ((r: Request) => fetch(r));
  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region ?? "auto",
    service: "s3",
  });
  const objectUrl = (key: string) => new URL(`${origin}/${encodeURIComponent(cfg.bucket)}/${encodeKey(key)}`);
  const clampExpiry = (s?: number) => Math.max(1, Math.min(s ?? MAX_EXPIRES_SECONDS, MAX_EXPIRES_SECONDS));

  async function call(method: string, url: URL, body?: string, headers?: Record<string, string>): Promise<string> {
    const signed = await aws.sign(url.toString(), { method, body, headers });
    const res = await doFetch(signed);
    const text = await res.text();
    // S3 can answer 200 with an <Error> body (CompleteMultipartUpload does).
    if (!res.ok || /<Error>/.test(text)) {
      const code = xmlText(text, "Code");
      throw new S3Error(`@broberg/s3: ${method} ${url.pathname} → ${res.status}${code ? ` ${code}` : ""}`, res.ok ? 502 : res.status, code);
    }
    return text;
  }

  async function presign(method: "PUT" | "GET", url: URL, expiresIn?: number): Promise<string> {
    url.searchParams.set("X-Amz-Expires", String(clampExpiry(expiresIn)));
    const signed = await aws.sign(url.toString(), { method, aws: { signQuery: true } });
    return signed.url;
  }

  const api: S3Signer = {
    async start({ key, contentType, metadata }) {
      const url = objectUrl(key);
      url.searchParams.set("uploads", "");
      const xml = await call("POST", url, undefined, { ...(contentType ? { "content-type": contentType } : {}), ...metaHeaders(metadata) });
      const uploadId = xmlText(xml, "UploadId");
      if (!uploadId) throw new S3Error("@broberg/s3: CreateMultipartUpload returned no UploadId", 502);
      return { uploadId: xmlUnescape(uploadId) };
    },
    async signPart({ key, uploadId, partNumber, expiresIn }) {
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS)
        throw new S3Error(`@broberg/s3: partNumber must be 1..${MAX_PARTS}`, 400);
      const url = objectUrl(key);
      url.searchParams.set("partNumber", String(partNumber));
      url.searchParams.set("uploadId", uploadId);
      return presign("PUT", url, expiresIn);
    },
    async listParts({ key, uploadId }) {
      const parts: UploadedPart[] = [];
      let marker: string | undefined;
      for (;;) {
        const url = objectUrl(key);
        url.searchParams.set("uploadId", uploadId);
        if (marker) url.searchParams.set("part-number-marker", marker);
        const xml = await call("GET", url);
        for (const m of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
          parts.push({
            partNumber: Number(xmlText(m[1]!, "PartNumber")),
            etag: xmlUnescape(xmlText(m[1]!, "ETag") ?? ""),
            size: Number(xmlText(m[1]!, "Size")),
          });
        }
        if (xmlText(xml, "IsTruncated") !== "true") break;
        marker = xmlText(xml, "NextPartNumberMarker");
        if (!marker) break;
      }
      return parts;
    },
    async complete({ key, uploadId, parts }) {
      const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      const body =
        "<CompleteMultipartUpload>" +
        sorted.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`).join("") +
        "</CompleteMultipartUpload>";
      const url = objectUrl(key);
      url.searchParams.set("uploadId", uploadId);
      await call("POST", url, body, { "content-type": "application/xml" });
    },
    async abort({ key, uploadId }) {
      const url = objectUrl(key);
      url.searchParams.set("uploadId", uploadId);
      await call("DELETE", url);
    },
    async signDownload({ key, expiresIn, filename }) {
      const url = objectUrl(key);
      if (filename) {
        const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
        url.searchParams.set("response-content-disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      }
      return presign("GET", url, expiresIn);
    },
    async head(key) {
      const signed = await aws.sign(objectUrl(key).toString(), { method: "HEAD" });
      const res = await doFetch(signed);
      if (res.status === 404) return null;
      if (!res.ok) throw new S3Error(`@broberg/s3: HEAD → ${res.status}`, res.status);
      return Number(res.headers.get("content-length"));
    },
    async headObject(key) {
      const signed = await aws.sign(objectUrl(key).toString(), { method: "HEAD" });
      const res = await doFetch(signed);
      if (res.status === 404) return null;
      if (!res.ok) throw new S3Error(`@broberg/s3: HEAD → ${res.status}`, res.status);
      return {
        size: Number(res.headers.get("content-length")),
        lastModified: new Date(res.headers.get("last-modified") ?? 0).toISOString(),
        contentType: res.headers.get("content-type"),
        metadata: readMeta(res.headers),
      };
    },
    async listObjects({ prefix, includeMetadata }) {
      const out: StoredObject[] = [];
      let token: string | undefined;
      for (;;) {
        const url = new URL(`${origin}/${encodeURIComponent(cfg.bucket)}`);
        url.searchParams.set("list-type", "2");
        url.searchParams.set("prefix", prefix);
        if (token) url.searchParams.set("continuation-token", token);
        const xml = await call("GET", url);
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = xmlUnescape(xmlText(m[1]!, "Key") ?? "");
          if (!key || isMarker(key)) continue;
          out.push({ key, size: Number(xmlText(m[1]!, "Size")), lastModified: new Date(xmlText(m[1]!, "LastModified") ?? 0).toISOString() });
        }
        if (xmlText(xml, "IsTruncated") !== "true") break;
        token = xmlText(xml, "NextContinuationToken");
        if (!token) break;
        token = xmlUnescape(token);
      }
      if (includeMetadata) for (const o of out) o.metadata = (await api.headObject(o.key))?.metadata ?? {};
      return out;
    },
    async listUploads({ prefix }) {
      const found: Array<{ key: string; uploadId: string; initiated: string }> = [];
      let keyMarker: string | undefined, idMarker: string | undefined;
      for (;;) {
        const url = new URL(`${origin}/${encodeURIComponent(cfg.bucket)}`);
        url.searchParams.set("uploads", "");
        url.searchParams.set("prefix", prefix);
        if (keyMarker) url.searchParams.set("key-marker", keyMarker);
        if (idMarker) url.searchParams.set("upload-id-marker", idMarker);
        const xml = await call("GET", url);
        for (const m of xml.matchAll(/<Upload>([\s\S]*?)<\/Upload>/g)) {
          found.push({
            key: xmlUnescape(xmlText(m[1]!, "Key") ?? ""),
            uploadId: xmlUnescape(xmlText(m[1]!, "UploadId") ?? ""),
            initiated: new Date(xmlText(m[1]!, "Initiated") ?? 0).toISOString(),
          });
        }
        if (xmlText(xml, "IsTruncated") !== "true") break;
        keyMarker = xmlText(xml, "NextKeyMarker");
        idMarker = xmlText(xml, "NextUploadIdMarker");
        if (!keyMarker) break;
        keyMarker = xmlUnescape(keyMarker); idMarker = idMarker && xmlUnescape(idMarker);
      }
      const out: PendingUpload[] = [];
      for (const u of found) {
        if (isMarker(u.key)) continue;
        const parts = await api.listParts(u);
        const p: PendingUpload = { ...u, sentBytes: parts.reduce((s, x) => s + (x.size ?? 0), 0) };
        const marker = await api.getText(markerKeyFor(u.key));
        if (marker) {
          try {
            const m = JSON.parse(marker) as { totalBytes?: number; filename?: string; metadata?: Record<string, string> };
            p.totalBytes = m.totalBytes; p.filename = m.filename; p.metadata = m.metadata;
          } catch {
            p.markerUnreadable = true; // the upload itself is still listed; only its display fields are lost
          }
        }
        out.push(p);
      }
      return out;
    },
    async putObject({ key, body, contentType }) {
      await call("PUT", objectUrl(key), body, { "content-type": contentType ?? "application/octet-stream" });
    },
    async getText(key) {
      const signed = await aws.sign(objectUrl(key).toString(), { method: "GET" });
      const res = await doFetch(signed);
      if (res.status === 404) return null;
      if (!res.ok) throw new S3Error(`@broberg/s3: GET → ${res.status}`, res.status);
      return res.text();
    },
    async deleteObject(key) {
      await call("DELETE", objectUrl(key));
    },
  };
  return api;
}

type Env = Record<string, string | undefined>;

/**
 * Builds a signer from the environment, or returns null when NOTHING is configured
 * (ship dark: the handler then answers 503). A HALF-configured environment throws
 * at boot instead — that is a mistake, not a choice.
 *
 * R2:   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET [, R2_JURISDICTION]
 * S3:   S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET [, S3_REGION]
 */
export function createS3SignerFromEnv(env: Env = (globalThis as { process?: { env: Env } }).process?.env ?? {}): S3Signer | null {
  const r2 = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
  const s3 = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET"];
  const pick = (names: string[]) => names.filter((n) => env[n]);
  const r2Set = pick(r2), s3Set = pick(s3);
  if (r2Set.length === 0 && s3Set.length === 0) return null;
  const [names, set] = r2Set.length >= s3Set.length ? [r2, r2Set] : [s3, s3Set];
  if (set.length !== names.length)
    throw new Error(`@broberg/s3: incomplete storage config — missing ${names.filter((n) => !env[n]).join(", ")}`);
  if (names === r2) {
    const j = env.R2_JURISDICTION;
    if (j && j !== "eu" && j !== "default") throw new Error(`@broberg/s3: R2_JURISDICTION must be "eu" or "default"`);
    return createS3Signer({
      accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      bucket: env.R2_BUCKET!, jurisdiction: (j as "eu" | "default" | undefined) ?? "eu",
    });
  }
  return createS3Signer({
    endpoint: env.S3_ENDPOINT, accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    bucket: env.S3_BUCKET!, region: env.S3_REGION,
  });
}
