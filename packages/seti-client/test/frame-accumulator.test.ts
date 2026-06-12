import { describe, expect, it } from "vitest";
import { FrameAccumulator, mergeOverlap, splitFooter } from "../src/frame-accumulator";

const PROMPT = "❯ ";
const RULE = "─".repeat(40);

describe("splitFooter", () => {
  it("splits at the prompt line and keeps the rule above it", () => {
    const lines = ["dialogue 1", "dialogue 2", RULE, PROMPT, "statusline"];
    const { body, footer } = splitFooter(lines);
    expect(body).toEqual(["dialogue 1", "dialogue 2"]);
    expect(footer).toEqual([RULE, PROMPT, "statusline"]);
  });

  it("includes a spinner line above the footer", () => {
    const lines = ["dialogue", "✻ Thinking…", RULE, PROMPT];
    const { body, footer } = splitFooter(lines);
    expect(body).toEqual(["dialogue"]);
    expect(footer[0]).toBe("✻ Thinking…");
  });

  it("falls back to the last 3 lines when no prompt is found", () => {
    const lines = ["a", "b", "c", "d", "e"];
    const { body, footer } = splitFooter(lines);
    expect(body).toEqual(["a", "b"]);
    expect(footer).toEqual(["c", "d", "e"]);
  });
});

describe("mergeOverlap", () => {
  it("merges on the largest overlap", () => {
    expect(mergeOverlap(["a", "b", "c"], ["b", "c", "d"])).toEqual(["a", "b", "c", "d"]);
  });

  it("concatenates when there is no overlap", () => {
    expect(mergeOverlap(["a"], ["x", "y"])).toEqual(["a", "x", "y"]);
  });

  it("is idempotent for an identical repeated frame", () => {
    const hist = ["a", "b", "c"];
    expect(mergeOverlap(hist, ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});

describe("FrameAccumulator", () => {
  const frame = (dialogue: string[]) => [...dialogue, RULE, PROMPT, "status"].join("\n");

  it("accumulates dialogue that scrolls off the top", () => {
    const acc = new FrameAccumulator();
    acc.feed(frame(["line 1", "line 2", "line 3"]));
    // window scrolled: line 1 gone, new line 4 visible
    const view = acc.feed(frame(["line 2", "line 3", "line 4"]));
    expect(view.history).toEqual(["line 1", "line 2", "line 3", "line 4"]);
    expect(view.footer[1]).toBe(PROMPT);
  });

  it("does not duplicate on identical frames (spinner-only changes)", () => {
    const acc = new FrameAccumulator();
    acc.feed(frame(["x", "y"]));
    const view = acc.feed(frame(["x", "y"]));
    expect(view.history).toEqual(["x", "y"]);
  });

  it("caps history at maxHistory", () => {
    const acc = new FrameAccumulator(5);
    acc.feed(frame(["1", "2", "3", "4", "5", "6", "7"]));
    expect(acc.view.history.length).toBeLessThanOrEqual(5);
  });

  it("reset clears state", () => {
    const acc = new FrameAccumulator();
    acc.feed(frame(["a"]));
    acc.reset();
    expect(acc.view).toEqual({ history: [], footer: [] });
    expect(acc.text).toBe("");
  });
});
