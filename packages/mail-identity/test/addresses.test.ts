import { describe, expect, it } from "vitest";
import { addressesMatch, extractAddresses, splitPlusTag } from "../src/index";

const OWNER = "cb@webhouse.dk";

describe("a display name can NEVER contribute an address", () => {
  // The property this package exists for. Every test below is an input that a
  // live implementation accepted as the owner this week.

  it("the owner's address written as DISPLAY TEXT yields only the real sender", () => {
    // `from.includes(owner)` accepted this. Four call-paths reproduced it.
    const field = 'cb@webhouse.dk <attacker@evil.dk>';
    expect(extractAddresses(field)).toEqual(["attacker@evil.dk"]);
    expect(addressesMatch(field, OWNER)).toBe(false);
  });

  it("…and quoted, which is the form a real mail client would produce", () => {
    const field = '"cb@webhouse.dk" <attacker@evil.dk>';
    expect(extractAddresses(field)).toEqual(["attacker@evil.dk"]);
    expect(addressesMatch(field, OWNER)).toBe(false);
  });

  it("A QUOTED COMMA does not cut the field — the angle-addr inside stays decoration", () => {
    // Measured against the prior implementation on 2026-08-16: it split on ','
    // BEFORE understanding quotes, so the quoted display name was cut in half
    // and the half carried an <addr>. It returned
    //   ['buddy@broberg.ai', 'attacker@evil.dk']
    // and end-to-end that produced isOwnerInstruction: TRUE for a mail from
    // attacker@evil.dk addressed to victim@evil.dk. Same property as the two
    // tests above, a different route in — which is why the route is not the
    // thing to test, the property is.
    const field = '"x <buddy@broberg.ai>, y" <attacker@evil.dk>';
    expect(extractAddresses(field)).toEqual(["attacker@evil.dk"]);
    expect(addressesMatch(field, "buddy@broberg.ai")).toBe(false);
  });

  it("a comma in a quoted display name is not a separator (the benign half of the same bug)", () => {
    // 'Broberg, Christian' is how a directory writes a name. The prior split
    // returned ['"broberg', 'cb@webhouse.dk'] — a junk entry alongside the real
    // one. Not exploitable, but extractAddresses(x)[0] is then not the sender.
    const field = '"Broberg, Christian" <cb@webhouse.dk>';
    expect(extractAddresses(field)).toEqual(["cb@webhouse.dk"]);
    expect(addressesMatch(field, OWNER)).toBe(true);
  });

  it("a domain SUFFIX is not a match, with or without angle brackets", () => {
    expect(addressesMatch("Christian <cb@webhouse.dk.evil.com>", OWNER)).toBe(false);
    expect(addressesMatch("cb@webhouse.dk.evil.com", OWNER)).toBe(false);
    expect(addressesMatch("buddy@broberg.ai.evil.com", "buddy@broberg.ai")).toBe(false);
  });

  it("does NOT reject the genuine article — without this, `return []` passes everything above", () => {
    // The negative control. Four of the five tests in this block are satisfied
    // by an implementation that never finds an address at all.
    expect(extractAddresses("Christian Broberg <cb@webhouse.dk>")).toEqual([OWNER]);
    expect(addressesMatch("Christian Broberg <cb@webhouse.dk>", OWNER)).toBe(true);
    expect(addressesMatch(OWNER, OWNER)).toBe(true);
  });
});

