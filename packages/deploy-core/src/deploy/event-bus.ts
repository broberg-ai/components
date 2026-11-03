/**
 * F033.3 — the deploy-event bus, lifted from cms (cms-admin/src/lib/deploy/deploy-events.ts).
 *
 * Webhook receivers PUBLISH, SSE endpoints / the trigger UI SUBSCRIBE. Channel key is
 * `${orgId}:${siteId}`, so a subscriber only hears the site it cares about.
 *
 * Single-process by design: a Map of listeners. Right for a single-instance Fly app;
 * several instances would need Redis pub/sub or similar, which is out of scope for v1.
 *
 * A FACTORY, not a module-level Map: two buses in one process (a test and the app, or two
 * apps bundled together) must not hear each other.
 */

export type DeployStatus = "queued" | "building" | "built" | "errored";

export interface DeployEvent {
  /** What produced the event, e.g. "page-build" (GitHub Pages) or "fly-deploy". */
  type: string;
  orgId: string;
  siteId: string;
  status: DeployStatus;
  /** Commit sha that produced the build. */
  sha?: string;
  /** Live URL once status === "built". */
  url?: string;
  /** Error text when status === "errored". */
  error?: string;
  /** Provider-reported duration in seconds. */
  duration?: number;
  /** ISO time the event was received. */
  ts: string;
}

export type DeployListener = (event: DeployEvent) => void;

export interface DeployEventBusOptions {
  /**
   * Called for TERMINAL events only (built / errored) — the Web Push side channel.
   * Fire-and-forget: it never blocks listeners or the publishing webhook. Omit it and
   * nothing is dispatched.
   */
  dispatch?: (event: DeployEvent) => Promise<void> | void;
  /**
   * Where a throwing listener or a failed dispatch is reported. One bad listener never
   * stops the others. Default: console.warn.
   */
  onError?: (err: unknown, where: "listener" | "dispatch", event: DeployEvent) => void;
}

export interface DeployEventBus {
  /** Listen to one site. Returns the unsubscribe function. */
  subscribe(orgId: string, siteId: string, fn: DeployListener): () => void;
  /** Deliver to every current subscriber of the event's site; no subscribers is a no-op. */
  publish(event: DeployEvent): void;
  /** How many listeners a site has right now (diagnostics, open SSE connections). */
  listenerCount(orgId: string, siteId: string): number;
}

const keyOf = (orgId: string, siteId: string) => `${orgId}:${siteId}`;

export function createDeployEventBus(opts: DeployEventBusOptions = {}): DeployEventBus {
  const listeners = new Map<string, Set<DeployListener>>();
  const report = opts.onError ?? ((err, where) => console.warn(`[deploy-event-bus] ${where} failed:`, err));

  return {
    subscribe(orgId, siteId, fn) {
      const k = keyOf(orgId, siteId);
      let set = listeners.get(k);
      if (!set) { set = new Set(); listeners.set(k, set); }
      set.add(fn);
      return () => {
        set!.delete(fn);
        if (set!.size === 0) listeners.delete(k);
      };
    },

    publish(event) {
      const set = listeners.get(keyOf(event.orgId, event.siteId));
      if (set) {
        for (const fn of [...set]) {
          try { fn(event); } catch (err) { report(err, "listener", event); }
        }
      }
      if (opts.dispatch && (event.status === "built" || event.status === "errored")) {
        try {
          void Promise.resolve(opts.dispatch(event)).catch((err) => report(err, "dispatch", event));
        } catch (err) {
          report(err, "dispatch", event);
        }
      }
    },

    listenerCount(orgId, siteId) {
      return listeners.get(keyOf(orgId, siteId))?.size ?? 0;
    },
  };
}
