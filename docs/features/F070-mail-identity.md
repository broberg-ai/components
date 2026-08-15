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

### 4. Duplicate injection

```
"dmarc=pass; …; dmarc=fail"   → first-wins gave PASS
```

**Fail closed on DISAGREEMENT.** But a *repeated agreeing* verdict must still
pass — a relay may legitimately repeat itself, and reading that as tampering
blocks real mail.

### 5. A missing verdict is not a pass

Three outcomes, never two. And the inversion that makes it matter: a genuine
**self-sent** mail has **no verdict at all** (the header is written by the
*receiving* server), while an **external forgery has one, and it fails**. A gate
requiring `'pass'` would reject precisely the mail the feature exists for.

### 6. Folded headers must pass

Newline + tab continuation, and no space after `;`. An allowlist that is too
narrow rejects genuine mail — the opposite error, and equally expensive.

## Prior art

buddy's tested implementation: `apps/server/src/mail/sender-proof.ts` (+ 92
tests). Offered for verbatim adoption, rewrite, or refusal. Start from their
cases regardless; the cases are the asset.

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
