/**
 * Stack A adapter — Next.js.
 *
 * NO Next type is imported here, on purpose. `@broberg/auth` F008.8 paid for
 * the alternative: a vendor type that turned out to be invariant forced every
 * consumer to write a cast. These take structural slices of what they actually
 * touch, so they work with `NextRequest`, a plain `Request` in a route handler,
 * and the `ReadonlyHeaders` that `headers()` returns — without `next` being a
 * dependency of this package at all.
 */
import { deviceFromRequest, deriveDevice, type DeviceFacts, type FromRequestOptions } from "./index";

/** What we touch on a NextRequest / Request. Structural — not `NextRequest`. */
export interface NextRequestLike {
  headers: Headers;
  url?: string | null;
  /** Present on NextRequest; used only if `url` is absent. */
  nextUrl?: { href?: string | null; search?: string | null } | null;
}

/**
 * Derive device facts in Next.js middleware or a route handler.
 *
 * The launch marker is read from the request's own query string, so
 * `start_url: "/?src=pwa"` in the manifest is all the wiring an app needs.
 */
export function deviceFromNextRequest(
  req: NextRequestLike,
  opts: FromRequestOptions = {},
): DeviceFacts {
  const url = req.url ?? req.nextUrl?.href ?? (req.nextUrl?.search ? `/${req.nextUrl.search}` : null);
  return deviceFromRequest({ headers: req.headers, url }, opts);
}

/** The read-only header bag `headers()` returns. Structural, again. */
export interface ReadonlyHeadersLike {
  get(name: string): string | null;
}

export interface FromNextHeadersOptions extends FromRequestOptions {
  /**
   * The page's search params. `headers()` carries NO URL, so without this the
   * launch context genuinely cannot be determined.
   */
  searchParams?: URLSearchParams | Record<string, string | string[] | undefined> | null;
}

function readParam(
  sp: FromNextHeadersOptions["searchParams"],
  name: string,
): string | null | undefined {
  if (sp == null) return undefined;
  if (typeof (sp as URLSearchParams).get === "function") return (sp as URLSearchParams).get(name);
  const bag = sp as Record<string, string | string[] | undefined>;
  const v = bag[name];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/**
 * Derive device facts inside a Server Component, from `headers()`.
 *
 * `headers()` has no URL, so WITHOUT `searchParams` the launch context is
 * reported as `unknown` — never `browser`. Defaulting to `browser` here would
 * label every server render an un-installed visit and make installed-PWA
 * traffic invisible in exactly the surface most likely to be measured. Pass the
 * page's `searchParams` to get a real answer.
 */
export function deviceFromNextHeaders(
  headers: ReadonlyHeadersLike,
  opts: FromNextHeadersOptions = {},
): DeviceFacts {
  const param = opts.launchParam ?? "src";
  const marker = readParam(opts.searchParams, param);

  // Forward every header the core reads — not just the User-Agent. Dropping the
  // Client Hints here would silently downgrade `source` from "mixed" to "ua"
  // and lose the platform refinement, i.e. report a LESS reliable answer while
  // looking exactly as confident.
  const bag: Record<string, string> = {};
  for (const name of ["user-agent", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform"]) {
    const value = headers.get(name);
    if (value) bag[name] = value;
  }

  const facts = deriveDevice({
    headers: bag,
    launchCtx: marker === undefined ? undefined : (marker ?? "browser"),
    screenWidth: opts.screenWidth,
  });

  if (marker === undefined) facts.launch = "unknown";
  return facts;
}
