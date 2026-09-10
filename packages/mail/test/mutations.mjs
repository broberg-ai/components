#!/usr/bin/env node
// F005.11 - mutation pass for the status primitive.
//
// Two properties: no mutation may go UNCAUGHT, and no two may produce the SAME
// red set - a mutation that reddens everything proves the suite runs, not that
// it discriminates.
//
// Carried over from @broberg/secret-scan's harness, including the three things
// a naive one gets wrong:
//   - it REFUSES to run on an uncommitted source file. `finally` does not run
//     on a kill, and a killed run leaves the source mutated, which reads exactly
//     like working source.
//   - it asserts every mutation's ANCHOR applied. A substitution that silently
//     matched nothing reads exactly like a surviving mutant.
//   - it STRIPS ANSI before parsing the failing lines. Under CI vitest keeps
//     colour on, so an anchored /^\s*x/ matches nothing and a caught mutation
//     is reported as uncaught - a harness that cannot read the red it caused.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
// F081.1 — announce the mutated tree, and PROVE the restore took.
import { writeMarker, clearMarker, assertRestored } from "../../../scripts/mutation-marker.mjs";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = {
  index: join(PKG, "src", "index.ts"),
  events: join(PKG, "src", "events.ts"),
  verify: join(PKG, "src", "verify.ts"),
  integrity: join(PKG, "src", "integrity.ts"),
};

// A mutant left on disk by a killed run is indistinguishable from real source.
for (const [name, file] of Object.entries(FILES)) {
  const dirty = execFileSync("git", ["status", "--porcelain", "--", file], { cwd: PKG })
    .toString()
    .trim();
  if (dirty) {
    console.error(
      `refusing to mutate an uncommitted file (src/${name}.ts).\n` +
        `  Commit first: a killed run skips the restore, and mutated source then\n` +
        `  reads exactly like working source.`,
    );
    process.exit(1);
  }
}

