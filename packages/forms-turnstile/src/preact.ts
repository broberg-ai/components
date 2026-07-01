/**
 * Preact adapter — a lazy-loading Turnstile widget hook (Stack B). Ports the
 * loadTurnstile/render pattern proven in xrt81's KomIGang.tsx lead form.
 */

import { useEffect, useRef, useState } from "preact/hooks";

interface TurnstileGlobal {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

function getTurnstileGlobal(): TurnstileGlobal | undefined {
  return (window as unknown as { turnstile?: TurnstileGlobal }).turnstile;
}

/** Load the Cloudflare Turnstile script once (cached + deduped across
 *  multiple widget renders on the same page) and resolve when window.turnstile
 *  is available. */
function loadTurnstileScript(): Promise<void> {
  if (getTurnstileGlobal()) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
  if (existing) {
    return new Promise((resolve) => existing.addEventListener("load", () => resolve(), { once: true }));
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.setAttribute("data-turnstile", "1");
    s.addEventListener("load", () => resolve(), { once: true });
    s.addEventListener("error", () => reject(new Error("turnstile script load failed")), { once: true });
    document.head.appendChild(s);
  });
}

export interface UseTurnstileResult {
  /** Attach to the container element the widget renders into. */
  widgetRef: { current: HTMLDivElement | null };
  /** The current verification token — empty string until solved. */
  token: string;
  /** Reset the widget (e.g. after a failed submit) — clears the token too. */
  reset: () => void;
}

/** Lazy-loads the Turnstile script + renders the widget into `widgetRef`'s
 *  container once `siteKey` is available. Pass null/undefined to defer
 *  rendering (e.g. while a runtime /config fetch is still in flight). */
export function useTurnstile(siteKey: string | null | undefined): UseTurnstileResult {
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    (async () => {
      try {
        await loadTurnstileScript();
      } catch {
        return;
      }
      if (cancelled || widgetIdRef.current || !widgetRef.current) return;
      const ts = getTurnstileGlobal();
      if (!ts) return;
      widgetIdRef.current = ts.render(widgetRef.current, {
        sitekey: siteKey,
        callback: (tok: string) => setToken(tok),
        "expired-callback": () => setToken(""),
        "error-callback": () => setToken(""),
      });
    })();
    return () => {
      cancelled = true;
      const ts = getTurnstileGlobal();
      if (ts && widgetIdRef.current) ts.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [siteKey]);

  const reset = () => {
    const ts = getTurnstileGlobal();
    if (ts && widgetIdRef.current) ts.reset(widgetIdRef.current);
    setToken("");
  };

  return { widgetRef, token, reset };
}
