# F048 — @broberg/seti-client v0.3.2: SetiChat nav-key toolbar restyle

**Status:** in progress. **Owner:** components (owns + publishes @broberg/seti-client).
**Requested by:** Christian (via buddy #15808). **Consumer waiting:** cardmem (Terminal tab uses `<SetiChat hideInput>` — no own toolbar, so the fix belongs in the package).

## Motivation
The SetiChat nav-keys bar (`packages/seti-client/src/preact.tsx`) looks unpolished: it uses raw unicode glyphs (`Esc ↑ ↓ ← → ⏎`) and has skewed vertical padding (`.45rem` top vs `.2rem` bottom). Christian wants clean lucide-style key glyphs + even air.

## Scope
1. **Lucide glyphs** for 5 of the 6 keys — Up/Down/Left/Right as arrow icons, Enter as corner-down-left; Escape stays a styled `Esc` text (lucide has no Esc glyph). **Inline the SVG paths** — do NOT add `lucide-preact` as a dependency: seti-client is deliberately dependency-free (preact peer only), same clean-deps principle as the lens split. 6 icons don't justify a dep.
2. **Symmetric padding** on `.seti-chat__navkeys`: `.45rem .65rem` (top=bottom).
3. Center the glyph in each button (`inline-flex`).
4. Bump `0.3.1 → 0.3.2` (additive/cosmetic — no other consumer affected).

## Non-goals
- No API change, no new props, no behaviour change. Purely visual.
- No `data-testid` changes — each button keeps `seti-chat-key-<key>`.

## Rollout
Bump → tsc + build + test → commit → tag `seti-client-v0.3.2` → **OIDC auto-publish** (Trusted Publisher already set up — no OTP). Ping cardmem to bump their dep; visual confirmation is cardmem's Terminal-tab render (a Preact component in a shared package can't be Lens-verified in isolation without a host).

## Acceptance criteria (epic)
- Nav-keys show lucide glyphs (arrows + corner-down-left) + styled Esc; no unicode arrows.
- Inline SVG — package.json `dependencies` stays empty (dep-free, preact peer only).
- `.seti-chat__navkeys` padding symmetric.
- v0.3.2 live on npm via OIDC tag (no OTP); tsc clean, build OK, vitest green.
- cardmem bumps their dep + confirms the Terminal-tab render.