const MUTATIONS = [
  {
    // F005.13 — the defect, restored: an event outside the vocabulary returns
    // undefined while the signature promises a MailVerdict.
    name: "the off-vocabulary fall-through is dropped (undefined for a new event)",
    file: "events",
    from: "  return Object.prototype.hasOwnProperty.call(VERDICT, event as string)\n    ? VERDICT[event as MailEventType]\n    : 'unknown';",
    to: "  return VERDICT[event as MailEventType];",
    expect: ["answers \"unknown\", never undefined"],
  },
  {
    // ...and the OTHER direction, which looks like a fix and is not: answer
    // 'unknown' for everything. Every off-vocabulary test still passes.
    name: "everything answers unknown (the fix that stops discriminating)",
    file: "events",
    from: "  return Object.prototype.hasOwnProperty.call(VERDICT, event as string)\n    ? VERDICT[event as MailEventType]\n    : 'unknown';",
    to: "  return 'unknown';",
    expect: ["every documented event still maps exactly as it did", "NEGATIVE CONTROL"],
  },
  {
    // The own-property check removed: an object literal inherits
    // Object.prototype, so verdictForEvent('toString') hands back a FUNCTION.
    name: "the own-property check is dropped (an inherited member is returned)",
    file: "events",
    from: "  return Object.prototype.hasOwnProperty.call(VERDICT, event as string)\n    ? VERDICT[event as MailEventType]\n    : 'unknown';",
    to: "  return (VERDICT[event as MailEventType] ?? 'unknown') as MailVerdict;",
    expect: ["not a function, not an object"],
  },
  {
    // THE DEFECT THIS STORY EXISTS TO PREVENT. If "we could not look" renders as
    // "it failed", a consumer writes to a customer to say their address is wrong
    // when the real problem is our own API key.
    name: "unknown collapses into failed (a 401 reads as a bounce)",
    file: "index",
    from: `      ? { verdict: "unknown", reason }`,
    to: `      ? { verdict: "failed", reason }`,
    expect: ["could-not-look is never reported as failure"],
  },
  {
    // The privacy guard. The provider returns the entire message body on this
    // endpoint, and a status object is the first thing a consumer logs.
    name: "the body is returned whether or not the caller asked",
    file: "index",
    from: `      if (options?.includeBody) {`,
    to: `      if (true) {`,
    expect: ["is absent by default, even though the provider sent it"],
  },
  {
    // The mapping nobody gets right by intuition, in the direction that hurts.
    name: "complained is filed under failure (it ARRIVED)",
    file: "events",
    // Anchor updated with F005.13: the switch became a Record, so the same
    // decision now lives on one line. The decision is unchanged — a complaint
    // means the mail ARRIVED and the reader disliked it.
    from: "  complained: 'delivered',",
    to: "  complained: 'failed',",
    expect: ["complained is DELIVERED"],
  },
  {
    // One of the four events that used to be dropped, taken back out.
    name: "email.suppressed is dropped again (a non-delivery goes silent)",
    file: "events",
    from: `  'suppressed',\n];`,
    to: `];`,
    expect: ["email.suppressed"],
  },
  {
    // F005.15, DEFECT 1 RESTORED. Resend puts SPF on send.<domain>; looking at
    // the apex called helpdesk's verified domain broken for three months.
    name: "SPF is looked up on the apex only (one level beside where it lives)",
    file: "verify",
    from: "  spfHosts: (d) => [`send.${d}`, d],",
    to: "  spfHosts: (d) => [d],",
    expect: ["support.fdsundhed.dk reports ok"],
  },
  {
    name: "MX is looked up on the apex only",
    file: "verify",
    from: "  mxHosts: (d) => [`send.${d}`, d],",
    to: "  mxHosts: (d) => [d],",
    expect: ["says WHICH hostname carried each record"],
  },
  {
    // F005.15, DEFECT 2 RESTORED — the false green, and the worse of the two.
    // Any MX at all was accepted, so a Google-hosted domain was told its SES
    // bounces would come back.
    name: "MX is judged by presence again (a Google MX clears the SES check)",
    file: "verify",
    from: "      (mx) => mx.some((r) => matchesSuffix(r.exchange, layout.mxSuffixes)),",
    to: "      (mx) => mx.length > 0,",
    expect: ["a Google MX does not carry SES bounces"],
  },
  {
    // The same shape on SPF: prefix accepted, authorisation never checked.
    name: "SPF is judged by its v=spf1 prefix again (include: is never checked)",
    file: "verify",
    from: "        return record.startsWith('v=spf1')\n          && layout.spfMechanisms.some((m) => record.includes(m.toLowerCase()));",
    to: "        return record.startsWith('v=spf1');",
    expect: ["an SPF record that does not authorise the provider is not ok"],
  },
  {
    // More hostnames means more ways to fail silently. A failed lookup must not
    // decay into a confident "the record is absent".
    name: "a failed lookup decays into missing (a resolver hiccup becomes a false alarm)",
    file: "verify",
    from: "  return sawUnknown ? { state: 'unknown' } : { state: 'missing', presentButUnmatched };",
    to: "  return { state: 'missing', presentButUnmatched };",
    expect: ["keeps the record unknown, never missing"],
  },
  {
    // "spf: ok" without the hostname is a claim a reader cannot re-run.
    name: "the record no longer says where it was found",
    file: "verify",
    from: "  if (spf === 'ok') foundAt.spf = spfProbe.host;",
    to: "  if (spf === 'ok') foundAt.spf = undefined;",
    expect: ["says WHICH hostname carried each record"],
  },
  {
    // F005.17 — the lookup removed entirely: back to reasoning about DMARC in a
    // comment and never asking.
    name: "the DMARC lookup is dropped (the policy is reasoned about, never resolved)",
    file: "verify",
    from: "  const dmarcState = dmarcProbe.state;",
    to: "  const dmarcState = 'ok';",
    expect: ["a TXT that is NOT a policy yields missing"],
  },
  {
    // THE ONE THAT MATTERS: "the name answered" accepted as "there is a policy".
    // A google-site-verification at _dmarc.<domain> would clear the check.
    name: "the policy check is loosened to 'a TXT exists' (a non-policy passes)",
    file: "verify",
    from: "  return parts.join('').trim().toLowerCase().startsWith('v=dmarc1');",
    to: "  return parts.join('').trim().length > 0;",
    expect: ["a TXT that is NOT a policy yields missing"],
  },
  {
    // includes instead of startsWith — RFC 7489 requires the version tag first,
    // so a TXT merely MENTIONING the string is not a policy.
    name: "startsWith becomes includes (a record that mentions v=DMARC1 passes)",
    file: "verify",
    from: "startsWith('v=dmarc1')",
    to: "includes('v=dmarc1')",
    expect: ["does not START with it is not a policy"],
  },
  {
    // The case-insensitive fold dropped: a valid v=dmarc1 reads as missing —
    // a confident false alarm about a domain that is fine.
    name: "the prefix match becomes case-SENSITIVE (a valid v=dmarc1 reads as missing)",
    file: "verify",
    from: "  return parts.join('').trim().toLowerCase().startsWith('v=dmarc1');",
    to: "  return parts.join('').trim().startsWith('v=DMARC1');",
    expect: ["CASE-INSENSITIVE"],
  },
  {
    // The organisational-domain fallback removed: send.broberg.ai reports no
    // policy while a receiver would find one. F005.15's defect, one record over.
    name: "the org-domain fallback is dropped (a domain that passes DMARC reports missing)",
    file: "verify",
    from: "  for (let i = 0; i <= labels.length - 2; i++) hosts.push(`_dmarc.${labels.slice(i).join('.')}`);",
    to: "  hosts.push(`_dmarc.${domain}`);",
    expect: ["falls back to the ORGANISATIONAL domain"],
  },
  {
    // The FIRST version of this function, restored. It jumped straight to the
    // last two labels, so `send.example.co.uk` never asked `_dmarc.example.co.uk`
    // and a UK customer with a correct policy was told to create it again.
    // Found reviewing this card's own code, not by a consumer.
    name: "back to the last-two-labels rule (a four-label name skips its real org domain)",
    file: "verify",
    from: "  for (let i = 0; i <= labels.length - 2; i++) hosts.push(`_dmarc.${labels.slice(i).join('.')}`);",
    to: "  hosts.push(`_dmarc.${domain}`); if (labels.length > 2) hosts.push(`_dmarc.${labels.slice(-2).join('.')}`);",
    expect: ["asks the real organisational domain under a multi-part suffix"],
  },
  {
    // The floor removed — the walk goes all the way to the bare TLD. A policy
    // published at `_dmarc.dk` would then be reported as every .dk domain's own:
    // a false `ok` on a security property, worse than the miss the walk fixes.
    name: "the two-label floor is dropped (a TLD's policy reads as ours)",
    file: "verify",
    from: "  for (let i = 0; i <= labels.length - 2; i++) hosts.push(`_dmarc.${labels.slice(i).join('.')}`);",
    to: "  for (let i = 0; i <= labels.length - 1; i++) hosts.push(`_dmarc.${labels.slice(i).join('.')}`);",
    expect: ["NEVER asks a bare TLD"],
  },
  {
    // The other direction: the policy location follows SPF/MX under send.
    name: "the DMARC lookup moves under the send subdomain (it is fixed by RFC, not by provider)",
    file: "verify",
    from: "  const hosts = [`_dmarc.${domain}`];",
    to: "  const hosts = [`_dmarc.send.${domain}`];",
    expect: ["the lookup is _dmarc.<domain>"],
  },
  {
    // F005.16 — the link check removed: a relative href goes back out to a
    // paying customer, where Outlook reads it as a file path.
    name: "the relative-link check is dropped (a /da/shop href reaches the customer)",
    file: "integrity",
    from: "      if (!href || SAFE_LINK.test(href)) continue;",
    to: "      continue;",
    expect: ["a relative href"],
  },
  {
    // THE ONE THAT MATTERS, and it is the opposite direction. sanne shipped a
    // guard that rewrote mailto: and tel: to `#`, breaking the two links a
    // customer needs most. Over-rejection is the failure mode here.
    name: "mailto: and tel: are no longer safe (the guard breaks the links that matter)",
    file: "integrity",
    from: "const SAFE_LINK = /^(?:https?:|mailto:|tel:|sms:|cid:|data:|#|\\/\\/)/i;",
    to: "const SAFE_LINK = /^(?:https?:|#)/i;",
    expect: ["mailto: passes untouched"],
  },
  {
    name: "the placeholder check is dropped (the subject arrives as {{subject}})",
    file: "integrity",
    from: "    for (const [where, body] of [",
    to: "    for (const [where, body] of [] as Array<['subject' | 'html' | 'text', string]>) if (false) for (const _ of [",
    expect: ["the customer received the SUBJECT LINE"],
  },
  {
    name: "a mistyped content-id is accepted (the identical broken square, unreported)",
    file: "integrity",
    from: "      if (ids.has(id)) continue;",
    to: "      if (ids.size > 0) continue;",
    expect: ["a MISTYPED content-id is caught"],
  },
  {
    // "could not look" collapsed into "found nothing" — this package's own
    // recurring defect, in the report that exists to prevent it.
    name: "a check that did not RUN is reported as clean",
    file: "integrity",
    from: '    skipped.push({ check: "links", reason: "no html body — there are no links to read" });',
    to: "    checked.push(\"links\");",
    expect: ["NOT PERFORMED"],
  },
  {
    // The `\s*` back. `\s` is a subset of `[^}]`, so the engine gets two ways
    // to split the same whitespace run and tries all of them when the closing
    // braces never come — 583 ms at 20k characters, quadratic from there. The
    // suite's assertion is a TIME, because the property is "it terminates";
    // this mutation is what proves that assertion can actually fail.
    name: "the redundant \\s* is back (an unclosed {{ hangs the send path)",
    file: "integrity",
    from: "const PLACEHOLDER = /\\{\\{[^}]*\\}\\}/g;",
    to: "const PLACEHOLDER = /\\{\\{\\s*[^}]*\\}\\}/g;",
    expect: ["answered immediately"],
  },
];

