import { describe, expect, it } from "vitest";
import { readAuthResults } from "../src/index";

const v = (header: string): string => readAuthResults(header).verdict;

describe("a qualified key is not a verdict", () => {
  it("the exact string that returned PASS in two live implementations returns fail", () => {
    // `\b` was the anchor, and a DOT IS A WORD BOUNDARY, so `\bdmarc=` matched
    // inside `header.dmarc=pass`. Every real verdict here is fail; a forged mail
    // became a proven owner-mail in the one function written to prevent that.
    const header =
      "header.dmarc=pass header.dkim=pass header.spf=pass; dmarc=fail; dkim=fail; spf=fail";
    expect(v(header)).toBe("fail");
  });

  it("a vendor prefix joined by any non-separator is not a verdict either", () => {
    // The denylist `(?<![\w.-])` was the first fix and it did not hold: these
    // three were measured passing through it. A colon is ordinary header syntax.
    for (const sep of ["+", "/", ":"]) {
      expect(v(`arc${sep}dmarc=pass; dmarc=fail`)).toBe("fail");
    }
  });

  it("text inside a quoted reason string is not a verdict", () => {
    // Measured against the prior implementation: no-verdict became PASS. A
    // space inside a quoted string is a legal separator to a regex and no
    // separator at all to the grammar.
    expect(v('mx.google.com; spf=pass; dkim=pass reason="relayed dmarc=pass ok"')).toBe(
      "no-verdict",
    );
  });

  it("text inside an RFC comment is not a verdict", () => {
    expect(v("mx.google.com; spf=pass; dkim=pass (relayed dmarc=pass ok)")).toBe("no-verdict");
  });

  it("an injected pass cannot downgrade a real fail to a conflict", () => {
    expect(v('mx.google.com; dkim=pass reason="see dmarc=pass"; dmarc=fail')).toBe("fail");
  });

  it("…and the same headers WITHOUT the injection still read normally", () => {
    // The control. Without it, "always return no-verdict" satisfies this block.
    expect(v("mx.google.com; spf=pass; dkim=pass; dmarc=pass")).toBe("pass");
    expect(v("mx.google.com; spf=pass; dkim=pass; dmarc=fail")).toBe("fail");
  });
});

describe("the anchor is an ALLOWLIST, swept over the whole printable character set", () => {
  // A hand-written list of 9 characters found 3 of the 27 the denylist left
  // open. So the test does not use a list — it uses every character.
  const PRINTABLE = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i));
  const probe = (c: string): string => `dkim=pass; ${c}dmarc=pass; dmarc=fail`;

  it("exactly three characters let an injected verdict count, and they are RFC 8601's separators", () => {
    const opened = PRINTABLE.filter((c) => v(probe(c)) === "conflicted");
    expect(opened).toEqual([" ", ",", ";"]);
  });

  it("every other printable character leaves the real fail standing", () => {
    // '"' and '(' open a quoted string / comment that is never closed, so the
    // header does not parse to the end and yields nothing at all — see the
    // malformed block below. That is the conservative answer, not an opening.
    const separators = new Set([" ", ",", ";"]);
    const unparseable = new Set(['"', "("]);
    for (const c of PRINTABLE) {
      if (separators.has(c) || unparseable.has(c)) continue;
      expect(v(probe(c)), `character ${JSON.stringify(c)}`).toBe("fail");
    }
    for (const c of unparseable) expect(v(probe(c))).toBe("no-verdict");
  });

  it("THE SWEEP CAN FAIL — the old denylist anchor opens far more than three", () => {
    // Without this, the two tests above are a green check nobody has ever seen
    // go red. This re-implements the anchor that shipped as the FIRST fix and
    // runs the same sweep over it, so the instrument is demonstrated rather than
    // trusted. A denylist has to predict every character a vendor invents;
    // an allowlist only has to know its own separators.
    const denylistOpens = PRINTABLE.filter((c) =>
      new RegExp(`(?<![\\w.-])dmarc=pass`).test(probe(c)),
    );
    expect(denylistOpens.length).toBeGreaterThan(3);
    expect(denylistOpens).toContain(":");
  });
});

