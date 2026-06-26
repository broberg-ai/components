import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeSSE } from "../src/sse";

const enc = new TextEncoder();

afterEach(() => vi.unstubAllGlobals());

/**
 * A `fetch` stub whose stream the test drives, and which HONOURS the abort
 * signal — so the watchdog's `controller.abort()` rejects a pending
 * `reader.read()` exactly as a real network fetch would (without it, test 1
 * could never observe the abort).
 */
function stubSse(drive: (c: ReadableStreamDefaultController<Uint8Array>) => void) {
  vi.stubGlobal("fetch", (_url: string, init?: { signal?: AbortSignal }) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener("abort", () => {
          try {
            controller.error(new Error("aborted"));
          } catch {
            /* already closed */
          }
        });
        drive(controller);
      },
    });
    return Promise.resolve(
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
  });
}

describe("consumeSSE watchdog", () => {
  it("aborts a silent (half-open) stream within the idle timeout", async () => {
    stubSse((c) => {
      c.enqueue(enc.encode("event: hello\ndata: {}\n\n")); // one frame, then SILENT — never closes
    });
    let connected = false;
    let threw = false;
    const start = Date.now();
    try {
      await consumeSSE("http://x/", "", () => {}, {
        idleTimeoutMs: 300,
        onConnected: () => {
          connected = true;
        },
      });
    } catch {
      threw = true;
    }
    const elapsed = Date.now() - start;
    expect(connected).toBe(true);
    expect(threw).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("does NOT abort while frames keep arriving (no false drop)", async () => {
    stubSse((c) => {
      c.enqueue(enc.encode("event: hello\ndata: {}\n\n"));
      let n = 0;
      const iv = setInterval(() => {
        c.enqueue(enc.encode("event: ping\ndata: \n\n"));
        if (++n >= 5) {
          clearInterval(iv);
          c.close();
        }
      }, 100);
    });
    let pings = 0;
    let threw = false;
    try {
      await consumeSSE(
        "http://x/",
        "",
        (e) => {
          if (e === "ping") pings++;
        },
        { idleTimeoutMs: 300 },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(pings).toBe(5);
  });
});
