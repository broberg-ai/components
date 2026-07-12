# @broberg/http

Framework-free **HTTP header/response primitives** — Node, Bun, and edge, with
zero runtime dependencies. Each helper returns a string; you set the header.

```bash
npm i @broberg/http
```

## `contentDisposition(filename, opts?)`

Build a `Content-Disposition` value that survives **non-ASCII filenames** (æøå).

A raw non-ASCII byte in this header makes **Bun reject it → HTTP 500** on
download. The fix (RFC 5987 / RFC 6266) is to emit **both** an ASCII
`filename="..."` fallback (old clients) **and** a `filename*=UTF-8''<pct-encoded>`
form (modern clients prefer it) — so the user downloads `brændte-filer.pdf` with
its real characters instead of a mangled transliteration.

```ts
import { contentDisposition } from "@broberg/http";

res.headers.set("Content-Disposition", contentDisposition("brændte-filer.pdf"));
// → attachment; filename="br_ndte-filer.pdf"; filename*=UTF-8''br%C3%A6ndte-filer.pdf

contentDisposition("report.pdf", { disposition: "inline" });
// → inline; filename="report.pdf"; filename*=UTF-8''report.pdf
```

- `disposition` — `"attachment"` (default) or `"inline"`.
- **ASCII fallback** — control chars + CR/LF stripped, path separators / non-ASCII
  / `"` `\` replaced with `_`; an empty name becomes `download`.
- **RFC 5987 form** — `encodeURIComponent` plus the four attr-char-reserved
  characters `' ( ) *` percent-encoded.
- **Header-injection safe** — CR/LF and control characters are always removed.

MIT · part of the [`@broberg/*`](https://github.com/broberg-ai/components)
shared-library family.
