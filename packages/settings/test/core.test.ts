// F017.1 — the dirty-bus lifecycle, generateSecret and copyToClipboard, in plain
// Node (no DOM): the core must load and work without a browser.
import { afterEach, describe, expect, test, vi } from "vitest";
import { copyToClipboard, createDirtyBus, generateSecret, markDirty, markSaved, onDirtyBus, requestSave, settingsBus } from "../src/core";

describe("F017.1 — the dirty-bus lifecycle", () => {
  test("markDirty → onDirty; requestSave → onSave; markSaved → onSaved and clean again", async () => {
    const bus = createDirtyBus();
    const seen: string[] = [];
    bus.onDirtyBus({ onDirty: () => seen.push("dirty"), onSave: () => void seen.push("save"), onSaved: () => seen.push("saved") });
    bus.markDirty();
    expect(bus.getState().dirty).toBe(true);
    await bus.requestSave();
    expect([seen, bus.getState()]).toEqual([["dirty", "save", "saved"], { dirty: false, saving: false, error: undefined }]);
  });

  test("markSaved on its own fires onSaved and resets dirty to false", () => {
    const bus = createDirtyBus();
    const onSaved = vi.fn();
    bus.onDirtyBus({ onSaved });
    bus.markDirty();
    bus.markSaved();
    expect([onSaved.mock.calls.length, bus.getState().dirty]).toEqual([1, false]);
  });

  test("the unsubscribe function stops every later event", async () => {
    const bus = createDirtyBus();
    const onDirty = vi.fn();
    const onSave = vi.fn();
    const off = bus.onDirtyBus({ onDirty, onSave });
    bus.markDirty();
    off();
    bus.markDirty();
    await bus.requestSave();
    expect([onDirty.mock.calls.length, onSave.mock.calls.length]).toEqual([1, 0]);
  });

  test("requestSave waits for EVERY panel before saying saved", async () => {
    const bus = createDirtyBus();
    let releaseSlow!: () => void;
    const order: string[] = [];
    bus.onDirtyBus({ onSave: () => void order.push("fast") });
    bus.onDirtyBus({ onSave: () => new Promise<void>((r) => (releaseSlow = () => { order.push("slow"); r(); })) });
    bus.onDirtyBus({ onSaved: () => order.push("saved") });
    bus.markDirty();
    const done = bus.requestSave();
    await Promise.resolve();
    expect([bus.getState().saving, bus.getState().dirty, order]).toEqual([true, true, ["fast"]]);
    releaseSlow();
    expect(await done).toBe(true);
    expect(order).toEqual(["fast", "slow", "saved"]);
  });

  test("a failing panel keeps the form DIRTY and reports the error — never a false 'saved'", async () => {
    const bus = createDirtyBus();
    const onSaved = vi.fn();
    const onSaveFailed = vi.fn();
    bus.onDirtyBus({ onSave: () => undefined });
    bus.onDirtyBus({ onSave: async () => { throw new Error("db down"); }, onSaved, onSaveFailed });
    bus.markDirty();
    expect(await bus.requestSave()).toBe(false);
    const s = bus.getState();
    expect([s.dirty, s.saving, (s.error as Error).message, onSaved.mock.calls.length, (onSaveFailed.mock.calls[0]![0] as Error).message]).toEqual([true, false, "db down", 0, "db down"]);
  });

  test("a second requestSave while one is running does not run the panels twice", async () => {
    const bus = createDirtyBus();
    let release!: () => void;
    const onSave = vi.fn(() => new Promise<void>((r) => (release = r)));
    bus.onDirtyBus({ onSave });
    const first = bus.requestSave();
    expect(await bus.requestSave()).toBe(false);
    release();
    await first;
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("an edit made WHILE saving keeps the form unsaved after the save finishes", async () => {
    // The save wrote what the panels had when Save was pressed; a keystroke after
    // that is not in it, and calling the form clean would hide it.
    const bus = createDirtyBus();
    let release!: () => void;
    bus.onDirtyBus({ onSave: () => new Promise<void>((r) => (release = r)) });
    bus.markDirty();
    const done = bus.requestSave();
    bus.markDirty();
    release();
    expect(await done).toBe(true);
    expect([bus.getState().dirty, bus.getState().saving]).toEqual([true, false]);
  });

  test("the module-level functions drive the shared settingsBus", async () => {
    const seen: string[] = [];
    const off = onDirtyBus({ onDirty: () => seen.push("dirty"), onSaved: () => seen.push("saved") });
    markDirty();
    expect(settingsBus.getState().dirty).toBe(true);
    await requestSave();
    markSaved();
    off();
    expect(seen).toEqual(["dirty", "saved", "saved"]);
  });
});

describe("F017.1 — generateSecret", () => {
  test("32 bytes → 64 lowercase hex characters; 16 → 32", () => {
    expect([/^[0-9a-f]{64}$/.test(generateSecret()), /^[0-9a-f]{32}$/.test(generateSecret(16))]).toEqual([true, true]);
  });

  test("a different value every call (no fixed seed)", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateSecret()));
    expect(seen.size).toBe(50);
  });
});

describe("F017.1 — copyToClipboard", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  afterEach(() => {
    vi.useRealTimers();
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });
  const setNavigator = (value: unknown) => Object.defineProperty(globalThis, "navigator", { value, configurable: true });

  test("resolves true on success and calls onReset after 1500 ms (fake timers)", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    setNavigator({ clipboard: { writeText } });
    const onReset = vi.fn();
    expect(await copyToClipboard("abc", { onReset })).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
    vi.advanceTimersByTime(1499);
    expect(onReset).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("resolves false — not a throw — without a Clipboard API", async () => {
    setNavigator({});
    const onReset = vi.fn();
    expect(await copyToClipboard("abc", { onReset })).toBe(false);
    expect(onReset).not.toHaveBeenCalled();
  });

  test("resolves false when the browser refuses (permission, insecure origin)", async () => {
    setNavigator({ clipboard: { writeText: async () => { throw new Error("NotAllowedError"); } } });
    expect(await copyToClipboard("abc")).toBe(false);
  });
});