const backup = mkdtempSync(join(tmpdir(), "mailmut-"));
const originals = {};
for (const [name, file] of Object.entries(FILES)) {
  originals[name] = readFileSync(file, "utf8");
  copyFileSync(file, join(backup, `${name}.ts`));
}

// Built from a char code so no literal escape byte lives in this file.
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

let uncaught = 0;
const redSets = [];

// BEFORE the first mutation. Written after it, the marker would leave open the
// exact window it exists to close. The file named is the first of the several
// this harness rotates through; it is updated per mutation below.
writeMarker({ harness: "@broberg/mail test/mutations.mjs", file: Object.values(FILES)[0] });
try {
  for (const m of MUTATIONS) {
    const file = FILES[m.file];
    const original = originals[m.file];
    if (!original.includes(m.from)) {
      console.log(`ANCHOR MISSING - ${m.name}`);
      console.log("  the substitution matched nothing, so this mutation was never applied");
      uncaught++;
      continue;
    }
    const mutated = original.replace(m.from, m.to);
    if (mutated === original) {
      console.log(`ANCHOR NO-OP - ${m.name}`);
      uncaught++;
      continue;
    }

    // This harness rotates across several files, so the marker has to name the
    // one that is broken RIGHT NOW — a reader who opens it wants that file, not
    // the first one the run happened to touch.
    writeMarker({ harness: "@broberg/mail test/mutations.mjs", file });
    writeFileSync(file, mutated);
    let out = "";
    let died = false;
    try {
      execFileSync("pnpm", ["exec", "vitest", "run"], { cwd: PKG, stdio: "pipe" });
    } catch (e) {
      out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
      died = true;
    } finally {
      writeFileSync(file, original);
      // The guard. A restore that FAILED is otherwise indistinguishable from one
      // that was not needed — which is how buddy's harness lost a file on
      // 2026-08-14 with a green run to show for it. Does not return on mismatch.
      assertRestored({ harness: "@broberg/mail test/mutations.mjs", file, expected: original });
    }

    if (!died) {
      console.log(`UNCAUGHT - ${m.name}`);
      console.log("  the suite stayed GREEN with this mutation applied");
      uncaught++;
      continue;
    }

    const clean = out.replace(ANSI, "");
    const red = [
      ...new Set(
        clean
          .split("\n")
          .filter((l) => /^\s*(\u00d7|\u2715|FAIL)/.test(l))
          // STRIP THE DURATION. vitest appends "10ms" / "1ms" / "2s" to each
          // failing line, and the identical-red-set check below compares these
          // strings. With the timing left in, two mutations that redden exactly
          // the SAME tests still compare unequal whenever one run was a
          // millisecond slower — so the discrimination check passed by accident.
          // Measured 2026-09-10: this harness reported "0 identical red sets"
          // locally and "1" in CI, same 24 mutations, same red counts. The CI
          // answer was the true one. A check whose verdict depends on how fast
          // the machine is, is not a check.
          .map((l) => l.trim().replace(/\s+\d+(?:\.\d+)?m?s$/, "")),
      ),
    ];

    // "the suite died but I cannot see WHICH test" is a third state, and it must
    // not be reported as "the mutation survived". They are opposite facts.
    if (red.length === 0) {
      console.log(`UNREADABLE - ${m.name}`);
      console.log("  the suite FAILED (so the mutation WAS caught) but no failing test");
      console.log("  line could be parsed, so this harness cannot say which test caught");
      console.log("  it. That is a defect in the harness, not evidence about the code.");
      clean.split("\n").filter(Boolean).slice(-6).forEach((l) => console.log(`     ${l.trim()}`));
      uncaught++;
      redSets.push(`unreadable:${m.name}`);
      continue;
    }

    const hit = m.expect.every((e) => red.some((l) => l.includes(e)));
    redSets.push(red.join("|"));
    console.log(`  ${hit ? "caught   " : "WRONG RED"} ${m.name}  -> ${red.length} red`);
    red.slice(0, 3).forEach((l) => console.log(`               . ${l}`));
    if (!hit) {
      console.log(`     expected all of: ${m.expect.join(" . ")}`);
      uncaught++;
    }
  }
} finally {
  for (const [name, file] of Object.entries(FILES)) {
    copyFileSync(join(backup, `${name}.ts`), file);
    assertRestored({ harness: "@broberg/mail test/mutations.mjs", file, expected: originals[name] });
  }
  rmSync(backup, { recursive: true, force: true });
  clearMarker();
}

// NAME THE PAIR. "two mutations produced identical red sets" sends the reader to
// re-run 24 mutations by hand to find out which two; the harness already knows.
const collisions = [];
{
  const seen = new Map();
  redSets.forEach((sig, i) => {
    if (seen.has(sig)) collisions.push([MUTATIONS[seen.get(sig)].name, MUTATIONS[i].name, sig]);
    else seen.set(sig, i);
  });
}
const identical = collisions.length > 0;
if (identical) {
  console.log("\nIDENTICAL RED SETS - one test is carrying both mutations, so only one of them is proven:");
  for (const [a, b, sig] of collisions) {
    console.log(`  . ${a}`);
    console.log(`  . ${b}`);
    sig.split("|").forEach((l) => console.log(`      both reddened: ${l}`));
  }
}
console.log(
  `\n${identical || uncaught ? "FAIL" : "OK"} - ${MUTATIONS.length} mutations, ${uncaught} uncaught, ${identical ? 1 : 0} identical red sets.`,
)
process.exit(uncaught === 0 && !identical ? 0 : 1);
