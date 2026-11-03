// @broberg/media — the fleet's provider-agnostic media-storage facade (F006).
// One API (upload · signedUrl · delete) over swappable storage providers, so a
// later move between backends never touches a call-site. Ships with Cloudflare
// R2; the config union grows as providers are added (s3, supabase, gcs …).
import { createR2Store, createTigrisStore } from "./providers/r2";
export { listBuckets, TIGRIS_ENDPOINT } from "./providers/r2";
import { createVolumeStore } from "./providers/volume";
import type { MediaConfig, MediaStore } from "./types";

export type {
  BucketAccountConfig,
  BucketInfo,
  CompletedPart,
  ListObject,
  ListOptions,
  ListResult,
  MediaBody,
  MediaConfig,
  MediaObject,
  MediaStore,
  MultipartStore,
  R2Config,
  SignedUrlOptions,
  TigrisConfig,
  UploadOptions,
  VolumeConfig,
} from "./types";

/**
 * Create a media store for the configured provider. The returned {@link MediaStore}
 * is identical across providers — swap `provider` and your call-sites don't change.
 *
 * @example
 * const media = createMedia({
 *   provider: "r2",
 *   accountId, accessKeyId, secretAccessKey, bucket: "assets",
 *   jurisdiction: "eu", keyPrefix: "tenants/acme/",
 * });
 * await media.upload("logo.png", bytes, { contentType: "image/png" });
 * const url = await media.signedUrl("logo.png", { expiresIn: 600 });
 */
export function createMedia(config: MediaConfig): MediaStore {
  switch (config.provider) {
    case "r2":
      return createR2Store(config);
    case "tigris":
      return createTigrisStore(config);
    case "volume":
      return createVolumeStore(config);
    default:
      throw new Error(`media: unknown provider "${(config as { provider?: string }).provider}"`);
  }
}
