// @vitest-environment jsdom
// F001.19 — the neuron constellation: one loop at a time, colours from the
// palette, a still frame that survives resize and a hidden tab, nothing drawn
// on "plain". jsdom has no 2D context, so the canvas gets a recording fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountConstellation } from "../src/constellation";

type Op = { op: string; arg?: unknown };
function fakeCanvas() {
  const ops: Op[] = [];
  const ctx = {
    set fillStyle(v: string) { ops.push({ op: "fillStyle", arg: v }); },
    set strokeStyle(v: string) { ops.push({ op: "strokeStyle", arg: v }); },
    lineWidth: 0,
    clearRect: () => ops.push({ op: "clearRect" }),
    setTransform: () => {},
    beginPath: () => {},
    arc: () => ops.push({ op: "arc" }),
    fill: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
  };
  const canvas = document.createElement("canvas");
  canvas.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
  return { canvas, ops };
}

// A real-shaped rAF: cancel removes ONE id. (A cancel that empties the whole
// queue hid the bug this suite exists for — measured by the mutation harness.)
let rafQueue = new Map<number, FrameRequestCallback>();
let rafId = 0;
let reduced = false;
const flush = (n = 1) => { for (let i = 0; i < n; i++) { const q = [...rafQueue.values()]; rafQueue.clear(); q.forEach((cb) => cb(0)); } };
const setVisible = (v: boolean) => Object.defineProperty(document, "visibilityState", { value: v ? "visible" : "hidden", configurable: true });

beforeEach(() => {
  rafQueue = new Map();
  reduced = false;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { rafQueue.set(++rafId, cb); return rafId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { rafQueue.delete(id); });
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduce") ? reduced : false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
  setVisible(true);
  document.documentElement.removeAttribute("data-backdrop");
  document.documentElement.style.cssText = "";
  vi.spyOn(Math, "random").mockReturnValue(0.99); // every particle an accent, so colours are deterministic
});
afterEach(() => vi.restoreAllMocks());

describe("one loop at a time", () => {
  it("a second mount disposes the first; dispose stops the loop and marks nothing", () => {
    const a = fakeCanvas();
    const b = fakeCanvas();
    const offA = mountConstellation(a.canvas);
    const before = a.ops.length;
    mountConstellation(b.canvas)();
    flush(3);
    expect(a.ops.length).toBe(before); // a never painted again after b mounted
    offA(); // disposing an already-disposed runtime is a no-op
    expect(rafQueue.size).toBe(0);
  });

  it("marks the canvas so palettes.css can hide it", () => {
    const { canvas } = fakeCanvas();
    mountConstellation(canvas)();
    expect(canvas.hasAttribute("data-broberg-constellation")).toBe(true);
  });
});

describe("colours come from the palette", () => {
  it("reads --graph-* from <html>, falling back to cardmem's classic values", () => {
    const one = fakeCanvas();
    mountConstellation(one.canvas)();
    expect(one.ops.find((o) => o.op === "fillStyle")?.arg).toBe("#e8a87c");
    expect(String(one.ops.find((o) => o.op === "strokeStyle")?.arg)).toMatch(/^rgba\(232, 168, 124, /);

    document.documentElement.style.setProperty("--graph-accent", "#f3522c");
    document.documentElement.style.setProperty("--graph-accent-line", "243, 82, 44");
    const two = fakeCanvas();
    mountConstellation(two.canvas)();
    expect(two.ops.find((o) => o.op === "fillStyle")?.arg).toBe("#f3522c");
    expect(String(two.ops.find((o) => o.op === "strokeStyle")?.arg)).toMatch(/^rgba\(243, 82, 44, /);
  });
});

describe("reduced motion: a still frame that survives", () => {
  it("paints once and starts no loop", () => {
    reduced = true;
    const { canvas, ops } = fakeCanvas();
    const off = mountConstellation(canvas);
    expect(ops.filter((o) => o.op === "arc").length).toBeGreaterThan(0);
    expect(rafQueue.size).toBe(0);
    off();
  });

  it("a resize repaints the still frame (cardmem's copy goes blank here)", () => {
    reduced = true;
    const { canvas, ops } = fakeCanvas();
    const off = mountConstellation(canvas);
    ops.length = 0;
    window.dispatchEvent(new Event("resize"));
    expect(ops.filter((o) => o.op === "arc").length).toBeGreaterThan(0);
    off();
  });

  it("a tab hidden at mount paints when it becomes visible", () => {
    reduced = true;
    setVisible(false);
    const { canvas, ops } = fakeCanvas();
    const off = mountConstellation(canvas);
    expect(ops.filter((o) => o.op === "arc")).toEqual([]);
    setVisible(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ops.filter((o) => o.op === "arc").length).toBeGreaterThan(0);
    off();
  });
});

describe("animated", () => {
  it("loops while visible and does not paint while hidden", () => {
    const { canvas, ops } = fakeCanvas();
    const off = mountConstellation(canvas);
    expect(rafQueue.size).toBe(1);
    setVisible(false);
    ops.length = 0;
    flush(2);
    expect(ops).toEqual([]);
    expect(rafQueue.size).toBe(1); // still scheduled, just not drawing
    off();
  });
});

describe("backdrop = plain draws nothing", () => {
  it("clears and skips particles", () => {
    document.documentElement.setAttribute("data-backdrop", "plain");
    const { canvas, ops } = fakeCanvas();
    mountConstellation(canvas)();
    expect(ops.filter((o) => o.op === "arc")).toEqual([]);
    expect(ops.some((o) => o.op === "clearRect")).toBe(true);
  });
});
