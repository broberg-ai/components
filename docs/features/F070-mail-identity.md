# F070 — `@broberg/mail-identity`: is this mail provably from the owner?

**Status:** planned · **Filed by:** buddy (#20448), with cardmem as co-author of
the scoping · **Owner:** components

## Motivation

buddy and cardmem **independently wrote the same security rule** — "is this mail
provably from Christian?" — and **both had holes in it, found the same day, in
each codebase separately.** Two copies of a rule that gates whether an inbound
mail can act on the owner's behalf is exactly the drift this repo exists to
prevent.

The value here is **not the code.** It is the six adversarial cases below, every
one of them measured on 2026-08-15 and open in at least one of the two
implementations. A third repo writing this from scratch would reproduce the same
holes, because each one looks correct until someone builds the counter-example.

## Reuse

Discovery searched before writing this plan (F217), four queries:
`mail identity` · `email address parse` · `dmarc auth-results` · `sender verification`.

Nothing owns inbound sender identity. The near-misses and why they are not it:

| existing | why it does not cover this |
| --- | --- |
| `@broberg/mail` | **Outbound** send via Resend. Carries a provider dependency; this is inbound, pure and zero-dep. |
| mail templates / email shell | Rendering HTML, not reading headers. |
| `@broberg/auth` | App login (Better Auth). Nothing to do with mail provenance. |

**Decision: a new package, not an addition to `@broberg/mail`.** The purity is
load-bearing — both consumers call this on untrusted input in a hot path, and a
repo that only parses inbound headers must not pull a Resend client. The blast
radius differs too: a bug in "send" is a mail that doesn't arrive; a bug here is
a forged mail treated as the owner's.

## Scope

Four pure functions, no I/O, no dependencies:

```ts
extractAddresses(field)   // "Christian <cb@webhouse.dk>, x@y.dk" → ['cb@webhouse.dk','x@y.dk']
splitPlusTag(address)     // 'buddy+whop@broberg.ai' → { address:'buddy@broberg.ai', tag:'whop' }
addressesMatch(a, b)      // equality on EXTRACTED addresses, never substring
readAuthResults(header)   // 'pass' | 'fail' | 'no-verdict'
```

## Non-goals — the most important section

**cardmem's boundary, adopted verbatim: the package owns WHAT AN ADDRESS IS and
WHAT THE AUTH HEADER SAYS. It never owns WHAT A MATCH MEANS.**

"May this mail wake an agent" stays in the consumer. Moving an authorisation
decision into a shared dependency would build something worse than the thing we
are fixing — every consumer would inherit a policy it cannot see, and a change to
that policy would ship silently as a patch release.

Also out of scope: DKIM/SPF/DMARC *verification* (we read a verdict another
system already wrote), MIME parsing, mailbox access, and anything that performs
I/O.

## The six adversarial cases — the actual deliverable

All measured 2026-08-15. Each was open in at least one implementation.

### 1. Substring impersonation

`from.includes(ownerAddress)` accepts a **display name**:

```
"cb@webhouse.dk <attacker@evil.dk>"   →  matched
```

**A display name must never contribute an address.** Four call-paths reproduced
this in buddy. Their own negative test *could never have fired* — it used an
attack address that could not possibly contain an owner address. A test that
cannot fail is not a test.

### 2. A qualified key read as a verdict

`\bdmarc=` matches **inside** `header.dmarc=pass`, because a dot is a word
boundary. Both implementations had it:

```
"header.dmarc=pass header.dkim=pass header.spf=pass; dmarc=fail; dkim=fail; spf=fail"
  → PASS
```

Every real verdict in that header is `fail`. A forged mail became a proven
owner-mail.

### 3. A denylist is the wrong direction

The first fix was `(?<![\w.-])`. Swept over the whole printable character set:
**27 characters still open**, including a colon. Correct anchoring is an
**allowlist** — RFC 8601's own separators:

```
(?<=^|[\s;,])
```

**Sweep the entire character set in the test, not a hand-written list.** buddy's
hand-list of 9 found 3 of the 27.

### 4. Duplicate injection — and why it needs a FOURTH outcome

```
"dmarc=pass; …; dmarc=fail"   → first-wins gave PASS
```

Fail closed on DISAGREEMENT. A *repeated agreeing* verdict must still pass — a
relay may legitimately repeat itself, and reading that as tampering blocks real
mail.

**But buddy then found the case that breaks a simple fail-closed rule, and I
verified it against the RFC text myself** (fetched from rfc-editor.org, not
recalled). RFC 8601 **Appendix B.6**, *"Service Provided, Multi-tiered
Authentication Done"* — the standard's own example of normal operation:

```
Authentication-Results: example.com;
      dkim=pass reason="good signature"
        header.i=@mail-router.example.net;
      dkim=fail reason="bad signature"
        header.i=@newyork.example.com
```

Two signatures, one good, one bad, in one header. **Syntactically identical to
the duplicate-injection attack.** Not distinguishable by reading the header.

So fail-closed condemns an RFC-documented legal case. That is a defensible
*policy* — buddy's, where the outcome is "no wake" rather than lost mail — but
**a shared package must not make it silently on every consumer's behalf.** That
is the non-goal above: a consumer inheriting a policy it cannot see.

**Resolution: a fourth outcome, `'conflicted'`.** The package reports that
verdicts for one method disagreed; the caller decides what that means. buddy maps
it to fail in one explicit line. A consumer that understands multi-tiered auth
can look at the qualifiers.

This is the third time this week the same fix has been right: `unconfirmed` split
out of seti-client's `ok:false` (F069.1), `scanned` split "found nothing" from
"never looked" in secret-scan 0.3.0, and now this. **When one answer is
collapsing two different facts, split them and make the caller choose.**

### 5. A missing verdict is not a pass

Three outcomes, never two. And the inversion that makes it matter: a genuine
**self-sent** mail has **no verdict at all** (the header is written by the
*receiving* server), while an **external forgery has one, and it fails**. A gate
requiring `'pass'` would reject precisely the mail the feature exists for.

### 6. Folded headers must pass

Newline + tab continuation, and no space after `;`. An allowlist that is too
narrow rejects genuine mail — the opposite error, and equally expensive.

## Prior art — and two warnings buddy filed against their own code

buddy's implementation: `apps/server/src/mail/sender-proof.ts` (+ 92 tests).
Offered for verbatim adoption, rewrite, or refusal. Start from their **cases**
regardless; the cases are the asset. But take both caveats, in their words:

> **"De 92 tests er IKKE 92 beviser."** Several were green this morning while
> the code was broken — they used only well-formed headers, so the sample space
> contained **no case where the difference between a verdict and an attribute
> that looks like one could show itself.** The guard was not broken; it answered
> correctly a narrower question than the one it was used for.

Same failure family as everything else this week. **Do not take 92 as coverage.**

> **"Nul kaldesteder."** Their implementation is not wired to anything in
> production. No real mail has ever passed through it.

### That second one inverts a requirement

It means the package will be adopted by a consumer that has **never run it
against real mail**. Their 92 tests prove it *rejects forgeries*; nothing proves
it *accepts genuine mail* — and case 6 (folded headers) is exactly that error,
the expensive opposite.

So **cardmem's 11 call-sites are not merely the riskiest migration — they are the
fleet's only source of real-traffic evidence for this package.** Their
before/after comparison is not just a safety check on their side; it is the only
thing that will ever demonstrate the accept-path works on mail that actually
arrived. F070.2 says so explicitly, because a reader would otherwise assume the
92 tests already covered it.

### And "build the accept side from the RFC" does not rescue it

That was my instruction, and buddy disproved it. **Measured, and re-measured here
independently against the RFC text: `dmarc=` appears ZERO times in RFC 8601** —
only as a bibliography reference. The standard's examples use spf, dkim, auth and
an invented `foo` method.

So if the package requires a **dmarc** verdict to say "proven" (and it should —
dmarc is the only one that binds the `From:` field to what passed), then **every
single RFC example yields `no-verdict`.** The RFC can exercise the *reject* path
and the *syntax* — folding, separators, comments, multiple methods, which is
genuinely valuable for the parser — but it contributes **zero positive controls**
for the accept path.

Which sharpens the earlier point rather than replacing it: cardmem's 11 are not
just the best source of accept-path evidence, they are now the **only** one.

## Rollout

1. Build + publish `v0.1.0`. **New package name ⇒ no npm Trusted Publisher ⇒
   bootstrap publish gated on Christian's OTP** (same blocker as
   `@broberg/greppable`).
2. buddy migrates `sender-proof.ts` to the package.
3. **cardmem's condition, and it is right:** the package only pays off if their
   **11 existing call-sites migrate too** — otherwise we go from two copies to
   two copies. Those 11 decide which PROJECT a mail lands in, so the migration
   requires a **byte-identical before/after result on every existing rule**.
   That migration is cardmem's to run and to prove; this repo owns the primitive.
4. Add to Discovery + the reuse roster.

Nothing is blocked on this — the wake-path is off in both consumers.
