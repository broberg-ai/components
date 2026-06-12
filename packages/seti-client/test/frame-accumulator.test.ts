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

  // F078 — the duplication bug from Christian's screenshot: cc updates a line
  // IN PLACE mid-screen (timer counts up), exact-match overlap fails, the
  // whole block got re-appended.
  it("merges when a volatile timer line changed in place (and refreshes it)", () => {
    const hist = ["result line", "✻ Worked for 8s", "more output"];
    const body = ["result line", "✻ Worked for 9s", "more output", "new line"];
    expect(mergeOverlap(hist, body)).toEqual([
      "result line",
      "✻ Worked for 9s",
      "more output",
      "new line",
    ]);
  });

  it("treats rotating spinner glyphs as the same line", () => {
    const hist = ["a", "✶ Thinking… (3s)"];
    const body = ["✻ Thinking… (4s)", "b"];
    expect(mergeOverlap(hist, body)).toEqual(["a", "✻ Thinking… (4s)", "b"]);
  });

  it("does not append a duplicate block when the body is contained in history (redraw/reconnect)", () => {
    const hist = ["intro", "result A", "result B", "✻ Worked for 8s"];
    const body = ["result A", "result B", "✻ Worked for 9s"];
    expect(mergeOverlap(hist, body)).toEqual([
      "intro",
      "result A",
      "result B",
      "✻ Worked for 9s",
    ]);
  });

  it("still appends genuinely new content that shares no overlap", () => {
    expect(mergeOverlap(["a", "b"], ["x", "y", "z"])).toEqual(["a", "b", "x", "y", "z"]);
  });

  it("does not dedupe distinct lines that differ beyond digits", () => {
    const hist = ["count: 3 files changed"];
    const body = ["count: 7 lines removed"];
    expect(mergeOverlap(hist, body)).toEqual(["count: 3 files changed", "count: 7 lines removed"]);
  });

  // F079/0.1.2 — Christian's 18× re-append: trailing volatile lines (spinner
  // gerund rotates word-for-word, "⎿ Tip:" text changes) break BOTH the suffix
  // overlap and the strict containment, so the whole window re-appended. The
  // anchor fallback aligns on the stable top line and refreshes in place.
  it("anchor-merges when trailing volatile lines break the overlap seam", () => {
    const hist = ["⏺ Bash(ls)", "result", "✢ Skedaddling… (1m 24s)", "⎿ Tip: alpha"];
    const body = ["⏺ Bash(ls)", "result", "✢ Noodling… (1m 26s)", "⎿ Tip: beta"];
    expect(mergeOverlap(hist, body)).toEqual([
      "⏺ Bash(ls)",
      "result",
      "✢ Noodling… (1m 26s)",
      "⎿ Tip: beta",
    ]);
  });

  it("anchor fallback retains earlier history and appends genuinely new lines", () => {
    const hist = ["old A", "old B", "⏺ Bash(ls)", "r1", "✢ Spin… (1s)"];
    const body = ["⏺ Bash(ls)", "r1", "r2", "✢ Spin… (2s)"]; // r2 is new
    expect(mergeOverlap(hist, body)).toEqual([
      "old A",
      "old B",
      "⏺ Bash(ls)",
      "r1",
      "r2",
      "✢ Spin… (2s)",
    ]);
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
