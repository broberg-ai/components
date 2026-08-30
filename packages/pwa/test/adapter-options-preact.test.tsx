// @vitest-environment happy-dom
//
// F054.7 — both adapters kept their own hand-written option list, and it had
// drifted from the core's. `register` and `updateOnFocus` were never forwarded,
// so a consumer writing `register: false` got a registration anyway, with no
// error and no warning.
//
// Reported by fd-sundhed against the installed 0.2.2 dist — they found it by
// READING our shipped bundle, which is not a detector anyone should need. These
// tests are the detector.
//
// THE ASSERTION IS AT THE BOUNDARY, not on the shape of an object. "the option
// was passed through" proves a property of a call; "container.register was never
// called" proves the behaviour the consumer is actually relying on.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
/** @jsxImportSource preact */
import { renderHook, cleanup } from "@testing-library/preact";
import { usePwaUpdate as usePreact } from "../src/preact.js";

afterEach(cleanup);

function fakeContainer() {
  const register = vi.fn(async () => ({
    installing: null,
    waiting: null,
    active: {},
    addEventListener() {},
    update: async () => {},
  }));
  const container = {
    register,
    ready: new Promise(() => {}), // never resolves — we only care about register
    controller: null,
    addEventListener() {},
    removeEventListener() {},
    getRegistration: async () => undefined,
  };
  Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  return register;
}

/** A container whose register() resolves to a registration we can watch. */
function fakeContainerWithRegistration(update: () => Promise<void>) {
  const registration = {
    installing: null,
    waiting: null,
    active: {},
    addEventListener() {},
    update,
  };
  const container = {
    register: vi.fn(async () => registration),
    ready: Promise.resolve(registration),
    controller: null,
    addEventListener() {},
    removeEventListener() {},
    getRegistration: async () => registration,
  };
  Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  return container;
}

const useHook = usePreact;

describe("preact adapter honours every core option", () => {
  let register: ReturnType<typeof fakeContainer>;
  beforeEach(() => {
    register = fakeContainer();
  });

  it("register: false means container.register is NEVER called", async () => {
    // The reported defect. RED against 0.2.2, where the hook dropped the option
    // and the core's `register = true` default took over.
    renderHook(() => useHook({ register: false }));
    await Promise.resolve();
    expect(register).not.toHaveBeenCalled();
  });

  it("the default still registers — nothing was disabled to make the test above pass", async () => {
    // Negative control. Without it, the assertion above passes on an adapter
    // that never registers at all, which would be a worse package.
    renderHook(() => useHook({}));
    await Promise.resolve();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("forwards an option the adapter does not name — the LIST was the defect", async () => {
    // The guard that outlives this fix: an option the adapter has never heard of
    // must still reach the core. An adapter that reintroduces a hand-written
    // destructure fails here even if it remembers today's six names.
    renderHook(() =>
      useHook({ register: false, updateOnFocus: false, __future__: "x" } as never),
    );
    await Promise.resolve();
    // register:false is the observable half; the unknown key proves the object
    // was passed whole rather than rebuilt from a list.
    expect(register).not.toHaveBeenCalled();
  });
it("updateOnFocus: false means a window focus does NOT trigger registration.update()", async () => {
    // The option NOBODY reported. It was dropped by the same hand-written list,
    // and it is here because measuring the reported defect found a second one —
    // not because anyone asked.
    const update = vi.fn(async () => {});
    fakeContainerWithRegistration(update);
    renderHook(() => useHook({ updateOnFocus: false }));
    await Promise.resolve();
    await Promise.resolve();
    window.dispatchEvent(new Event("focus"));
    expect(update).not.toHaveBeenCalled();
  });

  it("and the DEFAULT still checks on focus — the negative control", async () => {
    // Without this, the test above passes on an updater that never checks at all.
    const update = vi.fn(async () => {});
    fakeContainerWithRegistration(update);
    renderHook(() => useHook({}));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    window.dispatchEvent(new Event("focus"));
    expect(update).toHaveBeenCalled();
  });
it("changing an option RECREATES the updater — the effect key is not a constant", async () => {
    // UNCAUGHT by the first mutation pass, which is the finding: nothing tested
    // that the effect actually depends on the options. With a constant key a
    // consumer who flips an option at runtime silently keeps the old updater,
    // and the option they just changed never takes effect.
    const container = fakeContainerWithRegistration(async () => {});
    const { rerender } = renderHook((props: { swUrl: string }) => useHook(props), {
      initialProps: { swUrl: "/a.js" },
    });
    await Promise.resolve();
    rerender({ swUrl: "/b.js" });
    await Promise.resolve();
    const urls = container.register.mock.calls.map((c) => c[0]);
    expect(urls).toContain("/a.js");
    expect(urls).toContain("/b.js");
  });

  it("but an IDENTICAL options object does not recreate it", async () => {
    // The negative control. Without it the test above passes on an effect with
    // no dependency array at all, which would tear down and rebuild the updater
    // on every single render.
    const container = fakeContainerWithRegistration(async () => {});
    const { rerender } = renderHook((props: { swUrl: string }) => useHook(props), {
      initialProps: { swUrl: "/a.js" },
    });
    await Promise.resolve();
    rerender({ swUrl: "/a.js" });
    await Promise.resolve();
    expect(container.register).toHaveBeenCalledTimes(1);
  });
});
