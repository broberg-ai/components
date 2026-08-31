# F081 — Mutation-harness safety

**Status:** In progress · **Kind:** epic · **Written:** 2026-09-01

---

## Why an epic and not a note

Four packages here run mutation harnesses — `secret-scan`, `mail`, `greppable`,
`stripe` — and every future one will too. A harness deliberately puts **broken
code on disk** for seconds at a time: a security branch rewritten to
`if (false)`, a fallback branch deleted, a threshold moved. Then it restores it.

**While it runs, the working tree is not a source of truth, and nothing says
so.**

This epic holds the invariants every harness in this repo must satisfy — the
same role F061 plays for the build seal every multi-entry package needs. A new
harness inherits them or it is not finished.

## The invariants

| # | Invariant | Why |
|---|---|---|
| 1 | The source path is **absolute** before the first mutation | A `cd` inside the test command moves the working directory, and a relative restore path then points at nothing. Bit buddy on their harness's very first run |
| 2 | Restore writes a **saved copy**, never `git checkout <file>` | `git checkout` reads the **index** — a file staged while mutated "restores" *to the mutation*, silently and green |
| 3 | The restore is **read back** and a mismatch fails **loudly on stdout** | A failed restore is otherwise indistinguishable from no restore being needed. buddy's alarm went to stderr and vanished into the test output |
| 4 | A **marker file** exists for the whole run, and the pre-commit hook refuses over it | A rule you have to remember to check is not a gate |
| 5 | Every mutation **asserts its anchor applied** | A substitution that matched nothing reads exactly like a surviving mutant |
| 6 | No two mutations may share a **red set** | A mutation that reddens everything proves the suite runs, not that it discriminates |

**Measured 2026-09-01 across all four harnesses:** 1 and 2 already hold
everywhere; 5 and 6 hold everywhere. **3 and 4 hold nowhere.** That is F081.1.

## Stories

- **F081.1** — the marker file, the pre-commit refusal, and the read-back.

## Related

- Fleet: buddy's `scripts/mutate-guard.sh` reached invariants 1–3 first, the
  hard way. Their header is the primary source for #1 and #2.
- Repo: the **Harness-kontrakt** in `CLAUDE.md` — *"a gate does not depend on an
  agent remembering anything."*
