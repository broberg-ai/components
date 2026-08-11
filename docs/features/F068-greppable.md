# F068 — `@broberg/greppable`

> Epic. Written 2026-08-11, in the same turn as the card.

## Motivation

A tracked text file that a session's `grep` silently skips makes **every**
grep-based sweep over it falsely green — testid audits, secret scans, convention
checks — with no error, and the result is indistinguishable from a real "nothing
found".

Not hypothetical: in `buddy` a 1963-line file was invisible to every sweep for 58
days; in this repo `packages/lens-engine/src/coverage.ts` returned nothing for
`grep -c export` on a 112-line file with 6 exports.

**Why an inventory item and not a script.** On 2026-08-11, within four hours of
the class being described, *nine* sessions independently wrote their own version
(buddy, cardmem, beacon, fds, sanne, upmetrics, ai-sdk, fd-sundhed,
torrent-search-api). Nine chances to get the predicate wrong — and at least three
did:

| predicate | misses | shipped by |
|---|---|---|
| contains a NUL | latin-1 files (o-slash = 0xF8, no NUL) | this repo's first version, torrent-search-api |
| not valid UTF-8 | NUL files — **U+0000 is legal UTF-8** | buddy (green on its own founding case for 20 min), upmetrics' proposal |
| **NUL or not valid UTF-8** | — | the corrected version, `scripts/check-greppable.mjs` |

Each wrong version passed its author's own negative control, because the control
was drawn from the same axis as the test. That is the argument for one
maintained implementation rather than nine.

## Reuse

Checked Discovery before planning. No `@broberg/*` package covers this; the
nearest is `@broberg/secret-scan`, and it was **measured** not to be the home:
it is pure string-in/string-out with no file-reading surface at all, so a NUL
cannot blind it (it still finds a key in 3 of 4 constructed worlds). The
blindness is in the search tool, not in any scanner. ai-sdk agreed and closed
their proposal (#20020). Precedent for the shape: F033.7 shipped a fleet-shared
gate as a reusable workflow rather than a package — here a bin is the better
shape because several fleet repos have no GitHub Actions.

## Scope

- `packages/greppable`, published `@broberg/greppable`, with a **bin** so any
  repo runs `npx @broberg/greppable` in CI with no config.
- Predicate = the union: a NUL byte **or** not valid UTF-8.
- Binary classification from magic bytes, applied **after** measurement, never as
  an up-front extension allow-list.
- Exemption requires **both** a binary signature and a genuinely binary byte
  ratio, so a text file wearing a signature (`%PDF` note saved as latin-1) is
  caught rather than silently excused.
- Coverage self-proof: `scanned + skipped === tracked`, and any skip is an error.
- Also exported as a function so a repo can call it from its own test suite.

## Non-goals

- Fixing the offending files. It reports; the repo decides.
- Any opinion on secrets, testids or conventions — this only answers "can the
  tool see this file".
- Changing the harness. `-I` reporting "N files skipped" would be the real fix
  (sanne's point) but is not ours to make.

## Architecture

Lift `scripts/check-greppable.mjs` verbatim as the core, split into
`checkGreppable({ cwd })` returning `{ scanned, skipped, exempt, offenders }`
and a thin bin that formats + sets the exit code. Zero dependencies:
`node:child_process` for `git ls-files`, `node:fs`, `TextDecoder`.

## Rollout

1. Bootstrap-publish `v0.1.0` (new name ⇒ no Trusted Publisher yet — see the
   npm-publish section in CLAUDE.md; expect an OTP prompt).
2. Christian sets up the Trusted Publisher; add the `greppable-v*` job to
   `publish.yml` so 0.1.1+ ships via OIDC.
3. Tell the nine sessions that hand-rolled it; each replaces its copy.
4. Add to Discovery (`scripts/inventory-data.mjs`) so it is findable.

## Known limits, stated rather than discovered later

- The byte-ratio threshold means an **uncompressed PDF** (largely ASCII) will be
  flagged. Deliberate: rule 1 prefers loud noise over silence.
- `-I` is not one behaviour. GNU/BSD `grep -I` keys on NUL alone; ugrep `-I`
  keys on UTF-8 validity too. The union covers both, which is why the guard does
  not need to know which binary a given machine has.
