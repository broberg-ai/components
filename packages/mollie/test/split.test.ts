import { describe, expect, it } from "vitest";
import { computeSplit, SplitError } from "../src/index";

const sum = (l: { amount: number }[]) => l.reduce((s, x) => s + x.amount, 0);

describe("computeSplit — who gets what", () => {
  it("30/70 of 100 kr, platform keeps the rest", () => {
    expect(computeSplit(10_000, { rules: [{ recipient: "platform", percent: 30 }, { recipient: "dev", percent: 70 }], remainderTo: "platform" }))
      .toEqual([{ recipient: "platform", amount: 3_000 }, { recipient: "dev", amount: 7_000 }]);
  });
  it("an odd amount: 9999 øre at 30/70 — rounding crumbs go to the platform, nothing lost", () => {
    const l = computeSplit(9_999, { rules: [{ recipient: "platform", percent: 30 }, { recipient: "dev", percent: 70 }], remainderTo: "platform" });
    expect(l).toEqual([{ recipient: "platform", amount: 3_000 }, { recipient: "dev", amount: 6_999 }]);
    expect(sum(l)).toBe(9_999);
  });
  it("three ways with a fixed surcharge off the top: 25 kr drift to platform, rest 30/60/10 platform/dev/clinic", () => {
    const l = computeSplit(19_900, {
      rules: [{ recipient: "platform", fixed: 2_500 }, { recipient: "platform", percent: 30 }, { recipient: "dev", percent: 60 }, { recipient: "clinic", percent: 10 }],
      remainderTo: "platform",
    });
    // base 17 400 → 5 220 / 10 440 / 1 740
    expect(l).toEqual([{ recipient: "platform", amount: 2_500 + 5_220 }, { recipient: "dev", amount: 10_440 }, { recipient: "clinic", amount: 1_740 }]);
    expect(sum(l)).toBe(19_900);
  });
  it("a share is rounded DOWN, never up: 5 øre at 50/50 dev/clinic → 2 + 2, the crumb to the platform", () => {
    expect(computeSplit(5, { rules: [{ recipient: "dev", percent: 50 }, { recipient: "clinic", percent: 50 }], remainderTo: "platform" }))
      .toEqual([{ recipient: "dev", amount: 2 }, { recipient: "clinic", amount: 2 }, { recipient: "platform", amount: 1 }]);
  });
  it("percents under 100: the unallocated part goes to remainderTo", () => {
    expect(computeSplit(1_000, { rules: [{ recipient: "dev", percent: 70 }], remainderTo: "platform" }))
      .toEqual([{ recipient: "dev", amount: 700 }, { recipient: "platform", amount: 300 }]);
  });
  it("0 % and 100 %", () => {
    expect(computeSplit(500, { rules: [{ recipient: "dev", percent: 100 }, { recipient: "clinic", percent: 0 }], remainderTo: "platform" }))
      .toEqual([{ recipient: "dev", amount: 500 }]);
  });
  it("decimal percents (2 decimals) are exact: 33.33 % ×3 of 1 kr", () => {
    const l = computeSplit(100, { rules: [{ recipient: "a", percent: 33.33 }, { recipient: "b", percent: 33.33 }, { recipient: "c", percent: 33.33 }], remainderTo: "a" });
    expect(l).toEqual([{ recipient: "a", amount: 34 }, { recipient: "b", amount: 33 }, { recipient: "c", amount: 33 }]);
  });
  it("many recipients always sum to the payment (property over 2000 random cases)", () => {
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    for (let k = 0; k < 2000; k++) {
      const amount = 1 + rnd(1_000_000);
      const rules = Array.from({ length: 1 + rnd(8) }, (_, i) => ({ recipient: `r${i}`, percent: rnd(13) }));
      expect(sum(computeSplit(amount, { rules, remainderTo: "platform" }))).toBe(amount);
    }
  });
});

describe("computeSplit — invalid rules are refused before anything is paid", () => {
  const bad = (amount: number, cfg: Parameters<typeof computeSplit>[1], msg: RegExp) =>
    expect(() => computeSplit(amount, cfg)).toThrow(msg);
  it("percents over 100", () => bad(100, { rules: [{ recipient: "a", percent: 60 }, { recipient: "b", percent: 41 }], remainderTo: "a" }, /more than 100/));
  it("fixed amounts over the payment", () => bad(100, { rules: [{ recipient: "a", fixed: 101 }], remainderTo: "a" }, /exceed the payment/));
  it("negative numbers", () => {
    bad(100, { rules: [{ recipient: "a", fixed: -1 }], remainderTo: "a" }, /fixed must be/);
    bad(100, { rules: [{ recipient: "a", percent: -5 }], remainderTo: "a" }, /percent must be/);
  });
  it("unknown recipient when a list is given", () => bad(100, { rules: [{ recipient: "devv", percent: 70 }], remainderTo: "platform", knownRecipients: ["platform", "dev"] }, /unknown recipient "devv"/));
  it("no remainder recipient", () => bad(100, { rules: [], remainderTo: "" }, /remainderTo is required/));
  it("both or neither of percent/fixed", () => {
    bad(100, { rules: [{ recipient: "a", percent: 1, fixed: 1 }], remainderTo: "a" }, /exactly one/);
    bad(100, { rules: [{ recipient: "a" }], remainderTo: "a" }, /exactly one/);
  });
  it("more than 2 decimals, non-whole and non-positive amounts", () => {
    bad(100, { rules: [{ recipient: "a", percent: 33.333 }], remainderTo: "a" }, /at most 2 decimals/);
    bad(10.5, { rules: [], remainderTo: "a" }, /positive whole/);
    bad(0, { rules: [], remainderTo: "a" }, /positive whole/);
  });
  it("errors are SplitError", () => expect(() => computeSplit(0, { rules: [], remainderTo: "a" })).toThrow(SplitError));
});
