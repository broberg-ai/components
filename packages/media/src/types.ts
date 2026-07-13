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
  /**
   * Store an object at `key`. Returns the **logical** key you passed (the prefix,
   * if any, is applied internally) — so the return value is safe to feed straight
   * back into {@link MediaStore.signedUrl}, {@link MediaStore.delete} and
   * {@link MediaStore.publicUrl} without double-prefixing.
   */
  upload(key: string, body: MediaBody, opts?: UploadOptions): Promise<{ key: string }>;
  /** A time-limited presigned GET URL for `key` (no public bucket needed). */
  signedUrl(key: string, opts?: SignedUrlOptions): Promise<string>;
  /** Delete the object at `key` (idempotent — a missing key is not an error). */
  delete(key: string): Promise<void>;
  /**
   * A stable, **non-expiring** public URL for `key` — for assets that live in
   * already-published content (news richtext, sent emails) where a signed
   * (expiring) URL would break. Synchronous (pure string construction, no I/O), so
   * it embeds directly without `await`. Requires `publicBaseUrl` in the config AND
   * the bucket to be publicly readable (an R2 custom-domain or `r2.dev` URL); it
   * throws if `publicBaseUrl` is not set. The package only builds the URL — making
   * the bucket public is your infra.
   */
  publicUrl(key: string): string;
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
  /**
   * Public base URL for {@link MediaStore.publicUrl} — the bucket's R2 custom-domain
   * (e.g. "https://media.example.com") or its `r2.dev` public URL. Only meaningful
   * when the bucket is publicly readable; leave unset to keep `publicUrl()` disabled
   * (it throws until this is configured). Trailing slash optional.
   */
  publicBaseUrl?: string;
}

/** The config union — grows as providers are added (s3, supabase, gcs …). */
export type MediaConfig = R2Config;
