import { describe, it, expect, vi } from "vitest";
import { shouldExitForSubagent, guardSubagents } from "../src/guard";

describe("shouldExitForSubagent", () => {
  it("exits for a headless `claude … -p` parent", () => {
    expect(shouldExitForSubagent("claude -p 'do x'", 4242)).toBe(true);
    expect(shouldExitForSubagent("claude chat -p", 4242)).toBe(true);
  });

  it("exits for a forked session", () => {
    expect(shouldExitForSubagent("node foo.js --fork-session", 4242)).toBe(true);
  });

  it("exits when orphaned (ppid === 1)", () => {
    expect(shouldExitForSubagent("anything", 1)).toBe(true);
  });

  it("does NOT exit for a normal interactive parent", () => {
    expect(shouldExitForSubagent("claude", 4242)).toBe(false);
    expect(shouldExitForSubagent("/bin/zsh", 4242)).toBe(false);
    expect(shouldExitForSubagent("node server.js", 4242)).toBe(false);
  });
});

describe("guardSubagents", () => {
  it("reads ps and never throws (predicate decides exit)", () => {
    const onExit = vi.fn();
    expect(() => guardSubagents(onExit)).not.toThrow();
  });
});
