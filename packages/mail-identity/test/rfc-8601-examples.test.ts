import { describe, expect, it } from "vitest";
import { readAuthResults, type AuthVerdict } from "../src/index";

/**
 * Every Authentication-Results value printed in RFC 8601, copied verbatim from
 * the text at rfc-editor.org rather than recalled. Ten header values across the
 * seven sections that show one (Appendix B.2–B.7, plus §2.7.6).
 *
 * They are here for two different jobs, and the second is the surprising one:
 *
 *   1. THE SYNTAX. Folding, comments in absurd places, methods we do not read,
 *      a version on the method name, the multi-tier case. This is the best
 *      corpus in existence for the PARSER.
 *
 *   2. A CONTROL ON A CLAIM. `dmarc=` appears ZERO times in RFC 8601 — the
 *      three occurrences of "DMARC" are all bibliography. So if a verdict of
 *      `pass` requires dmarc (and it must — dmarc is the only method that binds
 *      the From: field to what passed), then EVERY RFC example yields
 *      no-verdict, fail or conflicted, and NONE yields pass.
 *
 * That is why "build the accept side from the RFC" does not work, and the test
 * below turns that sentence into a number that breaks if anyone adds a fixture
 * believing otherwise. The accept path can only ever be proven on real traffic.
 */
const RFC_HEADERS: ReadonlyArray<{ section: string; header: string; verdict: AuthVerdict }> = [
  {
    section: "B.2",
    header: "example.org 1; none",
    verdict: "no-verdict", // a conforming MTA that did no authentication at all
  },
  {
    section: "B.3",
    header: "example.com;\n          spf=pass smtp.mailfrom=example.net",
    verdict: "no-verdict", // spf passed; nothing binds it to the From: field
  },
  {
    section: "B.4",
    header:
      "example.com;\n" +
      "          auth=pass (cram-md5) smtp.auth=sender@example.net;\n" +
      "          spf=pass smtp.mailfrom=example.net",
    verdict: "no-verdict",
  },
  {
    section: "B.4",
    header: "example.com; iprev=pass\n          policy.iprev=192.0.2.200",
    verdict: "no-verdict", // iprev is not one of the three we read
  },
  {
    section: "B.5",
    header: "example.com;\n          dkim=pass (good signature) header.d=example.com",
    verdict: "no-verdict",
  },
  {
    section: "B.5",
    header:
      "example.com;\n" +
      "          auth=pass (cram-md5) smtp.auth=sender@example.com;\n" +
      "          spf=fail smtp.mailfrom=example.com",
    verdict: "fail", // an unambiguous spf failure, printed by the standard itself
  },
  {
    section: "B.6",
    header:
      "example.com;\n" +
      '      dkim=pass reason="good signature"\n' +
      "        header.i=@mail-router.example.net;\n" +
      '      dkim=fail reason="bad signature"\n' +
      "        header.i=@newyork.example.com",
    verdict: "conflicted", // the whole reason the fourth outcome exists
  },
  {
    section: "B.6",
    header: "example.net;\n      dkim=pass (good signature) header.i=@newyork.example.com",
    verdict: "no-verdict",
  },
  {
    section: "B.7",
    header:
      "foo.example.net (foobar) 1 (baz);\n" +
      "    dkim (Because I like it) / 1 (One yay) = (wait for it) fail\n" +
      "      policy (A dot can go here) . (like that) expired\n" +
      "      (this surprised me) = (as I wasn't expecting it) 1362471462",
    verdict: "fail", // "a very comment-heavy but perfectly legal example"
  },
  {
    section: "2.7.6",
    header: "example.com;\n          foo=pass bar.baz=blob (2 of 3 tests OK)",
    verdict: "no-verdict", // an invented method, and a comment carrying the detail
  },
];

describe("RFC 8601's own examples", () => {
  it.each(RFC_HEADERS)("$section reads as $verdict", ({ header, verdict }) => {
    expect(readAuthResults(header).verdict).toBe(verdict);
  });

  it("B.7 — the standard's comment torture case is READ, not written off", () => {
    // `dkim (Because I like it) / 1 (One yay) = (wait for it) fail` is
    // `dkim/1=fail` with comments wedged into every legal gap. A parser too
    // narrow to read it reports no-verdict on a header that plainly says fail —
    // and no-verdict is the permissive branch in at least one consumer, so
    // being too strict here is not the safe direction.
    const b7 = RFC_HEADERS.find((h) => h.section === "B.7")!;
    expect(readAuthResults(b7.header).dkim).toBe("fail");
  });

  it("THE CONTROL: not one RFC example carries a dmarc verdict, so none can prove the accept path", () => {
    // A number, not a sentence. Add a fixture that does carry one and this goes
    // red, which is the point — the claim stops being something to trust.
    expect(new Set(RFC_HEADERS.map((h) => h.section)).size).toBe(7);
    for (const { section, header } of RFC_HEADERS) {
      expect(header, `${section} raw text`).not.toContain("dmarc=");
      expect(readAuthResults(header).dmarc, `${section} parsed`).toBeUndefined();
    }
    expect(RFC_HEADERS.some((h) => readAuthResults(h.header).verdict === "pass")).toBe(false);
  });

  it("two Authentication-Results headers joined naively become a conflict — read the topmost only", () => {
    // B.5 carries two, written by two different MTAs: one says dkim=pass, the
    // other spf=fail. A consumer that concatenates every instance of the header
    // is asking two machines one question and getting the disagreement it asked
    // for. This is a CONSUMER hazard, so it is asserted rather than defended
    // against — the package cannot know which header its caller trusts.
    const [first, second] = [RFC_HEADERS[4]!.header, RFC_HEADERS[5]!.header];
    expect(readAuthResults(first).verdict).toBe("no-verdict");
    expect(readAuthResults(`${first}; ${second}`).verdict).toBe("fail");
  });
});
