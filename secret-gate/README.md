# Fleet secret gate (F090)

One gitleaks check every repo calls. It scans your **full git history** with
one shared config, and a finding fails the job.

## Use it (6 lines)

```yaml
# .github/workflows/secret-gate.yml
name: secret-gate
on: [push, pull_request]
jobs:
  secret-gate:
    uses: broberg-ai/components/.github/workflows/secret-gate.yml@secret-gate-v1
```

Then make it **block**: add `needs: secret-gate` to your deploy job, or mark
`secret-gate / secret-gate` as a required check in branch protection. A red
gate that nothing depends on stops nothing.

## What it does

1. **Self-test first.** It plants a fake GitHub token, Discord webhook and Slack
   webhook (generated on the fly, never committed) and fails unless all three are
   found. A config that silently runs with zero rules, which is how a Discord
   webhook stayed in a public cms repo for six months, can no longer report clean.
2. **Scans every commit** with `gitleaks.toml` here: gitleaks' built-in rules
   (`useDefault = true`) plus Discord webhooks, which the built-ins miss.
3. Prints file, line, commit and rule for each finding, **never the value**
   (`--redact`), and keeps the report as a run artifact.

## A finding that is not a real secret

Read it first. If it is a deliberate fake (a test fixture), copy its
`Fingerprint` from the output into a `.gitleaksignore` file in your repo root,
one per line, with a `#` comment saying why. A new finding is never covered by an
old line.

**A real secret is rotated, not ignored.** Removing it from the file does not
remove it from history, and the history is public on a public repo.

## Run it locally

```bash
gitleaks git . --config <path-to>/secret-gate/gitleaks.toml --log-opts="--all" --redact
secret-gate/selftest.sh gitleaks secret-gate/gitleaks.toml
```

Pinned to gitleaks 8.30.1 in CI, with the binary verified by sha256.
