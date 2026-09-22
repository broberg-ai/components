// Local-volume provider — objects on a mounted filesystem (a Fly volume, a
// Docker bind mount, a dev machine's disk).
//
// ── WHY THIS EXISTS BESIDE R2 ─────────────────────────────────────────────
//
// R2 needs a bucket and two secrets, which is an infrastructure decision with
// an owner. An app that already has a durable volume — because its database
// lives there — has somewhere to put a profile picture today, and no reason to
// hand-roll `fs.writeFile` behind the facade's back. Filed by BID (F084.2):
// the identity service keeps its SQLite file on `/data`, and its avatars now
// go beside it. Swapping to R2 later is a change to one config object.
//
// ── THE ONE THING THIS PROVIDER CANNOT DO ALONE ───────────────────────────
//
// A bucket serves its own bytes; a volume does not. So `publicUrl()` names a
// route YOUR app must serve, and `get()` is what it serves from. That asymmetry
// is real and is stated rather than hidden — a provider that returned a URL
// nothing answered would be the worst kind of green.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type {
  MediaBody,
  MediaObject,
  MediaStore,
  SignedUrlOptions,
  UploadOptions,
  VolumeConfig,
} from "../types";
import { assertSafeKey } from "../safe-key";

/** Objects and their metadata live in two sibling trees, so a key can never
 *  collide with the file describing another key. */
const OBJECTS = "objects";
const META = "meta";

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

/**
 * Turn a caller's key into a path segment list, REFUSING anything that could
 * leave the root.
 *
 * `..` is the obvious one. The two that are easy to miss: a backslash is a
 * separator on Windows (so `a\..\..\etc` escapes there and not here), and a NUL
 * byte truncates a path in some syscalls — both are refused outright rather
 * than sanitised, because a silently-rewritten key is a key that does not round
 * -trip through signedUrl/delete.
 */
// The rule itself now lives in ../safe-key.ts so r2 runs the SAME one. It used
// to live here, r2 had nothing, and the two providers therefore disagreed about
// the same key — invisibly, until a consumer switched provider (F086).
const safeSegments = (key: string): string[] => assertSafeKey(key, "volume");

export function createVolumeStore(cfg: VolumeConfig): MediaStore {
  const root = cfg.root.replace(/[\\/]+$/, "");
  if (root === "") throw new Error("media(volume): root is required");
  const prefix = cfg.keyPrefix ? `${cfg.keyPrefix.replace(/^\/+|\/+$/g, "")}/` : "";
  const publicBase = cfg.publicBaseUrl ? cfg.publicBaseUrl.replace(/\/+$/, "") : undefined;

  /** The LOGICAL key a caller passed, prefix-free — what upload() returns. */
  const logical = (key: string) => safeSegments(key).join("/");
  /** The key as stored, prefix applied. Validated a second time so a prefix
   *  cannot smuggle a `..` in either. */
  const stored = (key: string) => safeSegments(prefix + logical(key));
  const objectPath = (key: string) => join(root, OBJECTS, ...stored(key));
  const metaPath = (key: string) => join(root, META, ...stored(key));

  async function writeFileAt(path: string, body: Uint8Array | string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  return {
    async upload(key: string, body: MediaBody, opts?: UploadOptions) {
      await writeFileAt(objectPath(key), await toBytes(body));
      // The declared content type is STORED, not re-derived from the extension
      // later. A provider that accepts a field and drops it is the failure this
      // house has a rule about: the call succeeds and the value is gone.
      if (opts?.contentType) await writeFileAt(metaPath(key), opts.contentType);
      return { key: logical(key) };
    },

    /**
     * There is nothing to sign — a volume has no third party to present a
     * credential to. The URL is the same one `publicUrl()` builds, so a caller
     * written against R2 keeps working; `expiresIn` is accepted and has no
     * effect, which is said here rather than implied by silence.
     */
    async signedUrl(key: string, _opts?: SignedUrlOptions) {
      return this.publicUrl(key);
    },

    async delete(key: string) {
      // force: a missing key is not an error — the contract is idempotent.
      await rm(objectPath(key), { force: true });
      await rm(metaPath(key), { force: true });
    },

    async get(key: string): Promise<MediaObject | null> {
      let bytes: Buffer;
      try {
        bytes = await readFile(objectPath(key));
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
        throw err;
      }
      const contentType = await readFile(metaPath(key), "utf8").catch(() => undefined);
      return {
        bytes: new Uint8Array(bytes),
        contentType: contentType?.trim() || undefined,
      };
    },

    publicUrl(key: string): string {
      if (!publicBase) {
        throw new Error(
          "media(volume): publicUrl requires publicBaseUrl in the config — the route " +
            "YOUR app serves these objects from (a volume has no public endpoint of its own).",
        );
      }
      return `${publicBase}/${encodeKey(logical(key))}`;
    },
  };
}

/** Normalise any accepted body to bytes. A ReadableStream is drained here so
 *  the file is complete when upload() resolves. */
async function toBytes(body: MediaBody): Promise<Uint8Array | string> {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  return new Uint8Array(await new Response(body as ReadableStream).arrayBuffer());
}

/** Exported for the test that proves the refusals — the guard is the point of
 *  this module, so it is reachable on its own rather than only through a write. */
export const __unsafeKeyCheck = safeSegments;
export const __pathSeparator = sep;
