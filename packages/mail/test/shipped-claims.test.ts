import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// THE FALSE CLAIM SHIPPED IN THE .d.ts, which is where fd-sundhed read it —
// they quoted `events-*.d.ts:34` verbatim, not the README. A sentence in a
// tooltip is what a consumer acts on at the call site, so that is the artifact
// worth asserting on.
//
// What was wrong (0.8.0–0.8.1):
//   suppressed → failed     "it was never attempted"
// Measured false against production: a mail to two recipients, one suppressed,
// reports `suppressed` while the other recipient RECEIVES it. `last_event` is a
// MESSAGE status, not a RECIPIENT status.
//
// This does not test Resend. It tests that the correction cannot quietly revert
// — which is the failure this package has now had twice, in two packages.

const DIST = join(__dirname, "..", "dist");

const distText = () => {
  const files = readdirSync(DIST).filter((f) => f.endsWith(".d.ts") || f.endsWith(".d.cts"));
  return files.map((f) => readFileSync(join(DIST, f), "utf8")).join("\n");
};

describe("the published type declarations", () => {
  // A missing dist is NOT a skip. "Could not look" and "looked and it was fine"
  // must never produce the same green.
  it("are built — this suite cannot run against a missing artifact", () => {
    expect(
      existsSync(DIST),
      "dist/ is missing, so the shipped tooltips were not checked.\n" +
        "Build first:  pnpm --filter @broberg/mail build",
    ).toBe(true);
  });

  it("no longer claim a suppressed mail was never attempted", () => {
    expect(distText()).not.toMatch(/never attempted/i);
  });

  it("say that last_event is a message status, not a recipient status", () => {
    // The positive half: removing the false sentence is not enough if nothing
    // replaces it. A consumer with multi-recipient mail needs to be told.
    expect(distText()).toMatch(/MESSAGE status, NOT A RECIPIENT status/i);
  });
});

// THE README SHIPS TOO — it is in the tarball and it is the page npm renders,
// so a claim there reaches more people than the tooltip does. The first version
// of this file checked only dist/*.d.ts, which is a check NARROWER than the
// claim it was defending: the corrected README still carried the old sentence
// (inside the correction that explains it is false) and this suite went green.
//
// SO THE README IS ASSERTED POSITIVELY, NOT BY ABSENCE. An absence check cannot
// tell a claim from a MENTION of the claim — measured three times in the fleet in
// one day: twice on me (secret-scan's "global regex", then this file), once on
// fd-sundhed, whose source-reading guard was reddened by the comment explaining
// why the guard exists. Quoting the old wording inside a correction is normal and
// good writing; a guard that forbids it is wrong about writing, not about code.
describe("the published README", () => {
  const README = join(__dirname, "..", "README.md");

  it("exists — a missing README is not a pass", () => {
    expect(existsSync(README)).toBe(true);
  });

  it("states the correct semantics where a consumer will read them", () => {
    const rm = readFileSync(README, "utf8");
    // What must be TRUE, in the section a reader lands on:
    expect(rm).toMatch(/MESSAGE status, not a RECIPIENT status/i);
    expect(rm).toMatch(/at least one recipient was skipped/i);
    // and the evidence, so the claim can be checked rather than trusted
    expect(rm).toContain("37a5ac15-d91c-49ac-a37e-d8a991096631");
    // and the honest limit on it
    expect(rm).toMatch(/Resend does not document this behaviour/i);
  });

  it("names the breaking type change 0.8.0 made in a minor", () => {
    expect(readFileSync(README, "utf8")).toContain('Pick<Mailer, "send">');
  });
});
