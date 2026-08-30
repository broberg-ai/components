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
import { renderHook, cleanup } from "@testing-library/react";
import { usePwaUpdate as useReact } from "../src/react.js";

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

// Preact has its own file: the two runtimes need their own renderHook, and a
// shared table silently ran the preact hook through React's renderer.
const useHook = useReact;

describe("react adapter honours every core option", () => {
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
});
