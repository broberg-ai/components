# F013 — Gravatar Connector

> L1 Identity · runtime-package · effort **S** · impact **medium** · owner `fysiodk-aalborg-sport`. Status: Backlog.
> Graduate-candidate: no — small core npm that stays in `components`.

## Motivation
A zero-dependency, isomorphic utility that turns an email into a Gravatar avatar URL (SHA-256), plus a headless existence-check (HEAD request) and an initials fallback generator. Ships a headless core + two thin UI adapter components — React/shadcn (Stack A) and Preact (Stack B) — each implementing the same three-tier fallback: uploaded picture → Gravatar → generated initials. Found in identical form across five repos today with the MD5 implementation copy-pasted verbatim in three of them.

## Solution
**runtime-package.** All three criteria pass. (a) Identical logic in 4+ repos: fysiodk gravatar.ts (MD5 + cache-bust + HEAD), xrt81 Avatar.tsx (SHA-256 via crypto.subtle), coverletter-generator nav-user.tsx (inline MD5), cms me/route.ts (Node crypto MD5 server-side) — the MD5 body in coverletter + fysiodk is character-for-character identical. (b) Stable: the Gravatar API contract hasn't changed in a decade. (c) Painful: two repos carry divergent hash strategies (MD5 vs SHA-256 vs Node crypto) — a fix or the SHA-256 switch must touch N places.

## Scope

### In scope
- Extract from `webhouse/fysiodk-aalborg-sport` `apps/web/src/lib/gravatar.ts` + `components/user-avatar.tsx`.
- Headless core (hash/url/exists/initials) + React + Preact adapters.

### Out of scope
- Per-brand avatar styling (each app styles its own).
- Replacing OAuth-provider pictures (priority chain is the consumer's call).

## Architecture

### Best source (reference implementation)
`webhouse/fysiodk-aalborg-sport` — `apps/web/src/lib/gravatar.ts` (getGravatarHash, getGravatarUrl with cache-busting, checkGravatarExists HEAD) + `components/user-avatar.tsx` (shadcn Avatar + size-map sm/md/lg/xl, 2x DPR, onError). Closest to the desired package shape; only gap is MD5 vs SHA-256.

### Other implementations seen
- `broberg/xrt81` `apps/web/src/components/ui/Avatar.tsx` — best hash: crypto.subtle SHA-256 (async, no inline MD5); only 3-tier fallback (uploaded→Gravatar→initials via onError cascade); Preact (Stack B reference).
- `webhouse/cms` `packages/cms-admin/src/app/api/auth/me/route.ts` — server-side Node crypto; GitHub avatar priority over Gravatar (the OAuth-picture > Gravatar > initials chain the API must expose).
- `cbroberg/coverletter-generator` `components/nav-user.tsx` — 3rd inline MD5 copy; uses d=identicon (swallows the error signal) — a bug the package fixes by standardising d=404.

### Headless core vs. adapters
- **Core (no React/Preact/next):** gravatarHash(email) (SHA-256 via crypto.subtle, normalised lowercase+trim); gravatarUrl(email, {size?, default?}) (builds gravatar.com/avatar/{hash}); gravatarExists(email, size?) (HEAD, false on network error); getInitials(name?, email?) (max 2 chars). Cache-bust opt-in via options.
- **Stack A (Next/React/shadcn):** GravatarAvatar wrapping shadcn Avatar+Image+Fallback; props email/name/size/uploadedSrc/className; src chain via useState+onError; size map sm32/md40/lg48/xl64 doubled for 2x DPR; plain img (no next/image).
- **Stack B (Bun/Hono/Preact):** Avatar component (xrt81 pattern): useEffect async hash, useState src+tier, single img onError tier cascade; CSS class sizing, no shadcn/Tailwind dep.

### Public API
```ts
export function gravatarHash(email: string): Promise<string>;
export function gravatarUrl(email: string, opts?: GravatarUrlOptions): Promise<string>;
export function gravatarExists(email: string, size?: number): Promise<boolean>;
export function getInitials(name?: string|null, email?: string|null): string;
export type GravatarUrlOptions = { size?: number; default?: GravatarDefault; cacheBust?: boolean };
// '@broberg/gravatar/react' → GravatarAvatar ; '@broberg/gravatar/preact' → Avatar
```

## Stories
- **F013.1** — Headless core: SHA-256 hash + URL builder + existence check — _AC:_ gravatarHash returns correct lowercase hex SHA-256; gravatarUrl valid with s=/d=; gravatarExists false when d=404 + none registered; works in browser + Bun; tests cover empty/uppercase/whitespace email.
- **F013.2** — getInitials helper — _AC:_ two-word name → first letters of first+last upper; single word → first two chars; null name → first two of email prefix; both null → '??'; matches fysiodk + coverletter behaviour.
- **F013.3** — Stack A React adapter (GravatarAvatar) — _AC:_ shadcn AvatarImage at 2x DPR, AvatarFallback initials on onError, optional uploadedSrc 3-tier; size→Tailwind classes (fysiodk map); data-testid='gravatar-avatar'.
- **F013.4** — Stack B Preact adapter (Avatar) — _AC:_ useEffect async hash+url; onError cascade uploadedSrc→Gravatar→initials; no shadcn/Tailwind dep; size 32|40|48|56 (xrt81).
- **F013.5** — Migrate fysiodk (pilot) — _AC:_ gravatar.ts deleted; user-avatar.tsx imports from @broberg/gravatar + /react; all UserAvatar usages render identically (Lens snapshot); no inline MD5/SHA-256 left.
- **F013.6** — Migrate cms + xrt81 + coverletter inline copies — _AC:_ cms me/route.ts uses gravatarHash (no Node crypto hashing); xrt81 Avatar.tsx imports from /preact; coverletter nav-user.tsx removes inline md5.

## Acceptance criteria
1. @broberg/gravatar builds + typechecks clean; headless core imports no framework packages.
2. Each story (F013.1–F013.6) meets its own AC.
3. Piloted in fysiodk-aalborg-sport and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (xrt81 or coverletter-generator) migrates onto the shared package with identical behaviour.

## Dependencies
- External: shadcn/ui Avatar (Stack A peer), preact (Stack B peer).
- Related: F012 Profile upload (shares the gravatar helper).

## Rollout
Strangler: 1) extract core from fysiodk gravatar.ts + upgrade hash to SHA-256 from xrt81; 2) React adapter from fysiodk, Preact from xrt81; 3) publish; 4) pilot fysiodk; 5) replace inline copies in xrt81 + coverletter; 6) replace cms server-side helper.

Graduate-candidate: no — stays in `components`.

## Open Questions
- SHA-256 only (modern) accepting that very old MD5-only Gravatar accounts may not resolve, or ship both (SHA-256 then MD5)?
- React adapter need next/image (domains config) or is plain img + referrerpolicy=no-referrer fine?
- Expose gravatarExists publicly at all (network cost), or document as internal?

## Effort estimate
**S** — owner session: `fysiodk-aalborg-sport`. Reuse model: runtime-package.

## Risks
Hash divergence today (cms Node MD5, fysiodk/coverletter inline MD5, xrt81 SHA-256) — migrate all to SHA-256 in the same PR; existing MD5-displayed avatars keep resolving (Gravatar links both hashes per account). Cache-bust ?v= bypasses CDN — opt-in only. checkGravatarExists is a per-render network call if used naively — callers must sessionStorage-cache.