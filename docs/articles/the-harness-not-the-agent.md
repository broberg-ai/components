# The harness, not the agent

## How we ship large, complex software fast — by assuming our agents are wrong

**Draft for broberg.ai · written by the `components` session, 2026-08-31 · for `cms` to land**

---

At broberg.ai, essentially all production code is written by AI agents. Not
assisted, not autocompleted — written. One person sets direction; the agents
build, review, deploy and operate. That arrangement produces software at a speed
that used to require a team, across a fleet of live systems: municipal health
operations, clinic booking and payments, a shared library of 45 published
npm packages, an observability platform, a project-management surface, a design
verification engine.

The obvious question is the right one: **how do you trust any of it?**

The answer is not the one people expect. We do not claim our agents don't make
mistakes. They make them constantly, and so do we. What we build — deliberately,
continuously, and as first-class product work — is the **harness**: the machinery
that catches a mistake before it reaches anyone who would be hurt by it.

The distinction matters, because only one of those two claims can survive
contact with reality.

---

## A rule is a reminder. A gate is a mechanism.

Early on we did what everyone does: we wrote the rules down. Never claim
something works without proof. Never bypass a failing test. Read the value back
from the database before saying it saved.

Written rules are necessary and they are not sufficient, for a reason that has
nothing to do with AI: **a rule depends on someone remembering it at exactly the
moment they are busy.** Our own internal contract now says it in one line — *a
gate does not depend on an agent remembering anything.*

So every rule that matters has been converted into something mechanical:

- A **pre-commit gate** that refuses to commit a credential — not by asking the
  agent to be careful, but by scanning the staged change and exiting non-zero.
- A **release gate** where the deploy job depends on the test job, so one red
  test blocks the release rather than producing a warning somebody scrolls past.
- **Acceptance criteria as data**, attached to the work item, each one requiring
  evidence — a tool result, a value, a screenshot — before it can be ticked.
- A **review gate** that will not let work be marked done until code review,
  security review, visual verification and the criteria have all been recorded
  green, with the evidence stored beside the result.

None of that is exotic. What is unusual is treating the harness as the product
rather than as overhead — and continuing to invest in it every single week,
because the failure modes keep evolving.

---

## The gate that blocked its own cleanup

Here is a real example from the week this was written, and it is a good one
precisely because it makes us look imperfect.

Our commit gate scans every staged change for anything shaped like a credential.
It works. It has caught real keys.

Then an agent tried to delete a stale document that happened to quote a public
example key from AWS's own documentation — and the commit was refused. The gate
was reading the whole change, additions *and deletions*. So the commit whose
entire purpose was to remove the credential was the one commit it would not
allow.

The guard was preventing the exact cleanup it exists to force. And the only
workaround it left was the one thing that must never be done to a gate:
disabling it.

The fix took an hour. What is worth noticing is not the fix but the shape:

- The defect was found **by the gate doing its job**, not by an audit.
- The fix was proven by first writing a test that **failed** against the old
  behaviour — removing a credential blocked, in both scanning layers.
- The test was then **mutated**: the old behaviour was deliberately restored, and
  the test had to go red. Then the fix was weakened to scan nothing at all, and a
  different test had to go red. A test that cannot fail is decoration.
- While writing that test, we found the test itself was **green for the wrong
  reason** — it was being blocked by an unrelated layer, so the check it claimed
  to make was never running.
- And the first mutation **did not actually reintroduce the defect**, which the
  harness reported rather than quietly passing.

Five things went wrong in a one-hour fix. None reached a user. That ratio is the
product.

---

## Agents that review each other, and refuse to take each other's word

The second half of the harness is not code. It is a working practice between
sessions.

Each repository has its own long-running agent. They talk to each other directly
— a shared library session, the sessions that consume it, the fleet daemon, the
project-management system. And the house rule between them is blunt: **measure,
never take it on report.**

In a single evening this week, that practice produced the following, all between
agents, none involving a human:

- One session reported that a shared package mislabelled EU data residency —
  reporting "unknown" instead of "EU" for the one provider we route personal data
  to. It failed *closed*, so no data left the EU; a consumer enforcing residency
  would have rejected its own lawful call. Fixed within the hour, then verified
  by a second session installing both published versions and diffing the shipped
  artefact rather than trusting the report.
- That verification found a **further** defect in the fix: the function everyone
  was being pointed to had the same flaw one step to the left.
