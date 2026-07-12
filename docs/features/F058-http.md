# F058 — `@broberg/http` (seed: `contentDisposition`)

> **Status:** planned · **Owner:** components · **Package:** `@broberg/http` (new, v0.1.0)
> **Proposed by:** cardmem (#17408) · **Consumers #1+#2:** cardmem (F224.8), contentpush (F009.2)

## Motivation

Two consumers independently hit the SAME bug: a raw non-ASCII filename (æøå) in a `Content-Disposition` header makes **Bun reject the header → HTTP 500** on download. Both fixed it with RFC 5987 — an ASCII `filename="..."` fallback PLUS `filename*=UTF-8''<pct-encoded>` (which preserves the real name, better than transliteration). Two hand-rolled copies of the fiddly `'()*` escape is drift waiting to happen. Reuse-first: one source.

No existing `@broberg/*` HTTP/header primitive (Discovery search + repo grep confirmed). `media` is storage, not response-headers — none of the 31 packages is a clean home. So a **new tiny package** is the honest placement.

## Scope (v0.1.0)

One exported function + its options type. Zero runtime deps; Web-standard only (`encodeURIComponent`); runs Node/Bun/edge.

```ts
contentDisposition(filename: string, opts?: { disposition?: 'attachment' | 'inline' }): string
// → `attachment; filename="braendte-filer.pdf"; filename*=UTF-8''br%C3%A6ndte-filer.pdf`
```

**Contract (locked):**
- `disposition` defaults to `'attachment'`.
- **ASCII fallback** (`filename="..."`, for ancient clients): strip control chars + CR/LF, replace path separators (`/ \`) and any non-ASCII and `" \` with `_`; empty → `download`.
- **RFC 5987 form** (`filename*=UTF-8''...`, the real name): `encodeURIComponent(name)` THEN additionally pct-encode `'` `(` `)` `*` (encodeURIComponent leaves them but RFC 5987 attr-char disallows them).
- **Header-injection safe:** CR/LF and control chars are always stripped.
- Always emits BOTH forms (RFC 6266: a client that understands `filename*` prefers it; older ones fall back to `filename=`).

## Non-goals

- No parsing of Content-Disposition (only serialization — the direction both consumers need).
- No other header helpers YET (Cache-Control/ETag/secure-download join only when a real second need appears — not speculative).
- Not a framework middleware — returns a string; the caller sets the header.

## Rollout

1. Build + test (offline: æøå round-trip, ASCII fallback, injection strip, inline/attachment, empty→download).
2. Bootstrap-publish v0.1.0 (new name → one OTP from Christian, no `--provenance`).
3. Add to Discovery roster + a `publish-http` OIDC job (tag `http-v*`) for 0.1.1+.
4. cardmem (F224.8) + contentpush (F009.2) swap their hand-rolled copies for the import; Christian sets Trusted Publisher.
