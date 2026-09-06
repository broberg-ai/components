import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPwaUpdater } from "../src/index.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeWorker extends EventTarget {
  state: string;
  postMessage = vi.fn();
  constructor(state = "installing") {
    super();
    this.state = state;
  }
  /** The registration this worker belongs to, so `installed` can move it to `waiting`. */
  registration: FakeRegistration | null = null;
  setState(state: string) {
    this.state = state;
    // THE SPEC, WHICH THE OLD FAKE DID NOT MODEL: a worker that finishes
    // installing while another is ACTIVE becomes `registration.waiting`. With
    // nothing active it activates directly and never waits. The old fake left
    // `.waiting` null forever, so a test of the updatefound path asserted
    // against a state a browser cannot produce — and that is exactly the state
    // the old implementation read from.
    if (state === "installed" && this.registration) {
      if (this.registration.active) this.registration.waiting = this;
      else this.registration.active = this;
      this.registration.installing = null;
    }
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  active: FakeWorker | null = null;
  update = vi.fn(() => Promise.resolve());
}

class FakeContainer extends EventTarget {
  controller: unknown = null;
  registration = new FakeRegistration();
  register = vi.fn(() => Promise.resolve(this.registration));
  get ready() {
    return Promise.resolve(this.registration);
  }
}

let container: FakeContainer;
let reload: ReturnType<typeof vi.fn>;
let fakeWindow: EventTarget;
let fakeDocument: EventTarget & { visibilityState: string };

