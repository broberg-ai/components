/**
 * F067.2 — does a built service worker register more than ONE push handler?
 *
 * `addEventListener('push', …)` is additive AND silent: a second handler you did
 * not write — inherited from a PWA template, or registered by another package —
 * means every push shows TWO banners, with no error anywhere. Whoever tests on
 * their own phone sees it at once; whoever reads a log never does (beacon #19861,
 * upmetrics #19860; xrt81 solved it locally with two tests).
 *
 * PURE and offline: give it the built worker's SOURCE TEXT (read the file in
 * your own test) and it answers how many push registrations it finds and WHERE.
 * It runs nothing and patches nothing.
 *
 * It finds what a bundler leaves as text: `addEventListener("push", …)` in any
 * quote style, and `onpush =` assignments. It cannot see a handler registered
 * through an indirection the text does not show (an event name built at
 * runtime) — a static check of source, said plainly rather than implied.
 */
export interface PushHandlerSite {
  /** 1-based line in the source. */
  line: number;
  /** 1-based column. */
  column: number;
  /** Character offset — useful in a minified one-line bundle. */
  offset: number;
  /** The matched text plus a little context, for the error message. */
  snippet: string;
}

export interface PushHandlerReport {
  count: number;
  sites: PushHandlerSite[];
}

const REGISTRATION = /addEventListener\s*\(\s*(["'`])push\1|\bonpush\s*=(?!=)/g;

export function findPushHandlers(source: string): PushHandlerReport {
  const sites: PushHandlerSite[] = [];
  for (const m of source.matchAll(REGISTRATION)) {
    const offset = m.index ?? 0;
    const before = source.slice(0, offset);
    const line = before.split("\n").length;
    const column = offset - before.lastIndexOf("\n");
    const start = Math.max(0, offset - 30);
    sites.push({ line, column, offset, snippet: source.slice(start, offset + m[0].length + 30).replace(/\s+/g, " ") });
  }
  return { count: sites.length, sites };
}
