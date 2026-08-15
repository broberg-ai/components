/**
 * @broberg/mail-identity — is this inbound mail provably from who the From:
 * field claims?
 *
 * Four pure functions, no I/O, no dependencies. They answer two questions and
 * refuse a third:
 *
 *   WHAT IS AN ADDRESS?          extractAddresses · splitPlusTag · addressesMatch
 *   WHAT DOES THE HEADER SAY?    readAuthResults
 *   WHAT DOES A MATCH MEAN?      NOT OURS. That is authorisation, and it stays
 *                                at the call-site where it can be read.
 *
 * The third line is the design. Moving an authorisation decision into a shared
 * dependency would build something worse than the drift it replaces: every
 * consumer inherits a policy it cannot see, and a change to that policy ships
 * silently as a patch release.
 *
 * ORIGIN: buddy and cardmem independently wrote this same rule, and BOTH had
 * holes in it, found the same day in each codebase separately. The value here is
 * not the code — it is the cases in test/, every one of them an attack that
 * WORKED against a live implementation. Each looks correct until someone builds
 * the counter-example.
 */

/**
 * What the Authentication-Results header says. FOUR outcomes, not three, and
 * not two.
 *
 *   pass         a dmarc verdict exists and everything present passed
 *   fail         at least one method's verdicts unambiguously did not pass
 *   conflicted   one method carries BOTH a passing and a failing verdict
 *   no-verdict   nothing readable to judge by
 *
 * `conflicted` exists because RFC 8601 Appendix B.6 — "Service Provided,
 * Multi-tiered Authentication Done", the standard's own example of NORMAL
 * OPERATION — is SYNTACTICALLY IDENTICAL to a duplicate-injection attack:
 *
 *     dkim=pass reason="good signature" header.i=@mail-router.example.net;
 *     dkim=fail reason="bad signature" header.i=@newyork.example.com
 *
 * Two signatures, one good, one bad, in one header. Nothing in the header
 * distinguishes that from an attacker appending `dkim=pass`. So this package
 * does not try: it REPORTS the disagreement and the caller decides. Fail-closed
 * is a perfectly good policy — it is just not ours to choose for everyone.
 *
 * `no-verdict` must NEVER collapse into `pass`, and the inversion is why it
 * matters more than it looks: a genuine SELF-SENT mail has no verdict at all
 * (the header is written by the RECEIVING server, and a mail from your own
 * authenticated session never crosses that boundary), while an external forgery
 * HAS one and it FAILS. A gate demanding `pass` rejects precisely the mail the
 * feature exists for.
 */
export type AuthVerdict = "pass" | "fail" | "conflicted" | "no-verdict";

/** The three methods that say something about the sending domain. */
export type AuthMethod = "spf" | "dkim" | "dmarc";

const METHODS: readonly AuthMethod[] = ["spf", "dkim", "dmarc"];

export interface AuthResults {
  verdict: AuthVerdict;
  /** Per-method result as read. `pass` only when every verdict for it passed. */
  spf?: string;
  dkim?: string;
  dmarc?: string;
  /** Methods carrying BOTH a passing and a failing verdict. Empty unless `conflicted`. */
  conflicted: readonly AuthMethod[];
  /** Always set, including on `pass` — a caller logging a decision needs the why. */
  reason: string;
}

/**
 * A view of `s` in which every quoted-string and every (nested) comment — and
 * their delimiters — is replaced by a SPACE, position for position.
 *
 * THIS IS THE WHOLE TRICK, and it is what a regex over the raw string cannot do.
 * Both grammars we parse (RFC 5322 address lists, RFC 8601 auth results) have
 * quoting, and in both a comment is defined to be whitespace. A regex has
 * neither notion, so it sees a legal separator wherever there is a space —
 * INCLUDING the spaces inside a quoted string. Measured against the prior
 * implementation, all three of these came from exactly that:
 *
 *   'Authentication-Results: …; dkim=pass reason="relayed dmarc=pass ok"'
 *      → no-verdict became PASS. Text inside a reason string became a verdict.
 *
 *   'Authentication-Results: …; dkim=pass (relayed dmarc=pass ok)'
 *      → same, via a comment.
 *
 *   'To: "x <buddy@broberg.ai>, y" <attacker@evil.dk>'
 *      → split-on-comma cut the quoted display name in half, and the half
 *        carried an <addr> that was only ever decoration. A display name
 *        contributed an address, which is the single property this package
 *        exists to guarantee it cannot.
 *
 * Replacing with a space rather than DELETING is deliberate: deletion joins the
 * neighbours, so `dmar(x)c=pass` would become the verdict `dmarc=pass` out of
 * text that is not one. A comment is whitespace; blanking says exactly that.
 *
 * Unterminated quotes and comments blank the remainder of the string, and are
 * reported as `malformed` so a caller of this helper can refuse to read a
 * PARTIAL result out of a header it could not finish parsing. That distinction
 * is not pedantry — the qualifier values in an auth header (`smtp.mailfrom=`,
 * `header.i=`) come from the message, so an unterminated delimiter there would
 * blank every verdict AFTER it while leaving the earlier ones standing. Erasing
 * a trailing `dmarc=fail` and keeping a leading `spf=pass` is a strictly useful
 * outcome for an attacker, so a header that does not parse yields nothing.
 */