describe("address lists, comments and malformed input", () => {
  it("splits a real list and keeps every address", () => {
    expect(extractAddresses("A <a@x.dk>, b@y.dk, C <c@z.dk>")).toEqual([
      "a@x.dk",
      "b@y.dk",
      "c@z.dk",
    ]);
  });

  it("an RFC comment contributes nothing", () => {
    expect(extractAddresses("cb@webhouse.dk (Christian)")).toEqual([OWNER]);
    expect(extractAddresses("(a comment) <cb@webhouse.dk>")).toEqual([OWNER]);
  });

  it("normalises case, because a comparison anyone can sidestep with the shift key is not one", () => {
    expect(addressesMatch("CB@Webhouse.DK", OWNER)).toBe(true);
  });

  it("an empty, absent or address-free field matches nothing", () => {
    for (const field of ["", "   ", null, undefined, '"just a display name"', "<>"]) {
      expect(extractAddresses(field)).toEqual([]);
      expect(addressesMatch(field, OWNER)).toBe(false);
    }
  });

  it("an unterminated quote yields nothing rather than a guess", () => {
    // Fail-closed: the remainder is unparseable, so it matches nothing. The
    // alternative — guessing which half was the address — is how a display name
    // becomes an address.
    expect(addressesMatch('"unterminated <cb@webhouse.dk>', OWNER)).toBe(false);
  });

  it("an unterminated angle bracket cannot be reshaped into a match", () => {
    expect(addressesMatch("Christian <cb@webhouse.dk", OWNER)).toBe(false);
  });

  it("a quoted local part survives inside angle brackets", () => {
    // The mask blanks quotes to find the brackets, but the address is sliced
    // from the RAW field, so the local part is not destroyed.
    expect(extractAddresses('<"odd name"@example.com>')).toEqual(['"odd name"@example.com']);
  });
});

describe("splitPlusTag — the tag informs, the address proves", () => {
  it("splits a tag off", () => {
    expect(splitPlusTag("buddy+whop@broberg.ai")).toEqual({
      address: "buddy@broberg.ai",
      tag: "whop",
    });
  });

  it("returns tag null (never undefined) when there is no tag", () => {
    // `null`, so a fixture written { address, tag: undefined } cannot deep-equal
    // { address } and quietly assert nothing.
    expect(splitPlusTag("buddy@broberg.ai")).toEqual({ address: "buddy@broberg.ai", tag: null });
  });

  it("a '+' in the DOMAIN is not a tag", () => {
    expect(splitPlusTag("buddy@bro+berg.ai")).toEqual({ address: "buddy@bro+berg.ai", tag: null });
  });

  it("takes the FIRST '+': 'a+b+c@' tags 'b+c', not 'c'", () => {
    expect(splitPlusTag("a+b+c@x.dk")).toEqual({ address: "a@x.dk", tag: "b+c" });
  });

  it("a second '@' means malformed — returned untouched, never reshaped into something valid", () => {
    expect(splitPlusTag("buddy+x@evil.com@broberg.ai")).toEqual({
      address: "buddy+x@evil.com@broberg.ai",
      tag: null,
    });
  });

  it("an UNKNOWN tag still matches — a tag that could refuse would be authorisation in disguise", () => {
    // A typo (`buddy+whopp@`) must not make mail vanish. That failure class cost
    // two days elsewhere; the tag routes, it does not authorise.
    expect(addressesMatch("buddy+whopp@broberg.ai", "buddy@broberg.ai")).toBe(true);
    expect(addressesMatch("buddy+admin@broberg.ai", "buddy@broberg.ai")).toBe(true);
  });

  it("normalises the tag on BOTH sides of a match", () => {
    expect(addressesMatch("buddy+a@broberg.ai", "buddy+b@broberg.ai")).toBe(true);
  });
});

describe("addressesMatch takes a list, and To+Cc go through the same equality", () => {
  it("matches against any of several known addresses", () => {
    expect(addressesMatch("x@y.dk", [OWNER, "christian@broberg.dk", "x@y.dk"])).toBe(true);
    expect(addressesMatch("z@y.dk", [OWNER, "christian@broberg.dk"])).toBe(false);
  });

  it("accepts a known address given as a full field, not just a bare address", () => {
    expect(addressesMatch("cb@webhouse.dk", "Christian <cb@webhouse.dk>")).toBe(true);
  });

  it("widening WHERE you look must not widen WHAT counts", () => {
    // The To+Cc concatenation a consumer performs. A suffix on Cc is rejected
    // exactly as it is on To.
    const buddy = "buddy@broberg.ai";
    expect(addressesMatch("someone@x.dk,buddy@broberg.ai", buddy)).toBe(true);
    expect(addressesMatch("someone@x.dk,buddy@broberg.ai.evil.com", buddy)).toBe(false);
    expect(addressesMatch('someone@x.dk,"buddy@broberg.ai" <x@evil.dk>', buddy)).toBe(false);
  });
});
