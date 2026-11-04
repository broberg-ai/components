// F111.1 — ONE fetch handler (Request → Response) for Hono/Bun and Next.
// Every action asks the SITE's authorize() first and keeps the user inside the
// object prefix it returns. The storage key never appears in a response.
import {
  MAX_EXPIRES_SECONDS, MAX_PARTS, S3Error, choosePartSize, markerKeyFor,
  type S3Signer, type UploadedPart,
} from "./server";

export interface Authorized {
  /** Every object this user may touch lives under `<prefix>/`. E.g. "users/<bid-sub>". */
  prefix: string;
  /**
   * Stored with every upload this user starts (x-amz-meta on the object + the
   * in-progress marker), e.g. { uploadedBy: "patrick@example.dk" }. Set by the
   * SERVER from the session — never taken from the browser.
   */
  metadata?: Record<string, string>;
}

export interface S3HandlerOptions {
  /** The site's own check (BID session + allowlist). Return null to refuse. */
  authorize(req: Request): Promise<Authorized | null> | Authorized | null;
  /** Largest object accepted, in bytes. Default 20 GiB. Enforced at start (declared) AND at complete (actual). */
  maxBytes?: number;
  /** Allowed content types, exact ("video/mp4") or wildcard ("video/*"). Default: any. Declared type, not sniffed. */
  allowedTypes?: string[];
  /** Preferred part size in bytes (min 8 MiB). Default 16 MiB. */
  partSize?: number;
  /** Signed-URL lifetime in seconds, max 900. */
  expiresIn?: number;
  /** Object key for a new upload. Default `<prefix>/<yyyy-mm-dd>/<random>-<safe filename>`. */
  keyFor?(input: { prefix: string; filename: string; contentType: string }): string;
}

const GiB = 1024 ** 3;
const MAX_SIGN_BATCH = 100;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const safeFilename = (name: string) =>
  (name.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/^\.+/, "").replace(/[^\p{L}\p{N}._ -]/gu, "_").trim().slice(0, 120)) || "file";

/** A prefix must be plain path segments: no "..", no empty segments, no encoding tricks. */
function checkPrefix(prefix: unknown): string {
  if (typeof prefix !== "string") throw new HttpError(500, "bad_prefix", "authorize() returned no prefix");
  const p = prefix.replace(/^\/+|\/+$/g, "");
  if (!p || p.split("/").some((s) => !s || s === "." || s === "..") || /[%\\\u0000-\u001f]/.test(p))
    throw new HttpError(500, "bad_prefix", "authorize() returned an unsafe prefix");
  return p;
}

/** The key must sit under `<prefix>/` and be free of traversal, encoding and control characters. */
function checkKey(key: unknown, prefix: string): string {
  if (typeof key !== "string" || key.length > 1024) throw new HttpError(400, "bad_key", "key is required");
  const segs = key.split("/");
  if (/[%\\\u0000-\u001f\u007f]/.test(key) || segs.some((s) => !s || s === "." || s === "..") || !key.startsWith(prefix + "/"))
    throw new HttpError(403, "forbidden_key", "that object is not yours");
  return key;
}

const checkUploadId = (id: unknown): string => {
  if (typeof id !== "string" || !id || id.length > 1024 || /[\u0000-\u001f]/.test(id))
    throw new HttpError(400, "bad_upload_id", "uploadId is required");
  return id;
};

function typeAllowed(type: string, allowed?: string[]): boolean {
  if (!allowed?.length) return true;
  const t = type.toLowerCase();
  return allowed.some((a) => { const x = a.toLowerCase(); return x.endsWith("/*") ? t.startsWith(x.slice(0, -1)) : t === x; });
}

