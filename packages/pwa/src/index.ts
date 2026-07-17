import { SKIP_WAITING_MESSAGE } from "./message.js";

export { SKIP_WAITING, SKIP_WAITING_MESSAGE } from "./message.js";
export type { SkipWaitingMessage } from "./message.js";

export interface PwaUpdaterOptions {
  /** Service-worker script URL to register. Default `/sw.js`. */
  swUrl?: string;
  /**
   * Register `swUrl` ourselves (manual `sw.js` style). Set `false` when the
   * app already registers the SW (e.g. Serwist's `registerSW` / `@serwist/next`)
   * — the updater then attaches to the existing registration via
   * `navigator.serviceWorker.ready` instead of registering again. Default `true`.
   */
  register?: boolean;
  /** How often to poll `registration.update()` (ms). `0` disables. Default 60 min. */
  pollIntervalMs?: number;
  /**
   * Also check for an update when the tab regains focus / becomes visible.
   * A constantly-focused tab never fires `visibilitychange`, so `focus` is the
   * one that catches "user came back to the app". Default `true`.
   */
  updateOnFocus?: boolean;
  /** Reload the page once the new worker takes control. Default `true`. */
  reloadOnControllerChange?: boolean;
  /**
   * Consumer guard. When `true` the updater is an inert no-op (registers
   * nothing). Pass your own policy, e.g. `disabled: isNativeCapacitor || isDev`
   * — the package never hardcodes an environment or a `.native` check.
   */
  disabled?: boolean;
}

export interface PwaUpdaterState {
  /** A new service worker is installed and waiting to activate. */
  updateReady: boolean;
}

export interface PwaUpdater {
  /** Subscribe to state changes. Returns an unsubscribe fn. */
  subscribe(listener: (state: PwaUpdaterState) => void): () => void;
  getState(): PwaUpdaterState;
  /** Tell the waiting worker to activate (posts SKIP_WAITING). No-op if none waits. */
  applyUpdate(): void;
  /** Stop polling + remove all listeners. */
  destroy(): void;
}

const DEFAULT_POLL_MS = 60 * 60 * 1000;

/**
 * Framework- and bundler-agnostic controller for the PWA "new version
 * available" lifecycle: register (or attach) → detect a waiting worker
 * (suppressing the first install) → let the consumer activate it → reload on
 * takeover, re-checking on interval + focus/visibility.
 *
 * Distilled from the pattern hand-rolled across the fleet (fds, cardmem,
 * pitch-vault). Works with any service worker (Serwist, Workbox, hand-rolled)
 * as long as the SW answers a `SKIP_WAITING` message — see `@broberg/pwa/sw`.
 */
export function createPwaUpdater(options: PwaUpdaterOptions = {}): PwaUpdater {
  const {
    swUrl = "/sw.js",
    register = true,
    pollIntervalMs = DEFAULT_POLL_MS,
    updateOnFocus = true,
    reloadOnControllerChange = true,
    disabled = false,
  } = options;

  const listeners = new Set<(state: PwaUpdaterState) => void>();
  let updateReady = false;
  let waitingWorker: ServiceWorker | null = null;

  const getState = (): PwaUpdaterState => ({ updateReady });
  const emit = (): void => {
    const state = getState();
    for (const listener of listeners) listener(state);
  };
  const subscribe = (listener: (state: PwaUpdaterState) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const supported =
    typeof navigator !== "undefined" && "serviceWorker" in navigator;

  // Inert no-op: disabled by the consumer, or no service-worker support at all.
  if (disabled || !supported) {
    return {
      subscribe,
      getState,
      applyUpdate() {},
      destroy() {
        listeners.clear();
      },
    };
  }

  const container = navigator.serviceWorker;
  let pollId: ReturnType<typeof setInterval> | null = null;
  let removeFocusListeners: (() => void) | null = null;
  let reloading = false;
  let destroyed = false;

  const markReady = (worker: ServiceWorker): void => {
    waitingWorker = worker;
    if (!updateReady) {
      updateReady = true;
      emit();
    }
  };

  // With `clientsClaim: true` a brand-new worker claims a previously
  // uncontrolled page and fires `controllerchange` on the FIRST install — that
  // is not an update, so reloading there would yank a first-time visitor out of
  // whatever they are doing. Only a `controllerchange` that REPLACES an existing
  // controller is a real takeover worth reloading for.
  let hadController = !!container.controller;
  const onControllerChange = (): void => {
    if (!reloadOnControllerChange || reloading) return;
    if (!hadController) {
      hadController = true; // first claim of an uncontrolled page — not an update
      return;
    }
    reloading = true; // guard against a reload-loop
    if (typeof location !== "undefined") location.reload();
  };
  container.addEventListener("controllerchange", onControllerChange);

  const watchInstalling = (registration: ServiceWorkerRegistration): void => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      // A new worker reaching `installed` WHILE a controller already exists is
      // an update. Reaching `installed` with no controller is the FIRST install
      // — nothing to update, so we stay quiet.
      if (installing.state === "installed" && container.controller) {
        markReady(installing);
      }
    });
  };

  const wireFocusChecks = (registration: ServiceWorkerRegistration): void => {
    if (!updateOnFocus) return;
    const check = (): void => {
      registration.update().catch(() => {});
    };
    const onFocus = (): void => check();
    const onVisibility = (): void => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        check();
      }
    };
    if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    removeFocusListeners = () => {
      if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  };

  // Manual style registers swUrl; serwist/registerSW style attaches to the
  // registration the app already made via `.ready`.
  const registrationPromise = register ? container.register(swUrl) : container.ready;

  registrationPromise
    .then((registration) => {
      if (destroyed) return;
      if (registration.waiting) markReady(registration.waiting);
      registration.addEventListener("updatefound", () => watchInstalling(registration));
      if (pollIntervalMs > 0) {
        pollId = setInterval(() => {
          registration.update().catch(() => {
            // ignore transient update-check network errors
          });
        }, pollIntervalMs);
      }
      wireFocusChecks(registration);
    })
    .catch(() => {
      // registration failed — stay inert rather than throw into the app
    });

  return {
    subscribe,
    getState,
    applyUpdate() {
      if (waitingWorker) waitingWorker.postMessage(SKIP_WAITING_MESSAGE);
    },
    destroy() {
      destroyed = true;
      if (pollId !== null) clearInterval(pollId);
      removeFocusListeners?.();
      container.removeEventListener("controllerchange", onControllerChange);
      listeners.clear();
    },
  };
}
