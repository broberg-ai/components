# F214.21 — Vault recognises an UpCloud API token (ucat_…)

## Motivation
Owner, 30 Sep 2026: «Ny token type til vault: UpCloud - ucat_01M3....». When he pastes an UpCloud API token into Settings → Secrets, the vault must label it as UpCloud instead of `generic`. Measured 30/9: `classify('ucat_01M3…')` returns `null` on @broberg/secret-scan 0.7.2 (our pin) and on 0.9.3 (latest), so today it is stored as `generic`.

## Scope
- components adds an UpCloud pattern to @broberg/secret-scan (asked 30/9, intercom 1022). Exact length/alphabet after `ucat_` to be verified by components against UpCloud's docs — the sample looks like a ULID (26 chars Crockford base32).
- cardmem bumps the pin in apps/server + packages/mcp-tools (exact-pin), adds a detect test, deploys.

**Non-goals:** a local regex in apps/server/src/vault/detect.ts (would drift from the fleet pattern set); any UI change (the type label renders from the stored value already).

## Architecture
`detectSecretType()` (apps/server/src/vault/detect.ts) calls `classify()` from @broberg/secret-scan; `knownSecretTypes()` derives the list from `SECRET_PATTERNS`. A new pattern upstream flows through with no code change here beyond the version bump.

## Dependencies
Blocked on components publishing the pattern. Bumping from 0.7.2 spans several releases — read the changelog for behaviour changes (D-eff608: call classify() without valueOnly).

## Rollout
Bump → test → gate-green commit → auto-deploy → prod read-back with a throwaway value, then delete it.

## Reuse
Discovery: @broberg/secret-scan is the fleet's owner of secret classification — extend it, never re-roll (CLAUDE.md reuse rule).
