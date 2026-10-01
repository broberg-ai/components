# F090 — Fleet secret gate: one gitleaks check every repo calls

## Why

Christian's order, 1/10 2026, relayed by cms («Ja, bed components bygge den fælles kontrol») and approved by him in this session («Godkendt af mig»).

What happened (cms F201.16, 419cb1fb): a Discord webhook sat in a PUBLIC repo for six months. An outside scanner (FriendlyScanner) found it and Discord deleted it, so cronjobs' alerts went silent. cms' own gitleaks found nothing, because their `.gitleaks.toml` lacked `[extend] useDefault = true`. **A gitleaks config without it REPLACES the built-in rules**: cms ran with zero rules and reported "no leaks" for everything. Discord webhooks are not in gitleaks' defaults at all.

So there are two failures, and the gate must close both:
1. a rule set that is silently empty;
2. a credential shape the defaults do not know.

## Design

**One config, one workflow, both in this (public) repo.**

- `secret-gate/gitleaks.toml`: `[extend] useDefault = true`, plus `discord-webhook-url` and `slack-webhook-url` rules. No blanket allowlist of test files: a real key in a test file is still a leak. A known false positive is accepted per repo by fingerprint in that repo's `.gitleaksignore` (gitleaks' own mechanism, visible in review).
- `.github/workflows/secret-gate.yml` (`on: workflow_call`):
  1. checkout the caller with full history (`fetch-depth: 0`);
  2. checkout this repo's `secret-gate/` at the gate's own tag (the config comes from the same version as the workflow);
  3. download a **pinned** gitleaks release and verify its sha256;
  4. **self-test**: generate a fake GitHub PAT, Discord webhook and Slack webhook AT RUNTIME (nothing realistic is committed), scan them with the shared config, and fail unless all three rule ids fire. That is the check that would have caught cms: with zero rules, the PAT is not found and the job goes red;
  5. scan the caller's full history with `--redact`; any finding fails the job.
- Callers pin a tag: `uses: broberg-ai/components/.github/workflows/secret-gate.yml@secret-gate-v1`.

## Stories

- **F090.1**: config + workflow + self-test (both directions proven).
- **F090.2**: dogfood in components; caller snippet in README; cms adopts.
- **F090.3**: first full-history scan of every fleet repo, with a redacted report. Findings in public repos go to the owner session the same day.
- **F090.4**: rollout: every repo calls it, and merge/deploy depends on it.
- **F090.5**: GitHub push protection on public repos. A settings change across many repos needs Christian's own words; it is an extra layer only.

## Not in scope

- Rotating whatever F090.3 finds. That belongs to each owner, and the report names it.
- Replacing `@broberg/secret-scan`. That package redacts text at runtime (logs, chat, KB); this gate scans git history. They are different jobs. A Discord pattern for secret-scan is a separate card if wanted.

## Reuse

Discovery searched 1/10 2026: `@broberg/secret-scan` (runtime text redaction; no git-history scan) and this repo's `scripts/check-committed-secrets.mjs` (scans components' tracked tree with secret-scan, components only). Neither is a fleet-wide history gate. Build: gitleaks (industry tool, history-aware) plus a shared config. cms' fixed config (419cb1fb) is the starting point for the Discord rule.
