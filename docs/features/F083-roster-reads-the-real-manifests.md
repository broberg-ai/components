# F083 — the roster reads the fleet's real manifests

**Status:** Backlog · **Written:** 2026-09-03 · **Owner order:** Christian, looking
at the live page:

> *«ALLE repos i cardmem skal minutiøst læses igennem i deres package imports og
> listes på den roster og det skal du også have et continuerligt job der
> vedligeholder for dig så discovery.broberg.ai er current ellers er den intet
> værd.»*

The last clause is the specification. A roster that is not current is not a
weaker roster — it is worth **less than nothing**, because it CLOSES the
question. A session reads it, believes it, and builds a second copy of something
that already exists.

## Measured, 2026-09-03

32 repos, **179 package.json files** read straight from GitHub's tree + blob API,
0 unreadable, 0 repo errors:

```
real dependency edges          149
the FLEET section shows         15      (10%)
self-reported enrollments      116
```

**Eight repos have no row at all** — contentpush (10 deps), fd-sundhed (16),
happy-little-place (9), beacon (8), moovyy (8), broberg-ai-site (4),
coverletter-generator (3), vnlekerv2 (2).

**Of the 11 rows that do exist, every single one understates:**

```
repo                     page   real
components (our own)        0      7
cardmem                     3     16
xrt81                       3     12
cms                         1      8
sanneandersen               2      8
buddy                       0      6
upmetrics                   0      5
```

And the line that settles it: **`@broberg/ai-sdk` is depended on by 17 repos.**
The page names it zero times.

## Why it was always going to be wrong

The section renders from a **hand-written array of 11 rows** in
`scripts/inventory-data.mjs`. It can only ever be as fresh as the last person who
remembered to edit it, and nothing on the page says when that was. That is not a
maintenance lapse to be scolded about — it is a design that requires human memory
to stay true, which is the same failure this repo keeps finding everywhere else.

## Design

### 1. `scripts/scan-fleet-deps.mjs` — the ground truth

For each repo: resolve the default branch, walk the **whole tree**
(`git/trees/<branch>?recursive=1`), take every `package.json` outside
`node_modules`, read each blob, and collect `@broberg/*` + `@upmetrics/*` from
`dependencies`, `devDependencies`, `peerDependencies` and `optionalDependencies`
— recording the range, the field and the manifest path for each.

**Walking the tree is not thoroughness for its own sake:** components has 41
manifests, cms 32, trail 21, buddy 11. Reading only the root would report **zero**
for the heaviest consumers in the fleet.

**What it measures, stated precisely** so nobody reads it as something stronger:
what a repo **declares** — i.e. what npm would install. Not what the code
*imports* (a declared dependency can sit unused), and not what is *deployed* (a
branch is not a release). Declared-in-manifest is the right question for a reuse
roster, because the question a reader actually has is "is this already in the
house".

**An unreadable manifest is counted separately from a manifest with no deps**, and
a repo that fails to scan is reported as FAILED rather than as having nothing.
Merging those two is how a broken read becomes a clean-looking result.

### 2. The FLEET section renders from the scan

Derived facts (who depends on what, at which range) come from the scan file.
**Hand-written role text stays hand-written** — npm can prove a dependency
exists; it cannot say what a repo is *for*. Same split the roster already applies
to `ver` versus `desc`.

The page shows **when it was last scanned**, and says so loudly when that is old.
A stale number that looks current is the defect being fixed here, not a smaller
version of it.

### 3. The job that keeps it current

A **scheduled GitHub Actions workflow**, daily: run the scan, write the artifact,
commit if it changed — which already triggers the Discovery deploy.

**Deliberately NOT a session dispatch or a local cron.** This job needs no
judgement, so it must not need an agent to be awake: a job that depends on
someone being there is the same fragility as a list that depends on someone
remembering. That is the exact failure being replaced, and re-introducing it one
layer down would be a joke at our own expense.

### 4. Reconcile against the self-reports

The scan (149) and the enrollment table (116) answer different questions and
both are useful: the scan says what a repo *installs*, enrollment says what a
session *told us*. Where they disagree, the disagreement is the finding — a repo
that enrolled a package it no longer depends on, or depends on a package it never
enrolled.

## Non-goals

- **Not import-level analysis.** "Which file imports it" is a bigger job with a
  worse cost/benefit, and manifest-declared is what npm installs. If a declared
  dependency turns out to be unused, that is a finding for the repo, not a defect
  in this scan.
- **Not private/third-party dependencies.** Only `@broberg/*` and `@upmetrics/*`
  — the shared inventory. The rest is each repo's own business.
- **Not deleting the hand-written rows.** Role text survives; only the derived
  arrays are replaced. Replace, prove, then remove.

## Reuse

Discovery checked for existing tooling (`dependency audit`, `npm audit`,
`inventory`): nothing does cross-repo manifest scanning. The nearest neighbour is
`@broberg/greppable`, whose thesis applies directly and is written into the AC —
**a run that read nothing must not report clean.** The scan therefore records
manifests-read and unreadable-count per repo, so a zero can never be mistaken for
an answer.
