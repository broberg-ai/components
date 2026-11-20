> **v1.0.0 is WITHDRAWN — do not use it.** Its workflow steps piped the check into `tee` without `pipefail`, so a red
> check exited green (found by the first end-to-end run, 20/11 2026). Use **v1.0.1** or later.

# security-gate — the fleet's deterministic security check (F427)

One reusable workflow, `.github/workflows/security-gate.yml`. Every cardmem repo calls it, so the rules, the tool
versions and the selftest live in one place (like `secret-gate` and `image-hygiene`). **Nothing in it is an LLM** — a
red run is a fact you can reproduce on a laptop: `node scripts/security-gate/run-check.mjs all --dir .`.

## Use it (cardmem writes this file for you — F427.2)

```yaml
# .github/workflows/security.yml
name: security
on:
  push: { branches: [main] }
  pull_request:
  schedule: [{ cron: "23 2 * * *" }]   # nightly — a dependency turns vulnerable on someone else's timetable
  workflow_dispatch:
permissions: {}
jobs:
  security:
    permissions: { contents: read }
    uses: broberg-ai/components/.github/workflows/security-gate.yml@security-gate-v1.0.1
    with: { engine-ref: security-gate-v1.0.1 }
```

Make the deploy job `needs: security`. Inputs (all optional): `ack-file`, `exclude`, `skip-importers`, `sast-exclude`.
There is **no input that switches a check off**.

## The five checks (each its own job, each named in the red line)

| Job | Blocks on | Tool (pinned) |
|---|---|---|
| `deps` → `deps-vuln` | HIGH/CRITICAL in what the repo **ships** | OSV.dev over pnpm-lock.yaml / package-lock.json / bun.lock |
| `deps` → `deps-malicious` | any malicious package, **anywhere** in the tree | OSV (MAL-* ids + GitHub's malware advisories) |
| `sast` | Semgrep `ERROR` | Semgrep 1.182.0, packs in `run-check.mjs` `RULE_PACKS` |
| `workflows` | zizmor `High` in `.github/workflows` | zizmor 1.32.0 |
| `install` | a `package.json` with no lockfile, or a lockfile the frozen install refuses | pnpm / bun / npm, scripts disabled |
| `sbom` | never — a record | syft 1.57.0 (sha256-verified) → artifact `sbom-cyclonedx` |

**«Ships» = reachable from a production dependency** (`dependencies`/`optionalDependencies`; a library's *peer*
dependencies are the consumer's choice and do not count). Build and test tooling is reported as a warning, never a
block: measured in components on 20/11, the whole-lockfile gate was red on 53 findings, all tooling, and shipped was 0 —
a gate that is red on day one gets silenced. A malicious package is the exception: it runs on the build machine too.

**«Could not check» is red.** A tool that printed nothing, an OSV outage, an unreadable lockfile: the run says so by
name and fails. A gate that did not look must never read as clean.

## Acknowledging a finding

A FILE in the repo — `.github/security-ack.json`:

```json
{ "acks": [ { "id": "GHSA-xxxx-xxxx-xxxx", "path": "optional/file.ts", "reason": "why a user cannot be hit", "expires": "2027-01-15" } ] }
```

- silences **that id** (an alias such as a CVE number also matches) and, if `path` is given, only that file;
- needs a written `reason` (≥ 10 characters) and an `expires` date **at most 180 days out**;
- an expired or malformed ack silences nothing and is printed as `[ack] … does not count`.

## Not covered (named, not hidden)

Lockfiles other than the three above (`yarn.lock`, `Cargo.lock`, `go.sum`, Python …) are listed as a warning on
`deps-vuln` — their dependencies are **not** checked. Semgrep's rule packs come from the Semgrep registry at run time
(the *tool* is pinned, the *rules* move). Container images are `image-hygiene`'s job; secrets are `secret-gate`'s.

## The selftest — proof the gate can fail

`.github/workflows/security-gate-selftest.yml` runs the **real engine and the real tools** against `security-gate/fixtures/`:
one planted finding per check (a vulnerable lodash, `flatmap-stream` malware, an `eval` of request input, a
`pull_request_target` template injection, a drifted lockfile) must each go red **by name**, the clean fixture must be
green, and the ack rules are exercised end to end. The fixtures are excluded from CodeQL and from components' own gate.
`scripts/test-security-gate-mutations.mjs` mutates the decisions themselves (33 mutants, against a green baseline).

## Changing a pinned tool or a rule pack

Edit the version in `security-gate.yml` **and** `security-gate-selftest.yml` (they must match), run the selftest, tag
`security-gate-vX.Y.Z`. Every repo follows when cardmem moves the pinned tag.
