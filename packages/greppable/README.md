# @broberg/greppable

Find the tracked text files **your grep silently skips**.

```bash
npx @broberg/greppable
```

Exit 0 and one line if every tracked file is searchable. Exit 1, with the paths
and byte offsets, if any is not.


## Running it offline (no `npx`, no network)

`npx --yes @broberg/greppable` fetches on every run, which puts a network call
inside a check that is otherwise entirely local. Filed by torrent-search-api,
whose suite runs offline on a laptop that is regularly without a connection — a
fair reason not to adopt, and it needed an answer rather than a shrug.

Install once and run the local binary:

```bash
npm i -D @broberg/greppable
```

```jsonc
// package.json
"scripts": { "gate:greppable": "greppable" }
```

Or call it from a test you already run, which also gets you the structured
report instead of an exit code:

```ts
import { checkGreppable } from "@broberg/greppable";

const r = checkGreppable();
expect(r.ok).toBe(true);   // false on offenders, unreadable files,
                           // a coverage gap, OR zero files scanned
```

Zero runtime dependencies, so the install adds nothing but this package.

## The defect

In a cc session `grep` is **not** `/usr/bin/grep`. It is a bash function the
harness installs, which execs the claude binary in ugrep mode with `-I`
(*ignore binary*). On a file it decides is binary it prints **nothing** and exits
**1** — indistinguishable from "no matches", with no error and no warning.

So every grep-based sweep over that file is falsely green: testid audits, secret
scans, convention checks. Nothing tells you a file was skipped.

Not hypothetical. In one repo a **1963-line file was invisible to every sweep for
58 days**. In another, `grep -c export` on a 112-line file with 6 exports
returned nothing.

## What makes a file invisible

**A raw NUL byte, OR content that is not valid UTF-8.** A union — and both halves
are load-bearing, because *each one looks like the fix for the other*:

| predicate | what it misses |
| --- | --- |
| contains a NUL | a Danish file saved as latin-1 (`ø` = `0xF8`, no NUL anywhere) |
| not valid UTF-8 | a NUL file — **`U+0000` is legal UTF-8**, so the decoder accepts it |
| **the union** | — |

On 2026-08-11 nine repos hand-wrote this check within four hours. At least three
got the predicate wrong, in both directions, and **each wrong version passed its
author's own negative control** — because the control was drawn from the same
axis as the test. That is what this package is for.

### `-I` is not one behaviour

Two sessions measured this and got opposite answers. Both were right about their
own binary:

|  | `grep` (shim) | `/usr/bin/grep` | `grep -I` | `LC_ALL=C grep` | `rg` |
| --- | --- | --- | --- | --- | --- |
| NUL byte | **misses** | 1 | **misses** | 1 | 1 |
| latin-1, no NUL | **misses** | 1 | 1 | 1 | 1 |

GNU/BSD `-I` keys on NUL alone; ugrep `-I` keys on UTF-8 validity as well.
Checking the union means this package never has to know which binary is in front
on a given machine.

> **Verifying a negative result by hand? Use `rg`.**
> Not `command grep` — on a Mac with Homebrew's ugrep first in PATH that lands on
> the very tool you were escaping. `rg` found every case in every cell above.

> **Only the interactive session is exposed.** CI jobs, shell scripts and hooks
> calling the system grep were never affected. Don't go auditing pipelines for a
> defect that lives in a chat window.

## Use it as a gate

```yaml
# .github/workflows/ci.yml
- name: Every tracked text file is greppable
  run: npx -y @broberg/greppable
```

Or from your own test suite, so the failure lands next to your other red tests:

```ts
import { checkGreppable } from "@broberg/greppable";

it("no tracked file is invisible to grep", () => {
  const report = checkGreppable();
  expect(report.offenders).toEqual([]);
  expect(report.ok).toBe(true);
});
```

`report.ok` is `true` only when **every tracked file was accounted for** *and*
none is invisible. A run with an unreadable file or a coverage gap is not ok even
with zero offenders — that is the exact failure class this exists to expose.

```ts
interface GreppableReport {
  tracked: number;          // everything git ls-files returned
  scanned: number;          // files actually read
  skipped: string[];        // unreadable, each with its reason — never silent
  exempt: { file, format, ratio }[];   // recognised binaries, printed not dropped
  offenders: { file, kind, at, size, format, ratio }[];
  coverageGap: number;      // tracked - scanned - skipped; must be 0
  ok: boolean;
}
```

## Fixing what it finds

- **NUL:** write the value as the six-character escape sequence instead of a
  literal NUL. Identical at runtime, and the file stays greppable.
- **Encoding:** `iconv -f latin1 -t utf8`. The bytes change; the text does not.

## Three rules it is built on

All three were filed by a repo that got bitten, and each one is why a version of
this check that looked fine was not.

1. **No exception list up front.** Scan everything tracked, classify *after*. An
   extension allow-list silently shrinks what you looked at — one version listed
   `.svg` as binary, 31 files went unmeasured, and the run still said "clean".
   Classification here only ever *interprets* a hit already measured, so a gap in
   the signature table produces noise, never silence.
2. **The check proves its own coverage.** `scanned + skipped === tracked`.
   Without it, "0 findings" and "0 files examined" are the same output.
3. **Non-regular files are counted and named.** `git ls-files` also lists
   symlinks and submodule pointers. A guard that skips something quietly has the
   very property it exists to expose.

## Known limits, stated rather than discovered later

- Exemption requires **both** a binary signature *and* genuinely binary bytes
  (≥10% non-text). Measured: real binaries land at 56–77%, a text file wearing a
  `%PDF` signature at 1.85%. So an **uncompressed PDF** — largely ASCII — will be
  flagged. Deliberate: rule 1 prefers loud noise over silence.
- It reports; it does not fix. Your repo decides.
- It has no opinion on secrets, testids or conventions. It answers exactly one
  question: *can the tool see this file.*

---

Zero dependencies. Owner: `broberg-ai/components`.
