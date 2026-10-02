// components-F006.7 — an ATTACHMENT on a message: what the file really is,
// whether it may come in, where it lives, and how to serve it without letting it
// run script in your origin.
//
// Lifted from cardmem (apps/server/src/storage/r2.ts + packages/shared/src/
// upload-types.ts, origin/main 0bc57e7c), the fleet's best implementation per the
// F006 survey, with two changes:
//
//   1. THE BYTES DECIDE THE TYPE, not the browser and not the file name. cardmem
//      validates by extension; a renamed executable passes that. Here the first
//      bytes are sniffed, the sniffed type is what you store, and a name that
//      promises an image or a PDF the bytes do not deliver is refused.
//   2. THE FILE NAME NEVER ENTERS THE KEY. A key built from input is the class of
//      bug F086 measured; `attachmentKey(id)` takes your id and nothing else.
//
// Pure: no I/O, no provider. Store the bytes with `createMedia().upload()`.

import { contentDisposition } from "@broberg/http";

/** One stored attachment — the row an app keeps per file. The app owns the table. */
export interface AttachmentRecord {
  id: string;
  messageId: string;
  /** The storage key from {@link attachmentKey}. */
  key: string;
  /** The SNIFFED type from {@link validateAttachment} — never the client's. */
  contentType: string;
  /** Size in bytes. */
  bytes: number;
  /** The name the sender gave it. For display and download only; never a key. */
  filename: string;
  /** Hex SHA-256 of the bytes, from {@link sha256Hex}. */
  sha256: string;
}

/** Default size limit: 25 MB (cardmem's, measured on documents). */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Extensions that can NEVER be accepted, whatever list a caller passes. Copied
 * verbatim from cardmem's UPLOAD_FORBIDDEN_EXT: each is something an operating
 * system runs or installs on a double-click. Enumerated, not pattern-matched.
 */
export const ATTACHMENT_FORBIDDEN_EXT: readonly string[] = [
  "exe", "dll", "bat", "cmd", "com", "scr", "msi", "cpl", "hta", "vbs", "vbe",
  "js", "jse", "wsf", "wsh", "lnk", "reg", // Windows
  "dmg", "pkg", "app", "command", "workflow", "mpkg", // macOS
  "sh", "bash", "zsh", "csh", "ksh", "ps1", "psm1", // shells
  "jar", "apk", "deb", "rpm", "appimage", "run", "bin", "so", "dylib", // packages/libs
];

/**
 * What a chat accepts by default: images, PDF, office documents and plain text.
 * Narrower than cardmem's list on purpose — no svg/html (scriptable documents),
 * no archives, no macro-enabled office formats. Widen it per app with
 * `allowedExt`; the forbidden floor still applies.
 */
export const ATTACHMENT_DEFAULT_EXT: readonly string[] = [
  "png", "jpg", "jpeg", "gif", "webp", "heic", "heif",
  "pdf",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv", "md", "json",
];

/** Types that render inline and cannot execute script. Everything else is served hardened. */
const INLINE_SAFE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "application/pdf"]);

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "avif"]);
const OOXML_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const OLE_EXT: Record<string, string> = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
};
const TEXT_EXT: Record<string, string> = {
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  json: "application/json",
};

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "heif"]);

