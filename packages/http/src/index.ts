// @broberg/http — framework-free HTTP header/response primitives (Node/Bun/edge).
// Zero runtime deps, Web-standard only. Each helper returns a string; the caller
// sets the header. Seed primitive: contentDisposition().

export interface ContentDispositionOptions {
  /** `attachment` (force download; default) or `inline` (render in the browser). */
  disposition?: "attachment" | "inline";
}

// Control chars + DEL (header-injection surface: CR/LF live in here).
const CONTROL = /[\u0000-\u001F\u007F]/g;
// Anything outside printable ASCII (space..tilde).
const NON_ASCII = /[^\u0020-\u007E]/g;
// encodeURIComponent leaves ' ( ) * ! ~ - . _ alone. RFC 5987 attr-char forbids
// ' ( ) * so pct-encode those four too; ! ~ - . _ are attr-char-safe, leave them.
const RFC5987_RESERVED = /['()*]/g;

/**
 * Build a `Content-Disposition` header VALUE that survives non-ASCII filenames.
 *
 * A raw non-ASCII byte (æøå) in this header makes Bun reject it → HTTP 500 on
 * download. The fix (RFC 5987 / RFC 6266) is to emit BOTH an ASCII
 * `filename="..."` fallback (old clients) AND a `filename*=UTF-8''<pct-encoded>`
 * form (modern clients prefer it), so `brændte-filer.pdf` downloads with its real
 * characters instead of a mangled transliteration — and Bun never 500s.
 *
 * Header-injection safe: control chars and CR/LF are always stripped.
 *
 * @example
 * res.headers.set("Content-Disposition", contentDisposition("brændte-filer.pdf"));
 * // attachment; filename="br_ndte-filer.pdf"; filename*=UTF-8''br%C3%A6ndte-filer.pdf
 */
export function contentDisposition(
  filename: string,
  opts: ContentDispositionOptions = {},
): string {
  const disposition = opts.disposition ?? "attachment";

  // Strip control chars + CR/LF (header-injection safe) and path separators;
  // an empty/whitespace-only result falls back to a safe default.
  const cleaned =
    (filename ?? "")
      .replace(CONTROL, "")
      .replace(/[/\\]/g, "_")
      .trim() || "download";

  // ASCII fallback (filename="..."): non-ASCII → '_'; drop the quote/backslash
  // that would otherwise break the quoted-string.
  const asciiName = cleaned.replace(NON_ASCII, "_").replace(/["\\]/g, "_");

  // RFC 5987 form (filename*): the REAL name, UTF-8 percent-encoded.
  const encoded = encodeURIComponent(cleaned).replace(
    RFC5987_RESERVED,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );

  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}
