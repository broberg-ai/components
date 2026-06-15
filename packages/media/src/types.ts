// Provider-agnostic media-storage contract. Every provider implements the same
// MediaStore surface, so createMedia({ provider }) lets you swap the backend
// without touching a call-site (the ai-sdk facade pattern, for storage).

/** A binary payload to store. Anything fetch() accepts as a body. */
export type MediaBody = Uint8Array | ArrayBuffer | Blob | string | ReadableStream;

export interface UploadOptions {
  /** MIME type stored on the object (e.g. "image/png"). */
  contentType?: string;
  /** Cache-Control header stored on the object. */
  cacheControl?: string;
}

export interface SignedUrlOptions {
  /** Seconds the presigned GET URL stays valid (default 3600). */
  expiresIn?: number;
}

/** The uniform surface every provider implements. */
export interface MediaStore {
  /** Store an object at `key`; returns the final (prefixed) key. */
  upload(key: string, body: MediaBody, opts?: UploadOptions): Promise<{ key: string }>;
  /** A time-limited presigned GET URL for `key` (no public bucket needed). */
  signedUrl(key: string, opts?: SignedUrlOptions): Promise<string>;
  /** Delete the object at `key` (idempotent — a missing key is not an error). */
  delete(key: string): Promise<void>;
}

/** Cloudflare R2 provider config (S3-compatible). */
export interface R2Config {
  provider: "r2";
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** R2 jurisdiction — "eu" pins EU data-residency (GDPR); default otherwise. */
  jurisdiction?: "default" | "eu";
  /** Optional key prefix prepended to every key (e.g. "tenants/acme/") for multi-tenant isolation. */
  keyPrefix?: string;
}

/** The config union — grows as providers are added (s3, supabase, gcs …). */
export type MediaConfig = R2Config;
