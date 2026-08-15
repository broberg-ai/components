import { describe, expect, it } from "vitest";
import { addressesMatch, readAuthResults, type AuthVerdict } from "../src/index";

/**
 * THE MOST IMPORTANT FILE HERE, AND IT TESTS CODE THE PACKAGE DOES NOT SHIP.
 *
 * `readAuthResults` returning 'conflicted' proves nothing about what a consumer
 * DOES with it. The guard belongs on the DECISION, not on the reader — so the
 * README's consumer snippet lives here as executable code, and the two failure
 * modes below are measured against it rather than described in prose.
 *
 * The trap, hit live by the first consumer while adding the very outcome they
 * had argued for: `conflicted` fell into the `no-verdict` branch, because that
 * branch was `default`. And the no-verdict branch ACCEPTS the owner's own
 * address (a genuine self-sent mail carries no verdict). So an injected verdict
 * would have become the owner's instruction — the previous day's hole, reopened
 * by their own cleanup, and invisible to every test of the reader.
 */

type Decision = "accept-owner" | "accept-external" | "reject";

/** The snippet from the README, verbatim. Yours will differ; the SHAPE must not. */
function decide(verdict: AuthVerdict, fromOwner: boolean): Decision {
  switch (verdict) {
    case "pass":
      return fromOwner ? "accept-owner" : "accept-external";

    // Permissive, and deliberately so: genuine self-sent mail carries no
    // verdict. This is the branch a new outcome must never fall into.
    case "no-verdict":
      return fromOwner ? "accept-owner" : "reject";

    case "fail":
      return "reject";

    // One explicit line, in the CONSUMER, where a reader can find it and change
    // it. Not buried in the parser where no consumer can reach it.
    case "conflicted":
      return "reject";

    default: {
      // Compile-time: a fifth outcome added to AuthVerdict fails to assign to
      // `never`, so the gate cannot widen in silence.
      const unhandled: never = verdict;
      void unhandled;
      // Runtime: `never` protects only consumers that compile. The input is an
      // untrusted header and a JavaScript consumer has no types at all, so the
      // fall-through must return the REJECTING answer.
      return "reject";
    }
  }
}

describe("the permissive outcome must never be the default branch", () => {
  it("conflicted from the OWNER'S OWN address is rejected", () => {
    // The exact trap. `conflicted` and `no-verdict` both mean "not proven", so
    // a tidy-minded refactor merges them — and the merged branch accepts the
    // owner. Injected verdict, owner's instruction.
    const proof = readAuthResults("mx.google.com; dmarc=pass; dkim=pass; spf=pass; dmarc=fail");
    const fromOwner = addressesMatch("Christian <cb@webhouse.dk>", "cb@webhouse.dk");

    expect(proof.verdict).toBe("conflicted");
    expect(fromOwner).toBe(true);
    expect(decide(proof.verdict, fromOwner)).toBe("reject");
  });

  it("…and the branch it must not land in really is accepting, which is why it matters", () => {
    // Without this assertion the test above is satisfied by a consumer that
    // rejects everything, and the hazard it documents would be invisible.
    expect(decide("no-verdict", true)).toBe("accept-owner");
  });

  it("RUNTIME: an outcome that never passed a type-checker still cannot open the gate", () => {
    // A JavaScript consumer has no `never` to protect it, and the input is an
    // untrusted header. A package defending itself with types alone defends only
    // half of its consumers.
    const smuggled = "totally-new-outcome" as AuthVerdict;
    expect(decide(smuggled, true)).toBe("reject");
    expect(decide(smuggled, false)).toBe("reject");
  });

  it("the accepting paths still accept — otherwise `return 'reject'` passes this whole file", () => {
    expect(decide("pass", true)).toBe("accept-owner");
    expect(decide("pass", false)).toBe("accept-external");
    expect(decide("no-verdict", false)).toBe("reject");
    expect(decide("fail", true)).toBe("reject");
  });
});

describe("the two proofs are independent, and neither substitutes for the other", () => {
  it("a perfect auth verdict from the wrong address is not the owner", () => {
    // evil.dk passes its OWN spf/dkim/dmarc — an attacker does not need to break
    // authentication, only to own a domain that authenticates correctly. This is
    // why the address equality carries as much weight as the header.
    const proof = readAuthResults(
      "mx.google.com; spf=pass smtp.mailfrom=evil.dk; dkim=pass header.i=@evil.dk; dmarc=pass header.from=evil.dk",
    );
    const fromOwner = addressesMatch('"cb@webhouse.dk" <attacker@evil.dk>', "cb@webhouse.dk");

    expect(proof.verdict).toBe("pass");
    expect(fromOwner).toBe(false);
    expect(decide(proof.verdict, fromOwner)).toBe("accept-external");
  });

  it("the owner's address with a failing verdict is not the owner either", () => {
    const proof = readAuthResults("mx.google.com; spf=fail; dkim=fail; dmarc=fail");
    expect(decide(proof.verdict, addressesMatch("cb@webhouse.dk", "cb@webhouse.dk"))).toBe("reject");
  });
});
