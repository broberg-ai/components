import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUseTurnstile, type HooksApi, type UseTurnstileResult } from "../src/use-turnstile-core";

/**
 * No jsdom, and none needed. The hooks arrive as a parameter, so a fake runtime
 * exercises the REAL logic — including all three silent-exit paths, which is the
 * whole point of the card. Testing this through a framework renderer would test
 * the renderer.
 */
function harness() {
  const slots: unknown[] = [];
  let cursor = 0;
  let effectDone = false;
  let cleanup: (() => void) | void;

  const hooks: HooksApi = {
    useRef: <T,>(initial: T) => {
      const k = cursor++;
      if (slots[k] === undefined) slots[k] = { current: initial };
      return slots[k] as { current: T };
    },
    useState: <T,>(initial: T) => {
      const k = cursor++;
      if (slots[k] === undefined) slots[k] = { v: initial };
      const cell = slots[k] as { v: T };
      return [cell.v, (next: T) => { cell.v = next; }];
    },
    useEffect: (effect) => {
      cursor++;
      // Deps are ignored on purpose: every test mounts once, and pretending to
      // diff them would be scaffolding that could disagree with the real thing.
      if (!effectDone) {
        effectDone = true;
        cleanup = effect();
      }
    },
  };

  const useTurnstile = createUseTurnstile(hooks);
  return {
    /** Re-read the hook's output, the way a re-render would. */
    render(siteKey: string | null | undefined = "site-key"): UseTurnstileResult {
      cursor = 0;
      return useTurnstile(siteKey);
    },
    unmount: () => cleanup?.(),
  };
}

/** Drain the promise queue so the hook's async effect body has run. */
const tick = () => new Promise((r) => setTimeout(r, 0));

interface FakeScript {
  src: string;
  async: boolean;
  defer: boolean;
  setAttribute: (k: string, v: string) => void;
  addEventListener: (ev: string, fn: () => void, o?: unknown) => void;
  fire: (ev: "load" | "error") => void;
}

let scripts: FakeScript[] = [];
let renderedOpts: Record<string, unknown> | null = null;
let removed: string[] = [];

/** `scriptOutcome` decides what the injected <script> does; `provideGlobal`
 *  decides whether window.turnstile appears when it loads. Splitting the two is
 *  deliberate — the third failure is exactly the case where they disagree. */
function stubDom(opts: { scriptOutcome: "load" | "error" | "never"; provideGlobal?: boolean }) {
  const handlers = new Map<string, () => void>();
  const el = { tagName: "DIV" } as unknown as HTMLDivElement;

  const script: FakeScript = {
    src: "",
    async: false,
    defer: false,
    setAttribute: () => {},
    addEventListener: (ev, fn) => handlers.set(ev, fn),
    fire: (ev) => handlers.get(ev)?.(),
  };

  (globalThis as Record<string, unknown>).window = {};
  (globalThis as Record<string, unknown>).document = {
    querySelector: () => null,
    createElement: () => {
      scripts.push(script);
      return script;
    },
    head: {
      appendChild: () => {
        if (opts.scriptOutcome === "never") return;
        // Async, like a real network round-trip — a synchronous fire would let
        // an ordering bug pass that a real browser would expose.
        setTimeout(() => {
          if (opts.scriptOutcome === "load" && opts.provideGlobal !== false) {
            (globalThis as unknown as { window: Record<string, unknown> }).window.turnstile = {
              render: (_el: HTMLElement, o: Record<string, unknown>) => {
                renderedOpts = o;
                return "widget-1";
              },
              reset: () => {},
              remove: (id: string) => removed.push(id),
            };
          }
          script.fire(opts.scriptOutcome === "error" ? "error" : "load");
        }, 0);
      },
    },
  };
  return { el };
}

beforeEach(() => {
  scripts = [];
  renderedOpts = null;
  removed = [];
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
});

describe("status — 'not solved yet' and 'will never work' must not look the same", () => {
  it("a script that fails to load ends in 'failed', not 'loading'", async () => {
    const { el } = stubDom({ scriptOutcome: "error" });
    const h = harness();
    h.render().widgetRef.current = el;
    h.render();
    await tick();
    await tick();

    const r = h.render();
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/load failed/i);
    expect(r.token).toBe("");
  });

  it("a script that LOADS but leaves window.turnstile undefined also ends in 'failed'", async () => {
    // The sneakiest of the three: nothing looks wrong from the network's side.
    const { el } = stubDom({ scriptOutcome: "load", provideGlobal: false });
    const h = harness();
    h.render().widgetRef.current = el;
    h.render();
    await tick();
    await tick();

    const r = h.render();
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/window\.turnstile is undefined/);
  });

  it("a widgetRef that was never attached ends in 'failed', naming that", async () => {
    stubDom({ scriptOutcome: "load" });
    const h = harness(); // widgetRef.current deliberately left null
    h.render();
    await tick();
    await tick();

    const r = h.render();
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/never attached/);
  });

  it("a rendered widget is 'ready', and solving it is 'solved' — the two the user controls", async () => {
    // Without this, collapsing every state into 'failed' would satisfy the three
    // tests above.
    const { el } = stubDom({ scriptOutcome: "load" });
    const h = harness();
    h.render().widgetRef.current = el;
    h.render();
    await tick();
    await tick();

    expect(h.render().status).toBe("ready");
    expect(h.render().token).toBe("");

    (renderedOpts!.callback as (t: string) => void)("tok-123");
    expect(h.render().status).toBe("solved");
    expect(h.render().token).toBe("tok-123");
  });

  it("expiry returns to 'ready', not 'failed' — it worked, it just aged out", async () => {
    const { el } = stubDom({ scriptOutcome: "load" });
    const h = harness();
    h.render().widgetRef.current = el;
    h.render();
    await tick();
    await tick();
    (renderedOpts!.callback as (t: string) => void)("tok-123");
    expect(h.render().status).toBe("solved");

    (renderedOpts!["expired-callback"] as () => void)();
    expect(h.render().status).toBe("ready");
    expect(h.render().token).toBe("");
  });

  it("a challenge error IS 'failed' — the user cannot proceed until it is reset", async () => {
    const { el } = stubDom({ scriptOutcome: "load" });
    const h = harness();
    h.render().widgetRef.current = el;
    h.render();
    await tick();
    await tick();

    (renderedOpts!["error-callback"] as () => void)();
    const r = h.render();
    expect(r.status).toBe("failed");
    expect(r.token).toBe("");
  });

  it("reset() from 'solved' goes to 'ready', never back to 'loading'", async () => {
    const { el } = stubDom({ scriptOutcome: "load" });
    const h = harness();
    h.render().widgetRef.current = el;
    h.render();
    await tick();
    await tick();
    (renderedOpts!.callback as (t: string) => void)("tok-123");

    h.render().reset();
    const r = h.render();
    expect(r.status).toBe("ready");
    expect(r.token).toBe("");
  });

  it("reset() does NOT launder a load failure into 'ready'", async () => {
    // Resetting a widget that never existed cannot repair it. If this passed,
    // a form's retry button would clear the only evidence of the real problem.
    stubDom({ scriptOutcome: "error" });
    const h = harness();
    h.render();
    await tick();
    await tick();

    h.render().reset();
    const r = h.render();
    expect(r.status).toBe("failed");
  });

  it("unmount removes the widget", async () => {
    const { el } = stubDom({ scriptOutcome: "load" });
    const h = harness();
    h.render().widgetRef.current = el;
    h.render();
    await tick();
    await tick();

    h.unmount();
    expect(removed).toEqual(["widget-1"]);
  });
});