describe("FOUR outcomes — the package reports, it does not decide", () => {
  it("disagreeing verdicts for one method are 'conflicted', not 'fail' and not 'pass'", () => {
    const r = readAuthResults("mx.google.com; dmarc=pass; dkim=pass; spf=pass; dmarc=fail");
    expect(r.verdict).toBe("conflicted");
    expect(r.conflicted).toEqual(["dmarc"]);
  });

  it("RFC 8601 B.6 verbatim is 'conflicted' — the standard's OWN example of normal operation", () => {
    // "Service Provided, Multi-tiered Authentication Done". Two signatures, one
    // good one bad, in one header. SYNTACTICALLY IDENTICAL to duplicate
    // injection and not distinguishable from it by reading the header — which
    // is exactly why a shared package must not pick a side. Fail-closed
    // condemns this legal case; that is a defensible consumer policy and an
    // indefensible library default.
    const b6 =
      "example.com;\n" +
      '      dkim=pass reason="good signature"\n' +
      "        header.i=@mail-router.example.net;\n" +
      '      dkim=fail reason="bad signature"\n' +
      "        header.i=@newyork.example.com";
    const r = readAuthResults(b6);
    expect(r.verdict).toBe("conflicted");
    expect(r.conflicted).toEqual(["dkim"]);
  });

  it("EVERY verdict is read, not just the first — the per-method result reflects the fail", () => {
    // The duplicate-injection attack in its original form: an injected
    // `dmarc=pass` placed AHEAD of the real `dmarc=fail`. "First wins" answers
    // pass here, and that is the whole hole.
    //
    // Deliberately separated from the outcome assertion below. Both "first
    // wins" and "collapse conflicted into fail" produce the wrong OUTCOME on
    // this header, so an outcome-only test cannot tell those two defects apart
    // — and a suite that cannot tell two defects apart sends the next reader to
    // the wrong line. Measured: with this split, the two reverts redden
    // different sets; without it, identical ones.
    expect(readAuthResults("mx.google.com; dmarc=pass; dmarc=fail").dmarc).toBe("fail");
  });

  it("a REPEATED AGREEING verdict is NOT a conflict — a relay may legitimately repeat itself", () => {
    // Reading repetition as tampering blocks real mail. Asserted right next to
    // the conflict case so the two cannot be confused.
    expect(v("mx.google.com; dmarc=pass; dkim=pass; spf=pass; dmarc=pass")).toBe("pass");
    expect(v("mx.google.com; dmarc=fail; dmarc=fail")).toBe("fail");
  });

  it("PRECEDENCE: an unambiguous fail beats a conflict", () => {
    // A method where NO verdict passed is stronger evidence than a disagreement
    // elsewhere. Get this backwards and a genuine rejection is downgraded to
    // "cannot determine", which a lenient consumer then lets through.
    const r = readAuthResults("dkim=pass; dkim=fail; dmarc=fail");
    expect(r.verdict).toBe("fail");
    expect(r.conflicted).toEqual(["dkim"]);
  });
});

describe("a missing verdict is not a pass, and not a fail either", () => {
  it("no header at all is 'no-verdict'", () => {
    for (const h of ["", "   ", null, undefined]) {
      expect(readAuthResults(h).verdict).toBe("no-verdict");
    }
  });

  it("a header with no spf/dkim/dmarc in it is 'no-verdict'", () => {
    expect(v("example.org 1; none")).toBe("no-verdict");
  });

  it("no dmarc verdict is 'no-verdict' even when everything present passed", () => {
    // dmarc is the only method that binds the From: field to what passed.
    // Without it we know something authenticated, not that the claimed sender is
    // who did.
    expect(v("mx.google.com; spf=pass smtp.mailfrom=x.dk; dkim=pass header.i=@x.dk")).toBe(
      "no-verdict",
    );
  });

  it("THE INVERSION: genuine self-sent mail has NO verdict, an external forgery HAS one and it fails", () => {
    // Measured on production mail. The Authentication-Results header is written
    // by the RECEIVING server, and a mail from the owner's own authenticated
    // session never crosses that boundary — so it carries nothing. A forged
    // From: from outside DOES cross it, and webhouse.dk runs dmarc
    // p=quarantine, so it gets a verdict and the verdict fails.
    //
    // A gate demanding 'pass' therefore rejects precisely the mail the feature
    // exists for, while letting nothing extra in. This assertion is the reason
    // 'no-verdict' may never be collapsed into either neighbour.
    const selfSent = readAuthResults(null);
    const forged = readAuthResults(
      "mx.google.com; spf=fail smtp.mailfrom=evil.dk; dkim=fail; dmarc=fail header.from=webhouse.dk",
    );
    expect(selfSent.verdict).toBe("no-verdict");
    expect(forged.verdict).toBe("fail");
    expect(selfSent.verdict).not.toBe(forged.verdict);
  });
});

