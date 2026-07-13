# F059 — `@broberg/media` 0.2.0: `publicUrl()` + symmetric `keyPrefix`

> **Status:** planned · **Owner:** components · **Package:** `@broberg/media` (0.1.0 → **0.2.0**)
> **Requested by:** fd-sundhed (#17482 footgun, #17515 public-URL) · **Consumers:** fd-sundhed, cardmem

## Two changes, one release

### 1. keyPrefix round-trip symmetry (bugfix, #17482)

Today `keyPrefix` is applied inside `upload`/`signedUrl`/`delete` (`fullKey = prefix + key`), but `upload()` **returns the prefixed key** (`{ key: fullKey(key) }`). The natural pattern — store `upload()`'s returned key, pass it to `signedUrl()` for display — then double-prefixes: `report-photos/report-photos/…` → 404.

**Fix (fd-sundhed's preferred (b)):** `upload()` returns the **logical** (un-prefixed) key. Every method takes the logical key and applies the prefix internally → symmetric round-trip. Low-risk: with no `keyPrefix`, full == logical (no change); with a `keyPrefix`, the round-trip was already broken (404) so consumers were forced to work around it. Documented as a 0.2.0 behavior change.

### 2. `publicUrl()` for public assets (feature, #17515)

`@broberg/media` only exposes `signedUrl()` (short-lived). fd-sundhed's `announcement-images` are PUBLIC — embedded in news richtext + already-sent mails — so an expiring URL breaks published content, blocking migration of those assets to the facade.

**Add:** a sync `publicUrl(key: string): string` + `publicBaseUrl?: string` in `R2Config`. Returns a stable, non-expiring URL `${publicBaseUrl}/${keyPrefix}${key}` (logical key in, prefix applied internally). **Sync** (no signing/IO) so it embeds directly in richtext/mail without `await`. **Ship-dark:** throws a clear error if `publicBaseUrl` is unset (public is off until configured). Not a config mode-flag (redundant) — `publicUrl` + `publicBaseUrl` is enough.

**Infra boundary (consumer's, not the package's):** the package only CONSTRUCTS the URL. The bucket must actually be publicly readable — set `publicBaseUrl` to an R2 custom-domain (e.g. `media.fdaalborg.dk`, via buddy→dns-mcp) or the bucket's `r2.dev` public URL. The package makes nothing public by itself.

## Non-goals

- No per-object public ACL (R2 public access is bucket-level, not per-object).
- No async `publicUrl` (sync fits the richtext/mail embed; revisit only if a provider needs signing).
- No new provider — R2 only, as today.

## Rollout

1. Implement in `types.ts` (+`publicBaseUrl`, +`publicUrl` on `MediaStore`, upload-return JSDoc) + `providers/r2.ts` (logical-key return, `publicUrl`). Update `test/media.test.ts` (round-trip symmetry + publicUrl + throw-when-unset).
2. Bump 0.1.0 → 0.2.0; build; typecheck; vitest.
3. Tag `media-v0.2.0` → token-free OIDC publish (existing package, Trusted Publisher set). Registry-verify.
4. Discovery roster bump + note; notify fd-sundhed + cardmem to adopt.
