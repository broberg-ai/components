import { expect, test } from "vitest";
import { STALE_SHELL_PARAM, STALE_SHELL_STORAGE_KEY, staleShellGuardScript } from "../src/stale-shell";

/**
 * F021.13 — ported from helpdesk apps/console/src/pwa/foraeldet-side.test.ts
 * (commit 5ca4df0). The test runs the SAME string that goes into <head> against a
 * small window with a measured replace()/reload(). A file failure is simulated the
 * way the browser reports it: an error event on the element, caught in capture.
 * helpdesk's AC4 (their own vite.config head-prepend) belongs to the app and stays
 * there; the storage-key test is the package's own addition.
 */

type Listener = (e: { target: unknown }) => void;

function win(href = "https://helpdesk.broberg.ai/?fane=indbakke", script = staleShellGuardScript()) {
  let listener: Listener | null = null;
  let reloads = 0;
  const to: string[] = [];
  const history: string[] = [];
  const store = new Map<string, string>();
  const w = {
    location: {
      href,
      origin: "https://helpdesk.broberg.ai",
      // A reload() can get the SAME stored page (helpdesk F047.6) — counted, but not the fix.
      reload: () => reloads++,
      replace: (u: string) => {
        reloads++;
        to.push(u);
      },
    },
    history: { state: null, replaceState: (_s: unknown, _t: string, u: string) => void history.push(u) },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    addEventListener: (type: string, fn: Listener, capture: boolean) => {
      if (type === "error" && capture) listener = fn;
    },
  };
  new Function("window", script)(w);
  return {
    fail: (target: unknown) => listener!({ target }),
    reloads: () => reloads,
    to,
    history,
    store,
  };
}

const scriptEl = (src: string) => ({ tagName: "SCRIPT", src, href: "" });
const cssEl = (href: string) => ({ tagName: "LINK", src: "", href });

test("a missing /assets/ script reloads the page once", () => {
  const v = win();
  v.fail(scriptEl("https://helpdesk.broberg.ai/assets/main-OLD.js"));
  expect(v.reloads()).toBe(1);
  expect(v.store.has(STALE_SHELL_STORAGE_KEY)).toBe(true);
});

test("a missing /assets/ stylesheet does the same", () => {
  const v = win();
  v.fail(cssEl("/assets/main-OLD.css"));
  expect(v.reloads()).toBe(1);
});

test("NO LOOP: two failures right after each other give exactly one reload", () => {
  const v = win();
  v.fail(scriptEl("/assets/main-OLD.js"));
  v.fail(cssEl("/assets/main-OLD.css"));
  expect(v.reloads()).toBe(1);
});

test("after the 30 s window it may reload again (otherwise it helps only once per tab)", () => {
  const v = win();
  v.store.set(STALE_SHELL_STORAGE_KEY, String(Date.now() - 31_000));
  v.fail(scriptEl("/assets/main-NEW.js"));
  expect(v.reloads()).toBe(1);
});

test("NEGATIVE CONTROL: images, foreign scripts and files outside /assets/ trigger nothing", () => {
  const v = win();
  v.fail({ tagName: "IMG", src: "/assets/logo.png" });
  v.fail(scriptEl("https://cdn.example.com/assets/x.js"));
  v.fail(scriptEl("/sw.js"));
  v.fail(scriptEl(""));
  v.fail(null);
  expect(v.reloads()).toBe(0);
});

test("the reload goes to a NEW address the browser store cannot answer", () => {
  const v = win();
  v.fail(scriptEl("/assets/main-OLD.js"));
  expect(v.to).toHaveLength(1);
  const u = new URL(v.to[0]!);
  expect(u.pathname + "?fane=" + u.searchParams.get("fane")).toBe("/?fane=indbakke");
  expect(u.searchParams.get(STALE_SHELL_PARAM)).toMatch(/^\d{13}$/);
});

test("the parameter is cleared from the address bar on the fresh page — the rest stays", () => {
  const v = win(`https://helpdesk.broberg.ai/?fane=politik&${STALE_SHELL_PARAM}=1793030000000#x`);
  expect(v.history).toEqual(["/?fane=politik#x"]);
});

test("NEGATIVE CONTROL: an address without the parameter is not touched", () => {
  const v = win("https://helpdesk.broberg.ai/?fane=politik");
  expect(v.history).toEqual([]);
});

test("a consumer's own storage key is used instead of the default (helpdesk keeps «helpdesk.genindlaest»)", () => {
  const v = win(undefined, staleShellGuardScript({ storageKey: "helpdesk.genindlaest" }));
  v.fail(scriptEl("/assets/main-OLD.js"));
  expect(v.store.has("helpdesk.genindlaest")).toBe(true);
  expect(v.store.has(STALE_SHELL_STORAGE_KEY)).toBe(false);
});
