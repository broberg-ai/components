import { describe, it, expect } from "vitest";
import { SessionRegistry } from "../src/session-registry";

describe("SessionRegistry", () => {
  it("evicts sessions idle past the TTL", () => {
    let t = 1000;
    const evicted: string[] = [];
    const reg = new SessionRegistry<string>({
      ttlMs: 100,
      sweepIntervalMs: 0,
      now: () => t,
      onEvict: (id) => evicted.push(id),
    });
    reg.set("a", "A");
    expect(reg.size).toBe(1);

    t = 1150; // 150ms later — past the 100ms TTL
    expect(reg.sweep()).toEqual(["a"]);
    expect(reg.size).toBe(0);
    expect(evicted).toEqual(["a"]);
  });

  it("touch-on-get resets the idle clock (active sessions are not swept)", () => {
    let t = 0;
    const reg = new SessionRegistry<string>({ ttlMs: 100, sweepIntervalMs: 0, now: () => t });
    reg.set("a", "A");

    t = 80;
    expect(reg.get("a")).toBe("A"); // touch

    t = 150; // 70ms since the touch — still within TTL
    expect(reg.sweep()).toEqual([]);
    expect(reg.get("a")).toBe("A");
  });

  it("keeps fresh sessions while evicting only the stale ones", () => {
    let t = 0;
    const reg = new SessionRegistry<number>({ ttlMs: 50, sweepIntervalMs: 0, now: () => t });
    reg.set("old", 1);
    t = 40;
    reg.set("new", 2);
    t = 60; // old is 60ms idle (>50), new is 20ms idle (<50)
    expect(reg.sweep()).toEqual(["old"]);
    expect(reg.size).toBe(1);
    expect(reg.get("new")).toBe(2);
  });

  it("close() stops the timer and evicts everything", () => {
    const evicted: string[] = [];
    const reg = new SessionRegistry<string>({ sweepIntervalMs: 0, onEvict: (id) => evicted.push(id) });
    reg.set("a", "A");
    reg.set("b", "B");
    reg.close();
    expect(reg.size).toBe(0);
    expect(evicted.sort()).toEqual(["a", "b"]);
  });
});
