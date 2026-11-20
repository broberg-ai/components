# components — cardmem-managed

The fleet's shared `@broberg/*` npm packages, and Discovery (discovery.broberg.ai) — the roster every repo checks before building a cross-cutting capability.

## Project layout

| Area | Path | Notes |
|---|---|---|
| Packages | `packages/<name>/` | One folder per published `@broberg/<name>` (≈45). Each has its own `test` (incl. mutations) and is released by tag `<name>-v<version>`. |
| Discovery | `apps/discovery/` | The Fly app behind discovery.broberg.ai (gate, enroll, tickets). |
| Examples | `examples/<name>/` | Runnable demo apps for UI packages (app-shell :5195, settings :5196, data-table, sso-hono) — what Lens drives. |
| Roster | `scripts/inventory-data.mjs` | The single source for Discovery's package rows; `build-inventory.mjs` / `build-onboarding.mjs` render `docs/inventory.html`, `docs/llms*.txt`, `docs/onboarding.html`. CI bumps `ver` on release (F038.16). |
| Gates | `scripts/check-*.mjs`, `secret-gate/` | Repo-wide checks run in CI (roster versions, shards, secrets, lockfile, …). |
| Plan docs | `docs/features/` | `F<n>-<slug>.md`, written in the same turn as the card. The cardmem board is the live index. `docs/MISSION-*.md` + `INVENTORY.md` are the original vision. |
| CI | `.github/workflows/` | `publish.yml` (OIDC Trusted Publisher, one job per package), test shards, discovery. |
| Monorepo | `pnpm-workspace.yaml`, `turbo.json` | pnpm workspaces over `packages/*` + `examples/*`. |
| cardmem wiring | `.claude/`, `.mcp.json` | Hooks, settings, MCP declarations. |

Bigger components (scaffolds, multi-tenant, podcast, mobile boilerplate) do **not** live here — they get their own repo + cardmem project.

## npm publish — bootstrap a brand-new `@broberg/*` package

A package's **first-ever** `v0.1.0` can't go out via the OIDC workflow (`.github/workflows/publish.yml`) — npm has no Trusted Publisher yet for a name that doesn't exist. Bootstrap it locally instead, using the credential already sitting in `~/.npmrc`:

1. `cd packages/<name> && npm publish --access public --dry-run` first — validates the tarball/package.json. **Caveat:** dry-run passing is NOT proof the real publish will work — it doesn't fully authenticate.
2. `npm publish --access public` (no `--dry-run`) — the real publish. **If `npm whoami` 401s, logging in on npmjs.com in a BROWSER does not fix it** — that was the old wording here and it cost a round-trip on 2026-08-11: Christian logged in, and `whoami` still 401'd from inside the repo *and* from an unrelated directory. The website session and the CLI credential in `~/.npmrc` are separate things, and only the terminal writes the latter. The fix is one interactive command **he** must run (cc cannot complete the browser handshake): `npm login`. Then `npm whoami` returns his username and the publish can proceed.
   - **If `npm whoami` works outside the repo but not inside it after `npm login`:** look for a project `/.npmrc` (gitignored). There is none today (checked 2026-10-11) and CI does not need one — publish.yml is OIDC with no token — but an old copy pinning `_authToken=${NPM_TOKEN}` with `NPM_TOKEN` unset shadows the user credential (`Failed to replace env in config`). Delete it, or publish with `--userconfig ~/.npmrc`.
3. Publish is 2FA-gated — expect `EOTP` ("one-time password required"). The browser-auth URL npm prints is **redacted in every log a cc session can read**, so don't chase it. Ask Christian for the 6-digit code from his authenticator and pass it straight through: `npm publish --access public --otp=<code>` (codes are short-lived, ~30s — use it immediately).
4. Once `v0.1.0` is live, Christian sets up the **Trusted Publisher** on npmjs.com (repo `broberg-ai/components` + workflow `publish.yml`) — every release after that runs token-free via OIDC on a tag push (`<pkg>-v<version>`). Add the package's job + tag prefix to `publish.yml` at that point.

## Fleet rules (cardmem-owned)

@.claude/fleet.md
@.claude/decisions-index.md
