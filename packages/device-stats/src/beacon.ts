/**
 * The launch beacon (F078.6) — for when the API is not on the page's origin.
 *
 * `launch: "installed"` comes from the app's OWN declared launch context: the
 * manifest's `start_url` carries `?src=pwa`, so a home-screen open lands on a
 * page URL with that marker. A server middleware sees the URL of the request it
 * handles — which, when the API lives on another domain, is the API call's URL
 * and never the page's. Every visit then counts as `browser`.
 *
 * So the page tells the server, in one tiny request, the ONE thing only the page
 * knows: its own launch marker. Everything else is derived on the server from
 * that request's own headers, exactly as the middleware would.
 *
 * TIER 0, NO CONSENT, and the reason is specific: the sender reads the page's
 * own `location.search` — a string the app itself wrote via its manifest — and
 * nothing from the device. No `navigator`, no `screen`, no `matchMedia`. It
 * sends with `fetch(…, { keepalive })` rather than `navigator.sendBeacon` so
 * that the transport, too, touches no device accessor.
 */
import { deriveDevice, type HeaderInput } from "./index";
import type { SqlDeviceStore } from "./store";

/** A beacon is a few dozen characters; anything over this is not one. */
export const MAX_DEVICE_BEACON_CHARS = 256;

/** A launch marker is a short token like `pwa`; anything else is refused. */
const LAUNCH_TOKEN = /^[a-z0-9_-]{1,32}$/i;

export interface DeviceBeaconRequest {
  headers: HeaderInput;
  /** The raw request body as text. */
  bodyText: string;
}

/**
 * Count one visit from a beacon. Body: `{"launch":"<marker>"}` or `{}` (no
 * marker = an ordinary browser visit). Returns the HTTP status to answer with:
 * 204 counted, 400 not a beacon (nothing counted).
 *
 * `day` is the caller's: the store has no clock, and which time zone a "day"
 * is belongs to the app, not to this package.
 */
export async function handleDeviceBeacon(
  store: Pick<SqlDeviceStore, "increment">,
  req: DeviceBeaconRequest,
  day: string,
): Promise<204 | 400> {
  if (req.bodyText.length > MAX_DEVICE_BEACON_CHARS) return 400;
  let body: unknown;
  try {
    body = JSON.parse(req.bodyText);
  } catch {
    return 400;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return 400;
  const keys = Object.keys(body);
  if (keys.some((k) => k !== "launch")) return 400;
  const launch = (body as { launch?: unknown }).launch;
  if (launch !== undefined && (typeof launch !== "string" || !LAUNCH_TOKEN.test(launch))) return 400;

  const facts = deriveDevice({ headers: req.headers, launchCtx: launch ?? "browser" });
  await store.increment(facts, day);
  return 204;
}

export interface SendLaunchBeaconOptions {
  /** Query parameter carrying the launch marker. Default `src`, as the server side. */
  launchParam?: string;
  /**
   * Injected for tests; defaults to the global `fetch`. Typed STRUCTURALLY:
   * `typeof fetch` differs per runtime (Bun adds `preconnect`), so a plain
   * function would not satisfy it everywhere.
   */
  fetchImpl?: (input: string, init: RequestInit) => Promise<unknown>;
  /** Injected for tests; defaults to `location.search`. */
  search?: string;
}

/**
 * Send the page's launch marker to `endpoint`. Never throws — a statistic is
 * not worth an error on someone's page. Returns whether the request was sent.
 */
export async function sendLaunchBeacon(endpoint: string, opts: SendLaunchBeaconOptions = {}): Promise<boolean> {
  try {
    const loc = (globalThis as { location?: { search?: string } }).location;
    const search = opts.search ?? loc?.search ?? "";
    const marker = new URLSearchParams(search).get(opts.launchParam ?? "src");
    const body = marker && LAUNCH_TOKEN.test(marker) ? JSON.stringify({ launch: marker }) : "{}";
    const f = opts.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init));
    await f(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    });
    return true;
  } catch {
    return false;
  }
}
