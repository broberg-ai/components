/**
 * A STALE PAGE RELOADS ITSELF — ONCE (F021.13).
 *
 * PORTED, NOT REWRITTEN: helpdesk's apps/console/src/pwa/foraeldet-side.ts
 * (helpdesk F047.5/F047.6, commit 5ca4df0, verified in production in chromium
 * and webkit). The script below is theirs line for line; the only change is
 * that the sessionStorage key is a parameter (default generic, so helpdesk can
 * keep its own "helpdesk.genindlaest").
 *
 * Christian 26/10: «Hver gang jeg starter pwa og der måske er kommet en
 * opdatering så får jeg bare en kæmpe hvid skærm».
 *
 * On start the browser shows its stored copy of the page. After a deploy that
 * copy points at /assets/ files that no longer exist (404), and nothing is drawn
 * — not even the theme's background. This guard sits in <head> BEFORE the app
 * script, notices that one of OUR OWN files failed to load, and reloads.
 *
 * THE RELOAD GOES TO A NEW ADDRESS. A plain reload() can get the SAME stored
 * page from the browser's store, so it navigates to `?_v=<time>` — an address
 * the store has never seen — and clears the parameter again on the fresh page.
 *
 * Only once per 30 s (sessionStorage), so a real outage does not become a loop.
 * Only our own same-origin /assets/ scripts and stylesheets: a failing image or a
 * foreign script is not a stale page.
 *
 * The string IS the guard: put it first in <head> (Vite: transformIndexHtml with
 * injectTo "head-prepend"; Next: a beforeInteractive inline script), and the
 * tests run the same string.
 *
 * Complements @broberg/deploy-core F033.20, which serves old hashed assets from
 * kept deploys on Fly Live; this covers every other host.
 */
export const STALE_SHELL_STORAGE_KEY = "broberg.pwa.stale-reload";
export const STALE_SHELL_WINDOW_MS = 30_000;
export const STALE_SHELL_PARAM = "_v";

export const staleShellGuardScript = (opts: { storageKey?: string } = {}): string => {
  const key = opts.storageKey ?? STALE_SHELL_STORAGE_KEY;
  return `(function (w) {
  try {
    var her = new URL(w.location.href);
    if (her.searchParams.has(${JSON.stringify(STALE_SHELL_PARAM)})) {
      her.searchParams.delete(${JSON.stringify(STALE_SHELL_PARAM)});
      w.history.replaceState(w.history.state, "", her.pathname + her.search + her.hash);
    }
  } catch (_) {}
  w.addEventListener("error", function (e) {
    var t = e.target;
    if (!t || (t.tagName !== "SCRIPT" && t.tagName !== "LINK")) return;
    var url;
    try { url = new URL(t.src || t.href, w.location.href); } catch (_) { return; }
    if (url.origin !== w.location.origin || url.pathname.indexOf("/assets/") !== 0) return;
    try {
      var sidst = Number(w.sessionStorage.getItem(${JSON.stringify(key)}) || 0);
      if (Date.now() - sidst < ${STALE_SHELL_WINDOW_MS}) return;
      w.sessionStorage.setItem(${JSON.stringify(key)}, String(Date.now()));
    } catch (_) { return; }
    try {
      var frisk = new URL(w.location.href);
      frisk.searchParams.set(${JSON.stringify(STALE_SHELL_PARAM)}, String(Date.now()));
      w.location.replace(frisk.toString());
    } catch (_) { w.location.reload(); }
  }, true);
})(window);`;
};