describe("folded, cramped and comment-heavy headers are GENUINE mail", () => {
  // Rejecting real mail is the equally expensive opposite error, and an
  // allowlist is exactly the kind of fix that overshoots into it.

  it("a folded header (newline + tab continuation) reads normally", () => {
    const folded =
      "mx.google.com;\n\tdkim=pass header.i=@webhouse.dk;\n\tspf=pass smtp.mailfrom=webhouse.dk;\n\tdmarc=pass header.from=webhouse.dk";
    expect(v(folded)).toBe("pass");
  });

  it("no space after ';' reads normally", () => {
    expect(v("mx.google.com;dkim=pass;spf=pass;dmarc=pass")).toBe("pass");
  });

  it("CRLF folding reads normally", () => {
    expect(v("mx.google.com;\r\n dkim=pass;\r\n spf=pass;\r\n dmarc=pass")).toBe("pass");
  });

  it("comments between the verdicts read normally", () => {
    expect(v("mx.google.com; dkim=pass (good signature); spf=pass; dmarc=pass (aligned)")).toBe(
      "pass",
    );
  });

  it("a real Gmail header, full of dots, reads normally", () => {
    const gmail =
      "mx.google.com;\n" +
      "       dkim=pass header.i=@webhouse.dk header.s=google header.b=AbCdEf;\n" +
      "       spf=pass (google.com: domain of cb@webhouse.dk designates 209.85.220.41 as permitted sender) smtp.mailfrom=cb@webhouse.dk;\n" +
      "       dmarc=pass (p=QUARANTINE sp=QUARANTINE dis=NONE) header.from=webhouse.dk";
    expect(v(gmail)).toBe("pass");
  });

  it("the method-version form `dkim/1=pass` reads normally", () => {
    expect(v("mx.google.com; dkim/1=pass; spf/1=pass; dmarc/1=pass")).toBe("pass");
  });
});

describe("a header that does not parse to the end yields nothing", () => {
  it("an unterminated quoted string is 'no-verdict', not a partial read", () => {
    // The qualifier values in an auth header come from the message, so an
    // unterminated delimiter blanks every verdict AFTER it while leaving the
    // earlier ones standing. Erasing a trailing `dmarc=fail` and keeping a
    // leading `spf=pass` is strictly useful to an attacker, so a header that
    // cannot be finished yields nothing at all.
    const r = readAuthResults('mx.google.com; spf=pass smtp.mailfrom="oops; dmarc=fail');
    expect(r.verdict).toBe("no-verdict");
    expect(r.spf).toBeUndefined();
    expect(r.reason).toContain("unterminated");
  });

  it("an unterminated comment is 'no-verdict' too", () => {
    expect(v("mx.google.com; spf=pass (oops; dmarc=fail")).toBe("no-verdict");
  });

  it("a stray ')' with no comment open is just a character, not a parse failure", () => {
    expect(v("mx.google.com; spf=pass) ; dkim=pass; dmarc=pass")).toBe("pass");
  });

  it("nested comments close correctly", () => {
    expect(v("mx.google.com; dkim=pass (outer (inner) still outer); spf=pass; dmarc=pass")).toBe(
      "pass",
    );
  });

  it("an escaped quote inside a quoted string does not end it", () => {
    expect(v('mx.google.com; dkim=pass reason="he said \\"hi\\" ok"; spf=pass; dmarc=pass')).toBe(
      "pass",
    );
  });
});