function startsWith(b: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (b.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false;
  return true;
}
function ascii(b: Uint8Array, from: number, to: number): string {
  return b.length < to ? "" : String.fromCharCode(...b.subarray(from, to));
}

/** Signatures of things that execute. Refused whatever the file is called. */
function isExecutable(b: Uint8Array): boolean {
  return (
    startsWith(b, [0x4d, 0x5a]) || // MZ — Windows PE
    startsWith(b, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    startsWith(b, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(b, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(b, [0xce, 0xfa, 0xed, 0xfe]) || startsWith(b, [0xcf, 0xfa, 0xed, 0xfe]) || // Mach-O
    startsWith(b, [0xca, 0xfe, 0xba, 0xbe]) || // Mach-O fat / Java class
    startsWith(b, [0x23, 0x21]) // "#!" — a script with an interpreter line
  );
}

/**
 * The content type the first bytes prove, or `null` when they prove nothing
 * (plain text has no signature). Office OOXML is a zip and legacy office is an
 * OLE container — those come back as the container type; the extension then
 * names which document it is.
 */
export function sniffContentType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (HEIF_BRANDS.has(brand)) return "image/heic";
  }
  if (ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "application/x-ole-storage";
  return null;
}

function extOf(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

export interface AttachmentInput {
  bytes: Uint8Array | ArrayBuffer;
  /** The name the sender gave it. May be empty for a pasted image. */
  filename: string;
}

export interface ValidateAttachmentOptions {
  /** Size limit in bytes. Default {@link ATTACHMENT_MAX_BYTES}. */
  maxBytes?: number;
  /** Extensions to accept. Default {@link ATTACHMENT_DEFAULT_EXT}. Forbidden ones are dropped. */
  allowedExt?: readonly string[];
}

export type AttachmentVerdict =
  | { ok: true; contentType: string; ext: string; bytes: number }
  | { ok: false; reason: string };

/**
 * May this file come in, and what is it? Pass the bytes, not a type: there is
 * deliberately no parameter for the browser's claimed type, because the answer
 * is decided by the bytes and a parameter would only invite trusting it.
 * Store `contentType` from the verdict.
 */
export function validateAttachment(input: AttachmentInput, opts: ValidateAttachmentOptions = {}): AttachmentVerdict {
  const b = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
  const ext = extOf(input.filename ?? "");
  const maxBytes = opts.maxBytes ?? ATTACHMENT_MAX_BYTES;

  // The floor first and unconditionally: a caller's list cannot readmit these.
  if (ext && ATTACHMENT_FORBIDDEN_EXT.includes(ext)) return { ok: false, reason: `file type ".${ext}" can never be attached` };
  if (b.length === 0) return { ok: false, reason: "empty file" };
  if (b.length > maxBytes) return { ok: false, reason: `size ${b.length} exceeds ${maxBytes} bytes` };
  if (isExecutable(b)) return { ok: false, reason: "the file is a program, whatever it is called" };

  const allowed = new Set((opts.allowedExt ?? ATTACHMENT_DEFAULT_EXT).map((e) => e.toLowerCase().replace(/^\./, "")).filter((e) => !ATTACHMENT_FORBIDDEN_EXT.includes(e)));
  const sniffed = sniffContentType(b);
  const ok = (contentType: string) => ({ ok: true as const, contentType, ext, bytes: b.length });
  const mismatch = { ok: false as const, reason: `the file's contents do not match ".${ext}"` };

  // A pasted image has no name: accept it only when the bytes prove an image.
  if (!ext) {
    return sniffed?.startsWith("image/") ? ok(sniffed) : { ok: false, reason: "a file without a name must be an image" };
  }
  if (!allowed.has(ext)) return { ok: false, reason: `file type ".${ext}" not allowed` };

  if (IMAGE_EXT.has(ext)) return sniffed?.startsWith("image/") ? ok(sniffed) : mismatch;
  if (ext === "pdf") return sniffed === "application/pdf" ? ok(sniffed) : mismatch;
  if (ext in OOXML_EXT) return sniffed === "application/zip" ? ok(OOXML_EXT[ext]!) : mismatch;
  if (ext in OLE_EXT) return sniffed === "application/x-ole-storage" ? ok(OLE_EXT[ext]!) : mismatch;
  if (ext in TEXT_EXT) return sniffed === null ? ok(TEXT_EXT[ext]!) : mismatch;
  // An extension the caller added that we have no rule for: store the proven
  // type if the bytes prove one, otherwise as opaque bytes (served hardened).
  return ok(sniffed ?? "application/octet-stream");
}

const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * The storage key for an attachment: `attachments/<id>`. Pass your own id (a
 * uuid); the file name never goes in. Tenant isolation comes from the store's
 * `keyPrefix` (e.g. "tenants/<id>/"), so the full object key is
 * `tenants/<id>/attachments/<id>`.
 */
export function attachmentKey(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error("@broberg/media: attachment id must be 8–128 chars of [A-Za-z0-9_-] (use a uuid)");
  return `attachments/${id}`;
}

/** Hex SHA-256 of the bytes (Web Crypto — Node 18+, Bun, edge). */
export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  // Copied into a fresh ArrayBuffer: digest() refuses a view over a SharedArrayBuffer.
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(view));
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

export interface AttachmentHeaderOptions {
  /** The sender's file name, for the download name. */
  filename?: string;
  /** Force a download even for a type that could render inline. */
  download?: boolean;
}

/**
 * Response headers for serving a stored attachment THROUGH your app. Images and
 * PDF render inline; everything else is a download behind a locked-down CSP +
 * sandbox + nosniff, so a document that can carry script never runs in your
 * origin. Cache is immutable because an attachment key never gets new bytes.
 */
export function attachmentHeaders(contentType: string, byteLength: number, opts: AttachmentHeaderOptions = {}): Record<string, string> {
  const type = contentType || "application/octet-stream";
  const base = (type.toLowerCase().split(";")[0] ?? "").trim();
  const inline = INLINE_SAFE.has(base) && !opts.download;
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Length": String(byteLength),
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": contentDisposition(opts.filename || "file", { disposition: inline ? "inline" : "attachment" }),
  };
  if (!INLINE_SAFE.has(base)) {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
  }
  return headers;
}
