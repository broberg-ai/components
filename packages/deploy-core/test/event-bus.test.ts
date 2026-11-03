// F033.3 — the deploy-event bus: keyed by orgId:siteId, no-op without listeners,
// and an optional push hook that only fires for terminal events.
import { describe, it, expect, vi } from "vitest";
import { createDeployEventBus, type DeployEvent } from "../src/index";

const ev = (over: Partial<DeployEvent> = {}): DeployEvent => ({
  type: "page-build", orgId: "o1", siteId: "s1", status: "building",
  ts: "2026-11-03T03:00:00.000Z", ...over,
});

describe("createDeployEventBus — subscribe / publish / listenerCount", () => {
  it("delivers only to the site's own subscribers (key = orgId:siteId)", () => {
    const bus = createDeployEventBus();
    const a = vi.fn(), b = vi.fn(), other = vi.fn();
    bus.subscribe("o1", "s1", a);
    bus.subscribe("o1", "s1", b);
    bus.subscribe("o1", "s2", other);
    bus.publish(ev());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0]).toEqual(ev());
    expect(other).not.toHaveBeenCalled();
  });

  it("orgId and siteId are both part of the key — same siteId in another org is not heard", () => {
    const bus = createDeployEventBus();
    const fn = vi.fn();
    bus.subscribe("o2", "s1", fn);
    bus.publish(ev());
    expect(fn).not.toHaveBeenCalled();
  });

  it("publish to a key with no listeners is a no-op, not a throw", () => {
    const bus = createDeployEventBus();
    expect(() => bus.publish(ev({ siteId: "nobody" }))).not.toThrow();
  });

  it("listenerCount counts per site and drops to 0 after unsubscribe", () => {
    const bus = createDeployEventBus();
    const off1 = bus.subscribe("o1", "s1", () => {});
    const off2 = bus.subscribe("o1", "s1", () => {});
    expect(bus.listenerCount("o1", "s1")).toBe(2);
    expect(bus.listenerCount("o1", "s2")).toBe(0);
    off1(); expect(bus.listenerCount("o1", "s1")).toBe(1);
    off2(); expect(bus.listenerCount("o1", "s1")).toBe(0);
  });

  it("one throwing listener does not stop the others, and the error is REPORTED, not swallowed", () => {
    const onError = vi.fn();
    const bus = createDeployEventBus({ onError });
    const after = vi.fn();
    bus.subscribe("o1", "s1", () => { throw new Error("bad listener"); });
    bus.subscribe("o1", "s1", after);
    bus.publish(ev());
    expect(after).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "listener", expect.objectContaining({ siteId: "s1" }));
  });

  it("two buses never hear each other", () => {
    const a = createDeployEventBus(), b = createDeployEventBus();
    const fn = vi.fn();
    a.subscribe("o1", "s1", fn);
    b.publish(ev());
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("the Web Push dispatch hook", () => {
  it("is a no-op when unconfigured — terminal events publish without error", () => {
    const bus = createDeployEventBus();
    expect(() => bus.publish(ev({ status: "built" }))).not.toThrow();
    expect(() => bus.publish(ev({ status: "errored" }))).not.toThrow();
  });

  it("fires for built and errored, never for queued or building", () => {
    const dispatch = vi.fn();
    const bus = createDeployEventBus({ dispatch });
    bus.publish(ev({ status: "queued" }));
    bus.publish(ev({ status: "building" }));
    expect(dispatch).not.toHaveBeenCalled();
    bus.publish(ev({ status: "built", url: "https://x" }));
    bus.publish(ev({ status: "errored", error: "boom" }));
    expect(dispatch.mock.calls.map((c) => c[0].status)).toEqual(["built", "errored"]);
  });

  it("fires even when nobody is subscribed (push reaches users with no tab open)", () => {
    const dispatch = vi.fn();
    createDeployEventBus({ dispatch }).publish(ev({ status: "built" }));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("a rejecting dispatch is reported and never thrown at the publisher", async () => {
    const onError = vi.fn();
    const bus = createDeployEventBus({ dispatch: async () => { throw new Error("push down"); }, onError });
    expect(() => bus.publish(ev({ status: "built" }))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "dispatch", expect.objectContaining({ status: "built" }));
  });

  it("a synchronously throwing dispatch is reported too", () => {
    const onError = vi.fn();
    const bus = createDeployEventBus({ dispatch: () => { throw new Error("sync"); }, onError });
    expect(() => bus.publish(ev({ status: "errored" }))).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "dispatch", expect.anything());
  });
});
