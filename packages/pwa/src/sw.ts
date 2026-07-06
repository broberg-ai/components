import { SKIP_WAITING } from "./message.js";

export { SKIP_WAITING, SKIP_WAITING_MESSAGE } from "./message.js";
export type { SkipWaitingMessage } from "./message.js";

/**
 * The minimal slice of a service-worker global scope this helper needs.
 * Kept as a local interface so the package doesn't pull in the `webworker`
 * TS lib (which clashes with `dom`) and stays trivially testable.
 */
export interface SkipWaitingScope {
  addEventListener(
    type: "message",
    listener: (event: { data?: unknown }) => void,
  ): void;
  skipWaiting(): Promise<void> | void;
}

/**
 * Wire the service-worker side of the update handshake: when the client calls
 * `applyUpdate()` (posts `SKIP_WAITING`), the worker activates immediately.
 *
 * Call it once inside your service worker, before other setup:
 *
 * ```ts
 * import { listenForSkipWaiting } from "@broberg/pwa/sw";
 * listenForSkipWaiting();
 * ```
 *
 * Serwist/Workbox users: keep `skipWaiting: false` (so activation is
 * user-gated by the banner, not automatic) and `clientsClaim: true`.
 */
export function listenForSkipWaiting(scope?: SkipWaitingScope): void {
  const target =
    scope ?? (globalThis as unknown as SkipWaitingScope);
  target.addEventListener("message", (event) => {
    if ((event.data as { type?: string })?.type === SKIP_WAITING) {
      void target.skipWaiting();
    }
  });
}
