import { describe, it, expect, vi } from "vitest";
import { listenForSkipWaiting, SKIP_WAITING_MESSAGE } from "../src/sw.js";

describe("listenForSkipWaiting", () => {
  it("calls skipWaiting only on a SKIP_WAITING message", () => {
    let handler: ((event: { data?: unknown }) => void) | null = null;
    const scope = {
      addEventListener: vi.fn((_type: "message", h: (event: { data?: unknown }) => void) => {
        handler = h;
      }),
      skipWaiting: vi.fn(() => Promise.resolve()),
    };

    listenForSkipWaiting(scope);
    expect(scope.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));

    handler!({ data: { type: "SOMETHING_ELSE" } });
    expect(scope.skipWaiting).not.toHaveBeenCalled();

    handler!({ data: SKIP_WAITING_MESSAGE });
    expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
  });
});
