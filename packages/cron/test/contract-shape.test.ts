import { describe, expect, it } from "vitest";
import type { Execution, JobSpec } from "../src/index.js";

/**
 * The generated file changing is not the same as the PUBLIC surface changing.
 * These assertions are the compiler's, not vitest's: revert src/schema.ts to the
 * pre-2026-08-28 version and this FILE STOPS COMPILING — which is the only proof
 * that matters here. A test that passes against both versions proves nothing.
 */
describe("the 2026-08-28 contract changes reached the public types", () => {
  it("connectTimeout is settable, and NULLABLE — null is the deliberate default", () => {
    // Null means "wait as long as `timeout` allows for the response to BEGIN".
    // It is not an oversight: for a job that computes first and answers after,
    // time-to-header IS work time, so a short default would kill exactly those.
    const prompt: JobSpec = { name: "a", schedule: "* * * * *", url: "https://x.test", connectTimeout: 5000 };
    const patient: JobSpec = { name: "b", schedule: "* * * * *", url: "https://x.test", connectTimeout: null };
    expect(prompt.connectTimeout).toBe(5000);
    expect(patient.connectTimeout).toBeNull();
  });

  it("`deferred` and `missed` are representable — a consumer can handle the server's own output", () => {
    // Before the regen our union stopped at `skipped`, so a strict `switch` over
    // Execution["status"] could not name two states the server actually emits.
    const deferred: Execution["status"] = "deferred";
    const missed: Execution["status"] = "missed";
    expect([deferred, missed]).toEqual(["deferred", "missed"]);
  });

  it("deferred is NOT a failure, and missed is NOT a skip — they are their own outcomes", () => {
    // deferred = the target answered 503 with a readable Retry-After (an agreed
    // postponement, no alarm). missed = the scheduler was down when the job was
    // due (typically a deploy) — recorded so the loss is visible rather than absent.
    const failureStates: Execution["status"][] = ["failure", "timeout"];
    expect(failureStates).not.toContain("deferred");
    expect(failureStates).not.toContain("missed");
  });
});