- Two sessions then disagreed about a third package's behaviour, both with
  measurements in hand. The disagreement turned out to be the finding: they were
  measuring different published versions, and the newer one had moved a rule out
  of the documented list without changing its behaviour. Anyone auditing the
  package the documented way would have concluded the rule was gone. It was not.
- A consumer declined a feature we offered them, with a better argument than the
  one we had used to justify building it: *the right to receive an uncertain
  answer belongs to whoever can display the uncertainty.* Their interface shows a
  value as a fact, so a guess handed to them silently becomes an assertion. They
  took the empty answer instead.

Every one of those is a defect that would otherwise have been found by a
customer, or not at all. None was found by a human reading code.

---

## The failure we keep finding, and how we now hunt it

Across dozens of incidents one shape recurs so often that we now name it
explicitly in our engineering documents: **a result shaped like success that is
really a non-answer.**

- A mailer returning `ok` for four different reasons, one of which was "sent
  nothing".
- A model registry answering `ok` for a model it had never heard of, handing back
  the caller's own input as if it were an answer.
- A knowledge base that could not distinguish "found nothing" from "could not be
  reached" — so with the source down, it answered health questions from generic
  knowledge, in a specialist's voice.
- A probe reporting "0 of 39 patterns match" because the field name was guessed
  wrong, and a wrong field name and a genuine absence return the same value.

The cure generalises, and it is now standard practice: **make the two states
distinguishable, then forbid the indistinguishable form structurally.** In
practice that means a function reports which checks it was actually able to run,
not merely what it found. It means an exception in the code must carry a written
reason — never read at runtime, existing only to make a *silent* exception
impossible to write. And it means a structural test that reads the list of
allowed exceptions out of the source of truth rather than restating it, and
prints the offending line rather than a count, because a count tells the next
reader nothing about where to look.

The connected discipline: **never trust a green result from a check you have not
seen fail.** Prove the red first. Otherwise a check that has silently stopped
testing anything looks exactly like a check that passes.

---

## Optimising for the human's attention, not the machine's time

The most recent harness change came from a one-sentence correction by the person
this all serves.

We had measured that fleet sessions spent 38.6 hours running deployments in the
foreground — during which a session cannot answer. We built a guard that pushes
long-running work into the background, where it keeps running across turns, wakes
the agent when it finishes, and still returns the exit code that makes a
deployment *proven* rather than assumed.

Then the correction, and it reframed the metric: *the agent isn't the one losing
time — I am.* A session waiting loses nothing. What it costs is that the person
orchestrating the fleet cannot reach one of his agents.

Which means the unit is not seconds; it is **interruptions**. A twenty-minute
deployment at three in the morning with nobody waiting costs zero. Two minutes of
silence in the middle of a conversation costs two minutes and the experience of
being ignored. That single change of denominator invalidated the threshold we had
just derived, and the measurement was re-run against the right unit before
anything shipped.

When it was re-run, it showed something none of us had guessed: how often he was
actually sitting there was **the same** for short and long waits. And the short
waits — median eighteen seconds — were deliberately left outside the guard,
because a round trip to the background costs more than it saves and would make
his conversations *slower*. That hour is left on the table on purpose.

That is the whole method in one story: build it, measure it, let the person it
serves tell you the measurement was of the wrong thing, and go again.

---

## What it buys

Volume and complexity that would otherwise need a team, at a defect rate that
keeps going down rather than up as the systems get bigger. Not because the agents
stopped being wrong — this week alone they were wrong about a regular expression,
a data-residency label, a test that passed for the wrong reason, and a mutation
that did not mutate.

Because every one of those was caught by something built to catch it.

**We do not claim our software has no bugs. We claim that the interesting ones
are found by our own machinery, usually within the hour, and that the machinery
gets better every week — because building it is treated as the real work, not as
the overhead around the real work.**

For a small company shipping systems that municipalities and clinics depend on,
that is a more useful promise than perfection. It is also the only one that
stays true.

---

*Notes for `cms`: written in English on the assumption that broberg.ai's article
surface is English — say the word and a Danish version follows. Deliberately no
customer names, no repository names, and no internal system names; every example
is anonymised to the capability level, and the numbers quoted are ones we
measured. The one editorial call worth flagging: the brief asked for "without
errors at record speed". That claim is contradicted by our own evidence, and a
reader can disprove it the first time something breaks. The piece makes the
stronger, defensible claim instead — the errors happen and the harness catches
them. If you want the original framing back, that is the owner's call, not
mine.*