const randomId = () => {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

const defaultKeyFor = ({ prefix, filename }: { prefix: string; filename: string }) =>
  `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomId()}-${safeFilename(filename)}`;

/** Remove the in-progress marker. A failure is REPORTED (markerRemoved:false), never hidden — the upload itself succeeded. */
async function dropMarker(signer: S3Signer, key: string): Promise<{ markerRemoved: boolean }> {
  try { await signer.deleteObject(markerKeyFor(key)); return { markerRemoved: true }; }
  catch { return { markerRemoved: false }; }
}

export function createS3Handler(signer: S3Signer | null, opts: S3HandlerOptions): (req: Request) => Promise<Response> {
  const maxBytes = opts.maxBytes ?? 20 * GiB;
  const expiresIn = Math.min(opts.expiresIn ?? MAX_EXPIRES_SECONDS, MAX_EXPIRES_SECONDS);

  return async (req) => {
    try {
      if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "POST only");
      if (!signer) throw new HttpError(503, "not_configured", "file storage is not configured on this server");
      const who = await opts.authorize(req);
      if (!who) throw new HttpError(401, "unauthorized", "sign in first");
      const prefix = checkPrefix(who.prefix);

      // JSON only: a cross-site <form> can POST text/plain with the user's cookies,
      // but cannot set application/json without a CORS preflight this route never grants.
      if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
        throw new HttpError(415, "json_required", "content-type must be application/json");
      let body: Record<string, unknown>;
      try { body = (await req.json()) as Record<string, unknown>; } catch { throw new HttpError(400, "bad_json", "body must be JSON"); }
      if (!body || typeof body !== "object") throw new HttpError(400, "bad_json", "body must be a JSON object");

      switch (body.action) {
        case "start": {
          const filename = typeof body.filename === "string" ? body.filename : "";
          const size = body.size;
          const contentType = typeof body.type === "string" && body.type ? body.type : "application/octet-stream";
          if (!filename) throw new HttpError(400, "bad_filename", "filename is required");
          if (typeof size !== "number" || !Number.isFinite(size) || size < 1) throw new HttpError(400, "bad_size", "size must be a positive number");
          if (size > maxBytes) throw new HttpError(413, "too_large", `file is larger than ${maxBytes} bytes`);
          if (!typeAllowed(contentType, opts.allowedTypes)) throw new HttpError(415, "type_not_allowed", `${contentType} is not accepted here`);
          const key = checkKey((opts.keyFor ?? defaultKeyFor)({ prefix, filename, contentType }), prefix);
          const partSize = choosePartSize(size, opts.partSize);
          const metadata = { ...who.metadata, "total-bytes": String(size), "original-filename": filename };
          const { uploadId } = await signer.start({ key, contentType, metadata });
          // S3 cannot report metadata for an unfinished upload, so a small marker carries it.
          await signer.putObject({
            key: markerKeyFor(key), contentType: "application/json",
            body: JSON.stringify({ totalBytes: size, filename, contentType, metadata: who.metadata ?? {}, initiated: new Date().toISOString() }),
          });
          return json(200, { key, uploadId, partSize, partCount: Math.ceil(size / partSize) });
        }
        case "sign": {
          const key = checkKey(body.key, prefix);
          const uploadId = checkUploadId(body.uploadId);
          const nums = body.partNumbers;
          if (!Array.isArray(nums) || nums.length < 1 || nums.length > MAX_SIGN_BATCH ||
              !nums.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_PARTS))
            throw new HttpError(400, "bad_parts", `partNumbers: 1..${MAX_SIGN_BATCH} integers in 1..${MAX_PARTS}`);
          const urls = await Promise.all((nums as number[]).map(async (partNumber) => ({
            partNumber, url: await signer.signPart({ key, uploadId, partNumber, expiresIn }),
          })));
          return json(200, { urls, expiresIn });
        }
        case "list": {
          const key = checkKey(body.key, prefix);
          const parts = await signer.listParts({ key, uploadId: checkUploadId(body.uploadId) });
          return json(200, { parts });
        }
        case "complete": {
          const key = checkKey(body.key, prefix);
          const uploadId = checkUploadId(body.uploadId);
          const sent = body.parts;
          if (!Array.isArray(sent) || sent.length < 1 || sent.length > MAX_PARTS)
            throw new HttpError(400, "bad_parts", "parts are required");
          // The bucket is the truth: sizes come from listParts, never from the browser.
          const stored = await signer.listParts({ key, uploadId });
          const total = stored.reduce((s, p) => s + (p.size ?? 0), 0);
          if (total > maxBytes) {
            await signer.abort({ key, uploadId });
            await dropMarker(signer, key);
            throw new HttpError(413, "too_large", `upload exceeded ${maxBytes} bytes and was discarded`);
          }
          const parts: UploadedPart[] = (sent as Array<{ partNumber?: unknown; etag?: unknown }>).map((p) => {
            if (!Number.isInteger(p?.partNumber) || typeof p?.etag !== "string") throw new HttpError(400, "bad_parts", "each part needs partNumber and etag");
            return { partNumber: p.partNumber as number, etag: p.etag };
          });
          await signer.complete({ key, uploadId, parts });
          return json(200, { key, size: total, ...(await dropMarker(signer, key)) });
        }
        case "abort": {
          const key = checkKey(body.key, prefix);
          const uploadId = checkUploadId(body.uploadId);
          await signer.abort({ key, uploadId });
          return json(200, { aborted: true, ...(await dropMarker(signer, key)) });
        }
        case "objects": {
          return json(200, { objects: await signer.listObjects({ prefix: prefix + "/", includeMetadata: body.metadata === true }) });
        }
        case "uploads": {
          return json(200, { uploads: await signer.listUploads({ prefix: prefix + "/" }) });
        }
        case "download": {
          const key = checkKey(body.key, prefix);
          const filename = typeof body.filename === "string" && body.filename ? safeFilename(body.filename) : undefined;
          const url = await signer.signDownload({ key, expiresIn, filename });
          return json(200, { url, expiresIn });
        }
        default:
          throw new HttpError(400, "unknown_action", "action must be start, sign, list, complete, abort, download, objects or uploads");
      }
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: { code: e.code, message: e.message } });
      if (e instanceof S3Error) {
        const status = e.s3Code === "NoSuchUpload" ? 404 : e.s3Code === "NoSuchKey" ? 404 : 502;
        return json(status, { error: { code: e.s3Code ?? "storage_error", message: status === 404 ? "upload or object not found" : "storage refused the request" } });
      }
      // Never echo an unknown error: it could carry configuration.
      return json(500, { error: { code: "internal", message: "upload service error" } });
    }
  };
}
