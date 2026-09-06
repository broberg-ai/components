import { SKIP_WAITING_MESSAGE } from "./message.js";
import { shouldOfferUpdate } from "./should-offer.js";

export { SKIP_WAITING, SKIP_WAITING_MESSAGE } from "./message.js";
export { shouldOfferUpdate } from "./should-offer.js";
export type { ShouldOfferInput } from "./should-offer.js";
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
   * How long `snooze()` holds the offer down (ms). Default 30 min.
   *
   * F054.8 — "Later" is a SNOOZE, never a mute. The defect this replaced was a
   * banner that got exactly one chance to be seen; a permanent dismiss is that
   * defect made official.
   */
  snoozeMs?: number;
  /**
   * Where a snooze is remembered, so it survives the reload the banner is
   * asking for. Defaults to `localStorage` when available; pass `null` to keep
   * the snooze in memory only.
   */
  snoozeStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
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
  /**
   * "Later". Holds the offer down for `snoozeMs`, then it comes back on the
   * next tick — this is NOT a mute, and it deliberately cannot be made one.
   */
  snooze(): void;
  /** Re-read `registration.waiting` right now and emit if the answer moved. */
  check(): void;
  /** Stop polling + remove all listeners. */
  destroy(): void;
}

const DEFAULT_POLL_MS = 60 * 60 * 1000;
const DEFAULT_SNOOZE_MS = 30 * 60 * 1000;
const SNOOZE_KEY = "broberg-pwa:snoozed-until";

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
    snoozeMs = DEFAULT_SNOOZE_MS,
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
      snooze() {},
      check() {},
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

  // F054.8 — READ the answer, never remember it.
  //
  // This used to be markReady(worker), the only writer of `updateReady`, and it
  // was guarded by `if (!updateReady)` — so `emit()` fired AT MOST ONCE for the
  // life of the updater. Both adapters drive their state from subscribe(), so a
  // consumer who dismissed the banner had no channel that could ever raise it
  // again. cardmem measured the consequence in production: a client sat on an
  // old bundle indefinitely, and the only symptom anyone had was a person
  // saying a feature was missing.
  //
  // `registration` is captured once resolved so every tick can re-read
  // `.waiting` rather than wait to be told.
  let registrationRef: ServiceWorkerRegistration | null = null;

  const storage: PwaUpdaterOptions["snoozeStorage"] =
    options.snoozeStorage !== undefined
      ? options.snoozeStorage
      : typeof localStorage !== "undefined"
        ? localStorage
        : null;

  let snoozedUntil: number | null = null;
  const readSnooze = (): number | null => {
    if (!storage) return snoozedUntil;
    try {
      const raw = storage.getItem(SNOOZE_KEY);
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      // A browser with site data blocked THROWS on read. That is not a reason to
      // stop offering updates — fall back to the in-memory value.
      return snoozedUntil;
    }
  };
  const writeSnooze = (until: number | null): void => {
    snoozedUntil = until;
    if (!storage) return;
    try {
      if (until === null) storage.removeItem(SNOOZE_KEY);
      else storage.setItem(SNOOZE_KEY, String(until));
    } catch {
      // in-memory only for this tab; already recorded above
    }
  };

  /**
   * Re-derive from what is true RIGHT NOW and emit only when the answer moved.
   * Emits in BOTH directions: false→true raises the banner, true→false takes it
   * down when the worker is gone or the user snoozed.
   */
  const check = (): void => {
    const waiting = registrationRef?.waiting ?? null;
    waitingWorker = waiting;
    const next = shouldOfferUpdate({
      waiting,
      snoozedUntil: readSnooze(),
      now: Date.now(),
    });
    if (next !== updateReady) {
      updateReady = next;
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
      if (installing.state === "installed") check();
    });
  };

  const wireFocusChecks = (registration: ServiceWorkerRegistration): void => {
    if (!updateOnFocus) return;
    // update() asks the SERVER for a new worker; check() reads whether one is
    // already WAITING. The second is the half that was missing — reg.update()
    // resolves without firing updatefound when a worker is already waiting, so
    // a tab that missed the original event could never learn about it.
    const tick = (): void => {
      check();
      registration.update().catch(() => {}).then(check, check);
    };
    const onFocus = (): void => tick();
    const onVisibility = (): void => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        tick();
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
      registrationRef = registration;
      check();
      registration.addEventListener("updatefound", () => watchInstalling(registration));
      if (pollIntervalMs > 0) {
        pollId = setInterval(() => {
          check();
          registration
            .update()
            .catch(() => {
              // ignore transient update-check network errors
            })
            .then(check, check);
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
    snooze() {
      writeSnooze(Date.now() + snoozeMs);
      check();
    },
    check,
    destroy() {
      destroyed = true;
      if (pollId !== null) clearInterval(pollId);
      removeFocusListeners?.();
      container.removeEventListener("controllerchange", onControllerChange);
      listeners.clear();
    },
  };
}