function maskQuotedAndComments(s: string): { masked: string; malformed: boolean } {
  const out = s.split("");
  let quoted = false;
  let comment = 0;

  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;

    if ((quoted || comment > 0) && c === "\\" && i + 1 < s.length) {
      out[i] = " ";
      out[i + 1] = " ";
      i++;
      continue;
    }
    if (quoted) {
      out[i] = " ";
      if (c === '"') quoted = false;
      continue;
    }
    if (comment > 0) {
      if (c === "(") comment++;
      else if (c === ")") comment--;
      out[i] = " ";
      continue;
    }
    if (c === '"') {
      quoted = true;
      out[i] = " ";
      continue;
    }
    if (c === "(") {
      comment++;
      out[i] = " ";
      continue;
    }
  }

  return { masked: out.join(""), malformed: quoted || comment > 0 };
}

/** Lowercase + trim, or null when nothing is left. */
function normalise(s: string): string | null {
  const t = s.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/**
 * The address of ONE address-list entry, given the raw field and its mask.
 *
 * Angle brackets are located in the MASKED view, so a `<` inside a quoted
 * display name is simply not there to be found — but the address itself is
 * sliced from the RAW string, so a quoted local part (`<"odd name"@example.com>`)
 * survives intact.
 */
function addressOfPart(raw: string, masked: string, from: number, to: number): string | null {
  let open = -1;
  let close = -1;
  let depth = 0;

  for (let i = from; i < to; i++) {
    const c = masked[i]!;
    if (c === "<") {
      if (depth === 0) open = i;
      depth++;
    } else if (c === ">" && depth > 0) {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }

  if (open >= 0 && close > open) return normalise(raw.slice(open + 1, close));

  // An UNTERMINATED '<' is malformed. Hand back the part as it stands rather
  // than guessing which half was meant to be the address — something that
  // matches nothing beats something that might match the owner.
  if (open >= 0) return normalise(raw.slice(from, to));

  // No angle brackets: the address is the bare text, which is the MASKED text —
  // so a comment such as `cb@webhouse.dk (Christian)` contributes nothing.
  return normalise(masked.slice(from, to));
}

/**
 * Every address in a From/To/Cc field. A DISPLAY NAME NEVER CONTRIBUTES ONE.
 *
 *   'Christian Broberg <cb@webhouse.dk>'          → ['cb@webhouse.dk']
 *   'A <a@x.dk>, b@y.dk'                          → ['a@x.dk', 'b@y.dk']
 *   '"cb@webhouse.dk" <attacker@evil.dk>'         → ['attacker@evil.dk']
 *   '"x <buddy@broberg.ai>, y" <a@evil.dk>'       → ['a@evil.dk']
 *   '"Broberg, Christian" <cb@webhouse.dk>'       → ['cb@webhouse.dk']
 *
 * The first counter-example killed `from.includes(owner)`, which accepted the
 * owner's address written as DISPLAY TEXT — four call-paths reproduced it. The
 * second and third killed `field.split(',')`, which cuts a quoted display name
 * in half before quoting is understood. Both were live; neither was theoretical.
 *
 * Addresses are lowercased. Local parts are formally case-sensitive (RFC 5321),
 * but no provider we send through treats them that way, and NOT normalising
 * would mean `CB@webhouse.dk` fails an owner check that `cb@webhouse.dk` passes
 * — a comparison anyone can sidestep with the shift key.
 */
export function extractAddresses(field: string | null | undefined): string[] {
  if (!field) return [];
  // A malformed field is not rejected outright here: blanking already makes the
  // unparseable remainder match nothing, and an address list has no equivalent
  // of the partial-verdict problem — an address either equals a known one or it
  // does not.
  const { masked } = maskQuotedAndComments(field);

  const out: string[] = [];
  let start = 0;
  let angle = 0;

  const flush = (end: number): void => {
    const a = addressOfPart(field, masked, start, end);
    if (a) out.push(a);
    start = end + 1;
  };

  for (let i = 0; i < masked.length; i++) {
    const c = masked[i]!;
    if (c === "<") angle++;
    else if (c === ">" && angle > 0) angle--;
    else if (c === "," && angle === 0) flush(i);
  }
  flush(masked.length);

  return out;
}

/**
 * Split a plus-tag off an address.
 *
 *   'buddy+whop@broberg.ai'  →  { address: 'buddy@broberg.ai', tag: 'whop' }
 *   'buddy@broberg.ai'       →  { address: 'buddy@broberg.ai', tag: null }
 *
 * TWO RULES CARRY THE SECURITY, and they are the reason this is separate from
 * matching rather than folded into it:
 *
 * 1. THE TAG INFORMS, THE ADDRESS PROVES. An unknown tag must still match. A tag
 *    able to REFUSE a match would be authorisation disguised as routing, and a
 *    typo (`buddy+whopp@`) would make mail vanish silently. `+admin`, `+deploy`
 *    and `+urgent` must never mean anything privileged — anyone can type them.
 *
 * 2. SPLIT AFTER extractAddresses(), NEVER on a raw field. Do it the other way
 *    round and you are back in the impersonation hole wearing a new hat: a
 *    display name must not contribute an address, and that property lives in the
 *    extraction.
 *
 * An address with more than one '@' is malformed and is returned UNTOUCHED:
 * `buddy+x@evil.com@broberg.ai` must never be reshaped into something valid.
 *
 * `tag` is `null`, not `undefined`, so that a fixture written as
 * `{ address: 'x', tag: undefined }` cannot pass a deep-equality check against
 * `{ address: 'x' }`. Two different facts, two distinguishable values.
 */
export function splitPlusTag(address: string): { address: string; tag: string | null } {
  const at = address.indexOf("@");
  if (at < 0 || address.indexOf("@", at + 1) !== -1) return { address, tag: null };

  const plus = address.indexOf("+");
  if (plus < 0 || plus > at) return { address, tag: null };

  // From the FIRST '+': 'buddy+a+b@' has the tag 'a+b', not 'b'.
  const tag = address.slice(plus + 1, at);
  return { address: address.slice(0, plus) + address.slice(at), tag: tag || null };
}

/**
 * Does any address in `field` EQUAL any address in `known`?
 *
 * Equality on extracted addresses. Never a substring, never a prefix, never a
 * suffix — `cb@webhouse.dk.evil.com` and `"cb@webhouse.dk" <x@evil.dk>` and
 * `buddy@broberg.ai.evil.com` are all rejected, and each of the three was
 * accepted by a live implementation this week.
 *
 * Both sides go through the SAME extraction and the SAME plus-tag
 * normalisation, so `known` may be given as bare addresses or as full fields.
 * An empty or unparseable `field` matches nothing.
 */
export function addressesMatch(
  field: string | null | undefined,
  known: string | readonly string[],
): boolean {
  const present = new Set(extractAddresses(field).map((a) => splitPlusTag(a).address));
  if (present.size === 0) return false;

  const list = typeof known === "string" ? [known] : known;
  return list.some((k) =>
    extractAddresses(k).some((a) => present.has(splitPlusTag(a).address)),
  );
}

/**
 * Read an Authentication-Results header (RFC 8601). Reports; does not judge.
 *
 * ANCHORING IS AN ALLOWLIST, NOT A DENYLIST. `\b` was the original, and a dot is
 * a word boundary, so `\bdmarc=` matched INSIDE `header.dmarc=pass` — a
 * qualified key read as a verdict:
 *
 *   'header.dmarc=pass header.dkim=pass header.spf=pass; dmarc=fail; dkim=fail; spf=fail'
 *     → PASS, while every real verdict in it is `fail`.
 *
 * The first fix was a denylist, `(?<![\w.-])`. Swept over the whole printable
 * character set it left 27 characters open, including a colon — `arc:dmarc=pass`
 * read as a pass. A denylist has to predict every character a future vendor
 * invents. So: a verdict must stand at the start of the header or after a REAL
 * separator (whitespace, `;` or `,` — RFC 8601's own), and anything else in
 * front of it makes it a qualified key rather than a verdict.
 *
 * Quoted strings and comments are blanked before matching (see
 * maskQuotedAndComments) — they are two more places a verdict cannot stand, and
 * both manufactured verdicts in the prior implementation.
 *
 * ALL occurrences are collected, not the first: a header can carry more than one
 * verdict per method, and "first wins" lets an injected `dmarc=pass` drown out
 * the real `dmarc=fail`.
 *
 * PRECEDENCE IS SECURITY-BEARING. An unambiguous fail beats a conflict:
 *
 *   'dkim=pass; dkim=fail; dmarc=fail'  →  fail, NOT conflicted
 *
 * A method where NO verdict passed is stronger evidence than a disagreement
 * somewhere else. Get the order wrong and a genuine, unambiguous rejection is
 * downgraded to "cannot determine" — which a lenient caller then lets through.
 */
export function readAuthResults(header: string | null | undefined): AuthResults {
  if (!header || !header.trim()) {
    return {
      verdict: "no-verdict",
      conflicted: [],
      reason: "no Authentication-Results header — the sender is unproven, which is not the same as disproven",
    };
  }

  const { masked, malformed } = maskQuotedAndComments(header);
  if (malformed) {
    return {
      verdict: "no-verdict",
      conflicted: [],
      reason:
        "unterminated quoted string or comment — the header could not be parsed to the end, " +
        "and a verdict read out of the readable half would be a verdict an attacker chose the boundary of",
    };
  }

  const found: Partial<Record<AuthMethod, string>> = {};
  const conflicted: AuthMethod[] = [];

  for (const method of METHODS) {
    // The optional `/1` is RFC 8601's method-version, and the `\s*` around it
    // and around `=` is CFWS — comments are already spaces by now. Appendix B.7,
    // the RFC's own "perfectly legal" example, is written
    // `dkim (Because I like it) / 1 (One yay) = (wait for it) fail`, and a
    // parser too narrow to read it would report no-verdict on a header that
    // plainly says fail. Rejecting genuine mail is the equally expensive
    // opposite error.
    const re = new RegExp(`(?<=^|[\\s;,])${method}\\s*(?:/\\s*\\d+\\s*)?=\\s*([a-z]+)`, "gi");
    const verdicts = [...masked.matchAll(re)].map((m) => m[1]!.toLowerCase());
    if (verdicts.length === 0) continue;

    const passed = verdicts.filter((v) => v === "pass").length;
    // DISAGREEMENT and UNIFORMLY-NOT-PASSED are two different facts:
    //   dmarc=fail              a real, unambiguous rejection
    //   dkim=pass … dkim=fail   a disagreement (RFC B.6 legal, OR injected)
    // Collapsing both into `fail` hides the difference from the caller and puts
    // the policy here, where no consumer can change it. A REPEATED AGREEING
    // verdict is not a conflict — a relay may legitimately repeat itself, and
    // reading that as tampering blocks real mail.
    if (passed > 0 && passed < verdicts.length) conflicted.push(method);
    found[method] = passed === verdicts.length ? "pass" : verdicts.find((v) => v !== "pass")!;
  }

  if (Object.keys(found).length === 0) {
    return {
      verdict: "no-verdict",
      conflicted: [],
      reason: "Authentication-Results was present but carried no readable spf/dkim/dmarc verdict",
    };
  }

  const failed = METHODS.filter(
    (m) => found[m] !== undefined && found[m] !== "pass" && !conflicted.includes(m),
  );
  if (failed.length > 0) {
    return {
      verdict: "fail",
      ...found,
      conflicted,
      reason: `rejected: ${failed.map((m) => `${m}=${found[m]}`).join(", ")}`,
    };
  }

  if (conflicted.length > 0) {
    return {
      verdict: "conflicted",
      ...found,
      conflicted,
      reason:
        `contradictory verdicts for ${conflicted.join(", ")} — the header carries both a pass and a non-pass. ` +
        "This is legal multi-tiered authentication (RFC 8601 B.6) OR an injected verdict, and the header cannot tell you which. Your call.",
    };
  }

  // DMARC is the one that binds the From: field to what passed. Without it we
  // know SOMETHING authenticated, but not that the claimed sender is who did.
  if (found.dmarc === undefined) {
    return {
      verdict: "no-verdict",
      ...found,
      conflicted,
      reason: "no dmarc verdict — the From: field is not bound to whatever did pass",
    };
  }

  return { verdict: "pass", ...found, conflicted, reason: "spf/dkim/dmarc pass" };
}
