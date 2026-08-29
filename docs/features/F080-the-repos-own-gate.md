# F080 — The repo's own gate: CI that runs BEFORE a release, not only during one

**Status:** in progress · **Opened:** 2026-08-28 · **Approved by:** Christian ("ja tilføj den test workflow")

---

## The finding, and it corrects something I said earlier today

I told Christian this morning that *"every publish job runs `pnpm test` across 39 of
39 packages before publishing"*. **That is wrong.** Measured in
`.github/workflows/publish.yml`, each of the 38 publish jobs runs:

```yaml
      - name: Test
        working-directory: packages/<that-one-package>
        run: pnpm test
```

A release runs **one package's** tests. The root script —
`check-internal-pins && test-fly-deploy-workflow && turbo run test` across all 39
packages — is something **only a human runs by hand.** No workflow in this repo
has ever run it.

So the gap is not "tests run late". It is that the workspace gate **is not
automated at all.**

### What is in `.github/workflows/` today

| File | Trigger | What it actually covers |
|---|---|---|
| `publish.yml` | 38 tag prefixes | typecheck + build + test **of the one package being released**, tag-matches-version, not-already-on-npm |
| `inventory-fresh.yml` | push to main + PR | greppable sweep · the single source parses · committed Discovery docs are not stale |
| `fly-server-deploy.yml` | `workflow_call` | a reusable workflow this repo **shares with the fleet** — it does not run here |

Nothing in that table runs another package's tests.

---

## What it cost today

`@broberg/cron` ships a `contract-drift.mjs` check: our generated `src/schema.ts`
versus the OpenAPI contract the live `cronjobs.webhouse.net` serves. That service
improved one `@description` sentence. Our copy was behind. The check correctly
went red.

**Nothing in this repo had changed.** `main` was red, every publish in the
workspace would have been blocked by it, and nothing announced it. I found it only
because I ran the root script by hand before tagging `bodymap-v0.4.0`.

Had I not: the release goes out against a red workspace, and the next session
inherits a failure with no local cause and no way to know when it started.

> A check nobody watches is not a failing check, it is a dead one.

---

## Scope

**F080.1 — the push/PR gate.** One workflow, `test.yml`, running the same root
script a human runs: `pnpm typecheck` then `pnpm test`, on every push to `main`
and every pull request.

**Non-goals for F080.1**, deliberately:

- **No branch protection / required-check configuration.** That is a repo SETTING,
  changed in GitHub's UI by the owner — not something a session flips.
- **No new tests.** This card runs what already exists; it adds no coverage.
- **No caching cleverness beyond `pnpm/action-setup`'s own.** Optimise when it is
  measurably slow, not before.
- **No `pnpm build` step.** `turbo run test` already builds what a test needs;
  adding it separately would double the work and hide which stage failed.

---

## The one real design risk: an external service can turn this red

`contract-drift.mjs` calls a live URL. That means a PR touching nothing can go red
because a *different service* changed. This is not a reason to drop the check — it
is exactly what found today's problem — but it must be **legible**, so:

- The script already distinguishes the two cases (`|| [ $? -eq 2 ]` tolerates
  *could not reach it*, fails on *drifted*). That asymmetry is correct and stays.
- The workflow comment must name this, so the next person who sees a red PR they
  did not cause knows the fix is `pnpm --filter @broberg/cron gen`, not a revert.

Three states again — reachable-and-matching, reachable-and-drifted,
not-reachable — and only the middle one is a failure.

---

## How it will be proven

**A gate nobody has watched fail is not a gate.** So the acceptance criteria are
not "the workflow file exists and is green":

1. Push a branch with a **deliberately broken test** and record the CI run going
   **red**, with the failure naming the package.
2. Push the fix on the same branch and record it going **green**.
3. Delete the branch.

Without step 1 the workflow is a green light nobody has proved is connected to
anything — see [[signals-indistinguishable-from-silence]].

## Reuse

Discovery searched for `github actions`, `workflow`, `ci`, `test gate`. The
fleet does share reusable workflows — `components` owns the
`fly-server-deploy` reusable workflow (F033.7) — but there is no shared
*test* workflow, and there is a reason not to build one: every repo's test
command differs (`pnpm test`, `vitest`, `xcodebuild test`), so the shared part
would be three lines of YAML wrapping a variable.

What the fleet shares is the RULE, not the file: the Harness-kontrakt in every
repo's CLAUDE.md says the release job must depend on the test job so one red
test blocks the deploy. This card is that rule applied here, which is what
"wire your own gate" means.