beforeEach(() => {
  container = new FakeContainer();
  reload = vi.fn();
  fakeWindow = new EventTarget();
  fakeDocument = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("navigator", { serviceWorker: container });
  vi.stubGlobal("location", { reload });
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createPwaUpdater", () => {
  it("flags updateReady when a worker is already waiting at registration", async () => {
    container.registration.waiting = new FakeWorker("installed");
    const updater = createPwaUpdater();
    await flush();
    expect(updater.getState().updateReady).toBe(true);
  });

  it("flags updateReady on updatefound→installed while a worker is already active", async () => {
    container.controller = {}; // an active controller = this is an update
    container.registration.active = new FakeWorker("activated");
    const updater = createPwaUpdater();
    await flush();
    const seen: boolean[] = [];
    updater.subscribe((s) => seen.push(s.updateReady));
    const worker = new FakeWorker("installing");
    worker.registration = container.registration;
    container.registration.installing = worker;
    container.registration.dispatchEvent(new Event("updatefound"));
    worker.setState("installed");
    expect(updater.getState().updateReady).toBe(true);
    expect(seen).toContain(true);
  });

  it("suppresses the FIRST install — nothing is active, so the worker never waits", async () => {
    container.controller = null;
    container.registration.active = null; // first install: nothing to wait behind
    const updater = createPwaUpdater();
    await flush();
    const worker = new FakeWorker("installing");
    worker.registration = container.registration;
    container.registration.installing = worker;
    container.registration.dispatchEvent(new Event("updatefound"));
    worker.setState("installed");
    expect(updater.getState().updateReady).toBe(false);
  });

  it("applyUpdate posts SKIP_WAITING to the waiting worker", async () => {
    const worker = new FakeWorker("installed");
    container.registration.waiting = worker;
    const updater = createPwaUpdater();
    await flush();
    updater.applyUpdate();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("reloads once on controllerchange that replaces an existing controller, guarding against a reload-loop", async () => {
    container.controller = {}; // an existing controller → a controllerchange is a real takeover
    const updater = createPwaUpdater();
    await flush();
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
    updater.destroy();
  });

  it("does NOT reload on the first-install controllerchange (clientsClaim, no prior controller)", async () => {
    container.controller = null; // first install: the page was never controlled
    const updater = createPwaUpdater();
    await flush();
    container.dispatchEvent(new Event("controllerchange")); // the first claim — not an update
    expect(reload).not.toHaveBeenCalled();
    // a LATER controllerchange (a real worker takeover) still reloads
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
    updater.destroy();
  });

  it("does not reload when reloadOnControllerChange is false", async () => {
    createPwaUpdater({ reloadOnControllerChange: false });
    await flush();
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
  });

  it("checks for an update on window focus and on visibilitychange when visible", async () => {
    const updater = createPwaUpdater();
    await flush();
    fakeWindow.dispatchEvent(new Event("focus"));
    expect(container.registration.update).toHaveBeenCalledTimes(1);
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    expect(container.registration.update).toHaveBeenCalledTimes(2);
    fakeDocument.visibilityState = "hidden";
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    expect(container.registration.update).toHaveBeenCalledTimes(2); // hidden → skipped
    updater.destroy();
    fakeWindow.dispatchEvent(new Event("focus"));
    expect(container.registration.update).toHaveBeenCalledTimes(2); // destroyed → removed
  });

  it("attaches to the existing registration via .ready when register:false", async () => {
    container.registration.waiting = new FakeWorker("installed");
    const updater = createPwaUpdater({ register: false });
    await flush();
    expect(container.register).not.toHaveBeenCalled();
    expect(updater.getState().updateReady).toBe(true);
  });

  it("is an inert no-op when disabled", async () => {
    const updater = createPwaUpdater({ disabled: true });
    await flush();
    expect(container.register).not.toHaveBeenCalled();
    expect(updater.getState().updateReady).toBe(false);
    expect(() => updater.applyUpdate()).not.toThrow();
  });

  it("polls registration.update() on the interval and stops on destroy", async () => {
    vi.useFakeTimers();
    const updater = createPwaUpdater({ pollIntervalMs: 1000, updateOnFocus: false });
    await vi.advanceTimersByTimeAsync(0); // resolve register()
    await vi.advanceTimersByTimeAsync(1000);
    expect(container.registration.update).toHaveBeenCalledTimes(1);
    updater.destroy();
    await vi.advanceTimersByTimeAsync(3000);
    expect(container.registration.update).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

/**
 * F054.8 — the defect this card exists for.
 *
 * Every test above passes against the OLD implementation too. These do not, and
 * that is what makes them evidence rather than decoration: they exercise the
 * path where a worker is ALREADY waiting and no event will ever announce it.
 */
describe("F054.8 — re-derive from registration.waiting, do not wait to be told", () => {
  it("raises the banner from a POLL tick when a worker started waiting with NO event fired", async () => {
    vi.useFakeTimers();
    try {
      container.controller = {};
      container.registration.active = new FakeWorker("activated");
      const updater = createPwaUpdater({ pollIntervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(updater.getState().updateReady).toBe(false);

      // A worker becomes waiting with NO updatefound and NO statechange — the
      // state a second tab, or a backgrounded tab, actually finds itself in.
      container.registration.waiting = new FakeWorker("installed");

      await vi.advanceTimersByTimeAsync(1000);
      expect(updater.getState().updateReady).toBe(true);
      updater.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("raises it BEFORE update() resolves — a slow network must not hold the banner back", async () => {
    // THE DISCRIMINATING CASE, and it is why the tick reads BEFORE it asks.
    // The mutation harness caught me here: removing the leading check() killed
    // nothing, because the fake's update() resolves instantly and the trailing
    // .then(check) covered for it. A real update() is a network round-trip and
    // can hang for the whole timeout — offline, it never resolves at all. A tab
    // that ALREADY has a worker waiting must not sit bannerless meanwhile.
    vi.useFakeTimers();
    try {
      container.controller = {};
      container.registration.update = vi.fn(() => new Promise<void>(() => {})); // never resolves
      container.registration.waiting = new FakeWorker("installed");
      const updater = createPwaUpdater({
        pollIntervalMs: 1000,
        snoozeMs: 5000,
        snoozeStorage: null,
      });
      await vi.advanceTimersByTimeAsync(0);
      updater.snooze();
      expect(updater.getState().updateReady).toBe(false);

      await vi.advanceTimersByTimeAsync(10_000); // snooze expires; update() still hanging
      expect(updater.getState().updateReady).toBe(true);
      updater.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("raises it from a FOCUS tick under the same conditions", async () => {
    container.controller = {};
    const updater = createPwaUpdater({ pollIntervalMs: 0 });
    await flush();
    expect(updater.getState().updateReady).toBe(false);

    container.registration.waiting = new FakeWorker("installed");
    fakeWindow.dispatchEvent(new Event("focus"));
    await flush();

    expect(updater.getState().updateReady).toBe(true);
    updater.destroy();
  });

  it("EMITS more than once — the old markReady fired at most once per updater", async () => {
    container.controller = {};
    const updater = createPwaUpdater({ pollIntervalMs: 0, snoozeStorage: null });
    await flush();
    const seen: boolean[] = [];
    updater.subscribe((s) => seen.push(s.updateReady));

    container.registration.waiting = new FakeWorker("installed");
    updater.check();
    updater.snooze();          // "Later" → down
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2));

    expect(seen).toEqual([true, false]);
    updater.destroy();
  });

  it("a snooze EXPIRES — Later means later, never never", async () => {
    vi.useFakeTimers();
    try {
      container.controller = {};
      container.registration.waiting = new FakeWorker("installed");
      const updater = createPwaUpdater({
        pollIntervalMs: 1000,
        snoozeMs: 5000,
        snoozeStorage: null,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(updater.getState().updateReady).toBe(true);

      updater.snooze();
      expect(updater.getState().updateReady).toBe(false);

      await vi.advanceTimersByTimeAsync(4000);
      expect(updater.getState().updateReady).toBe(false); // still snoozed

      await vi.advanceTimersByTimeAsync(2000);
      expect(updater.getState().updateReady).toBe(true);  // and it comes BACK
      updater.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the snooze survives a destroy+recreate — a reload must not defeat it", async () => {
    const store = new Map<string, string>();
    const snoozeStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    container.controller = {};
    container.registration.waiting = new FakeWorker("installed");

    const first = createPwaUpdater({ pollIntervalMs: 0, snoozeMs: 60_000, snoozeStorage });
    await flush();
    first.snooze();
    first.destroy();

    // The banner asked for a reload; a reload must not be the way out of a snooze.
    const second = createPwaUpdater({ pollIntervalMs: 0, snoozeMs: 60_000, snoozeStorage });
    await flush();
    expect(second.getState().updateReady).toBe(false);
    second.destroy();
  });

  it("takes the banner DOWN when the waiting worker is gone (it could only ever go up)", async () => {
    container.controller = {};
    container.registration.waiting = new FakeWorker("installed");
    const updater = createPwaUpdater({ pollIntervalMs: 0, snoozeStorage: null });
    await flush();
    expect(updater.getState().updateReady).toBe(true);

    container.registration.waiting = null; // activated in another tab
    updater.check();

    expect(updater.getState().updateReady).toBe(false);
    updater.destroy();
  });

  it("a storage that THROWS does not stop updates being offered", async () => {
    const hostile = {
      getItem: () => { throw new Error("site data blocked"); },
      setItem: () => { throw new Error("site data blocked"); },
      removeItem: () => { throw new Error("site data blocked"); },
    };
    container.controller = {};
    container.registration.waiting = new FakeWorker("installed");
    const updater = createPwaUpdater({ pollIntervalMs: 0, snoozeStorage: hostile });
    await flush();
    expect(updater.getState().updateReady).toBe(true);
    expect(() => updater.snooze()).not.toThrow();
    updater.destroy();
  });
});
