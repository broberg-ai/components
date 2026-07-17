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
  setState(state: string) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
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

  it("flags updateReady on updatefound→installed while a controller exists", async () => {
    container.controller = {}; // an active controller = this is an update
    const updater = createPwaUpdater();
    await flush();
    const seen: boolean[] = [];
    updater.subscribe((s) => seen.push(s.updateReady));
    const worker = new FakeWorker("installing");
    container.registration.installing = worker;
    container.registration.dispatchEvent(new Event("updatefound"));
    worker.setState("installed");
    expect(updater.getState().updateReady).toBe(true);
    expect(seen).toContain(true);
  });

  it("suppresses the first install (no existing controller → no banner)", async () => {
    container.controller = null; // first install
    const updater = createPwaUpdater();
    await flush();
    const worker = new FakeWorker("installing");
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
