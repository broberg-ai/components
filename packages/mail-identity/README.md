# @broberg/mail-identity

Is this inbound mail **provably** from who the `From:` field claims?

Four pure functions, zero dependencies, no I/O. They read addresses and
`Authentication-Results` **the way the grammar does, not the way a regex does**.

```bash
npm i @broberg/mail-identity
```

```ts
import { extractAddresses, addressesMatch, splitPlusTag, readAuthResults } from "@broberg/mail-identity";

extractAddresses('"cb@webhouse.dk" <attacker@evil.dk>');  // ['attacker@evil.dk']
addressesMatch(mail.from, ["cb@webhouse.dk"]);            // false
splitPlusTag("buddy+whop@broberg.ai");                    // { address: 'buddy@broberg.ai', tag: 'whop' }
readAuthResults(mail.headers["authentication-results"]);  // { verdict: 'pass' | 'fail' | 'conflicted' | 'no-verdict', … }
```

## What it owns, and what it refuses to own

| | |
| --- | --- |
| **What an address is** | `extractAddresses` · `splitPlusTag` · `addressesMatch` |
| **What the auth header says** | `readAuthResults` |
| **What a match MEANS** | **not ours** |

The third row is the design. "May this mail wake an agent" is authorisation, and
it stays at your call-site where you can read it. Move it in here and every
consumer inherits a policy it cannot see, and a change to that policy ships
silently as a patch release.

## Why this package exists

Two codebases independently wrote this same rule, and **both had holes in it,
found the same day, in each codebase separately.** The value here is not the
code — it is the cases in `test/`, every one of them an attack that **worked**
against a live implementation. Each looks correct until someone builds the
counter-example.

## API

### `extractAddresses(field): string[]`

Every address in a `From`/`To`/`Cc` field, lowercased. **A display name never
contributes one.**

```ts
extractAddresses('Christian <cb@webhouse.dk>');            // ['cb@webhouse.dk']
extractAddresses('cb@webhouse.dk <attacker@evil.dk>');     // ['attacker@evil.dk']
extractAddresses('"x <buddy@broberg.ai>, y" <a@evil.dk>'); // ['a@evil.dk']
extractAddresses('"Broberg, Christian" <cb@webhouse.dk>'); // ['cb@webhouse.dk']
```

The second line killed `from.includes(owner)`, which accepted the owner's
address written as display **text** — four call-paths reproduced it. The third
killed `field.split(',')`, which cuts a quoted display name in half *before*
quoting is understood; end-to-end it produced `isOwnerInstruction: true` for a
mail from `attacker@evil.dk` addressed to `victim@evil.dk`. The fourth is the
same bug's benign half — `Broberg, Christian` is just how a directory writes a
name, and a too-eager split turns it into a junk address.

### `addressesMatch(field, known): boolean`

Equality on extracted addresses. **Never a substring, prefix or suffix.** Both
sides go through the same extraction and the same plus-tag normalisation, so
`known` may be bare addresses or full fields. An empty or unparseable field
matches nothing.

### `splitPlusTag(address): { address, tag }`

```ts
splitPlusTag("buddy+whop@broberg.ai"); // { address: 'buddy@broberg.ai', tag: 'whop' }
splitPlusTag("buddy@broberg.ai");      // { address: 'buddy@broberg.ai', tag: null }
```

**The tag informs; the address proves.** An unknown tag must still match. A tag
able to *refuse* a match would be authorisation disguised as routing, and a typo
(`buddy+whopp@`) would make mail vanish silently. `+admin`, `+deploy`, `+urgent`
must never mean anything privileged — anyone can type them.

**Split after `extractAddresses`, never on a raw field.** The other way round
puts you back in the impersonation hole wearing a new hat.

### `readAuthResults(header): AuthResults`

```ts
type AuthVerdict = "pass" | "fail" | "conflicted" | "no-verdict";
```

**Four outcomes, not three, and never two.**

| outcome | meaning |
| --- | --- |
| `pass` | a dmarc verdict exists and everything present passed |
| `fail` | at least one method's verdicts unambiguously did not pass |
| `conflicted` | one method carries **both** a passing and a failing verdict |
| `no-verdict` | nothing readable to judge by |

Also returned: `spf` / `dkim` / `dmarc` as read, `conflicted` (which methods
disagreed), and `reason` — always set, including on `pass`, because a caller
logging a decision needs the why.

## Three things that will bite you

### 1. A missing verdict is not a failure — and the inversion is the whole point

A genuine **self-sent** mail carries **no verdict at all**: the header is written
by the *receiving* server, and a mail from your own authenticated session never
crosses that boundary. An external **forgery** of the same `From:` **does** cross
it, gets a verdict, and that verdict **fails**.

So a gate demanding `'pass'` rejects precisely the mail the feature exists for,
while letting nothing extra in. Never collapse `no-verdict` into either
neighbour.

### 2. The permissive outcome must never be your `default` branch

A new outcome silently lands in `default`. If `default` is the accepting one,
**adding an outcome widens your gate.**

