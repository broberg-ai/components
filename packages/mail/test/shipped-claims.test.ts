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