This is not hypothetical. The first consumer hit it while adding the fourth
outcome *they had argued for*: `conflicted` fell into the `no-verdict` branch,
because that branch was the default — and the `no-verdict` branch accepts the
owner's own address (see #1). An injected verdict would have become the owner's
instruction. Yesterday's hole, reopened by their own cleanup, and **invisible to
every test of the reader.**

```ts
import { readAuthResults, addressesMatch, type AuthVerdict } from "@broberg/mail-identity";

type Decision = "accept-owner" | "accept-external" | "reject";

function decide(verdict: AuthVerdict, fromOwner: boolean): Decision {
  switch (verdict) {
    case "pass":
      return fromOwner ? "accept-owner" : "accept-external";
    case "no-verdict":
      return fromOwner ? "accept-owner" : "reject";   // permissive — never the default
    case "fail":
      return "reject";
    case "conflicted":
      return "reject";                                // YOUR policy, on one findable line
    default: {
      const unhandled: never = verdict;               // compile-time: a fifth outcome breaks the build
      void unhandled;
      return "reject";                                // runtime: the REJECTING answer
    }
  }
}
```

**Both layers, and neither is redundant.** `never` protects only the consumers
that compile — the input is an untrusted header, and a JavaScript consumer has
no type at all. A package that defends itself with `never` alone defends half its
consumers.

**And put the guard on the DECISION, not on the reader.** Asserting that
`readAuthResults` returns `'conflicted'` proves nothing about what you do with
it. The test that matters asserts the resulting *authorisation*. Ours is in
`test/consumer-trap.test.ts` — the snippet above, executable.

### 3. `conflicted` is not "probably an attack"

RFC 8601 **Appendix B.6**, *"Service Provided, Multi-tiered Authentication
Done"* — the standard's own example of **normal operation**:

```
dkim=pass reason="good signature" header.i=@mail-router.example.net;
dkim=fail reason="bad signature" header.i=@newyork.example.com
```

Two signatures, one good, one bad, in one header. **Syntactically identical to a
duplicate-injection attack**, and not distinguishable from one by reading the
header. So this package does not try: it reports the disagreement and you decide.

Fail-closed is a perfectly good policy. It is just not ours to choose for
everyone — and if you pick it, know that you are condemning an RFC-documented
legal case, which is a trade, not a free win.

## Notes from the corpus

- **The anchor is an allowlist.** A verdict must stand at the start of the header
  or after a real separator (whitespace, `;`, `,` — RFC 8601's own). `\b` was the
  original and a dot is a word boundary, so `\bdmarc=` matched inside
  `header.dmarc=pass`. The denylist that replaced it left 27 printable characters
  open, including a colon. The test sweeps the **entire** printable character set,
  because a hand-written list of 9 found 3 of the 27.
- **Quoted strings and comments are blanked before matching.** They are two more
  places a verdict cannot stand, and both manufactured verdicts in the prior
  implementation: `dkim=pass reason="relayed dmarc=pass ok"` turned `no-verdict`
  into `pass`. A space inside a quoted string is a legal separator to a regex and
  no separator at all to the grammar. **That one sentence explains every parsing
  bug this package was built to end**, and it is why the answer is a tokeniser
  rather than another regex patch.
- **All verdicts are read, never the first.** "First wins" lets an injected
  `dmarc=pass` drown out the real `dmarc=fail`.
- **An unambiguous fail beats a conflict.** A method where *no* verdict passed is
  stronger evidence than a disagreement elsewhere. Backwards, and a genuine
  rejection is downgraded to "cannot determine" — which a lenient consumer lets
  through.
- **A header that does not parse to the end yields nothing.** An unterminated
  quote or comment blanks every verdict after it while leaving earlier ones
  standing; erasing a trailing `dmarc=fail` and keeping a leading `spf=pass` is
  strictly useful to an attacker.
- **Read the topmost `Authentication-Results` only.** RFC 8601 B.5 shows two,
  written by two MTAs, disagreeing. Concatenate every instance and you are asking
  two machines one question and getting the disagreement you asked for.
- **The RFC cannot prove the accept path.** `dmarc=` appears **zero** times in RFC
  8601 — the three "DMARC" hits are all bibliography. Since `pass` requires a
  dmarc verdict (it is the only method that binds `From:` to what passed), every
  RFC example yields `no-verdict`, `fail` or `conflicted`. The RFC is the best
  corpus in existence for the *parser* and contributes **no positive controls**.
  That is pinned as a number in `test/rfc-8601-examples.test.ts`, so it breaks if
  anyone adds a fixture believing otherwise.

## Testing

```bash
pnpm test          # the suite
node test/mutations.mjs   # revert each security decision, one at a time
```

The mutation harness is the part worth copying. A green suite proves nothing on
its own; it checks that every reverted decision reddens a **different,
non-overlapping** set of tests. A mutation that reddens everything only proves
the suite runs, and one that reddens nothing means the decision is untested. It
found a real gap in this suite: two different defects reddened identical sets, so
a reader would have been sent to the wrong line.

MIT · part of the [broberg.ai](https://discovery.broberg.ai) shared inventory.
