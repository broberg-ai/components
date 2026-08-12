/**
 * The Turnstile widget hook, written ONCE.
 *
 * React and Preact differ in exactly one thing here: where `useRef`/`useState`/
 * `useEffect` are imported from. Everything else — the lazy script load, the
 * `data-turnstile` dedup, explicit render, the expired/error callbacks, cleanup
 * via `ts.remove`, `reset()` — is plain DOM work that touches nothing
 * framework-specific. fd-sundhed unpacked 0.1.0 and reached the same conclusion
 * before asking for a React export, which is why this is a shared core with two
 * three-line adapters rather than two copies of ninety lines.
 *
 * The hooks arrive as an argument. That looks unusual, but the alternative is
 * maintaining the same logic in two files forever, and a fix applied to one of
 * them is the drift the reuse rule exists to prevent. Consumers still call a
 * plain `useTurnstile(siteKey)`; the indirection is invisible to them and to
 * their rules-of-hooks lint, because the adapters ship compiled.
 */

/** The three hooks this needs, in whichever dialect the host app speaks. */
export interface HooksApi {
  useRef: <T>(initial: T) => { current: T };
  useState: <T>(initial: T) => [T, (next: T) => void];
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => void;
}

interface TurnstileGlobal {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

function getTurnstileGlobal(): TurnstileGlobal | undefined {
  return (window as unknown as { turnstile?: TurnstileGlobal }).turnstile;
}

/**
 * Load the Cloudflare Turnstile script once, deduped across multiple widgets on
 * the same page, and resolve when `window.turnstile` exists.
 *
 * Rejects rather than resolving on failure — the caller needs to be able to tell
 * the difference, which before v0.2.0 it could not.
 */
function loadTurnstileScript(): Promise<void> {
  if (getTurnstileGlobal()) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      // A second widget must not hang forever because the FIRST one's script
      // tag failed. Before this, the shared tag only ever resolved.
      existing.addEventListener("error", () => reject(new Error("turnstile script load failed")), {
        once: true,
      });
    });
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

/**
 * What the widget is doing — so a form can tell "the user has not solved it yet"
 * from "this will never work".
 *
 * Before v0.2.0 both showed up as `token === ""`, so a blocked script produced a
 * submit button that never enabled and nothing anywhere said why. Turnstile is
 * blocked by ordinary privacy extensions often enough that this is a normal
 * user's experience, not an edge case.
 */
export type TurnstileStatus = "loading" | "ready" | "solved" | "failed";

export interface UseTurnstileResult {
  /** Attach to the container element the widget renders into. */
  widgetRef: { current: HTMLDivElement | null };
  /** The current verification token — empty string until solved. */
  token: string;
  /**
   * Where the widget is. GATE YOUR SUBMIT BUTTON ON THIS, not on `token`: an
   * empty token has two causes and only one of them is the user's.
   */
  status: TurnstileStatus;
  /** Why it failed, when it did — an ad-blocker and a bad site key look the
   *  same from the outside otherwise. Undefined unless status is 'failed'. */
  error?: string;
  /** Reset the widget (e.g. after a failed submit) — clears the token too. */
  reset: () => void;
}

/**
 * Build a `useTurnstile` bound to one framework's hooks.
 *
 * Lazy-loads the Turnstile script and renders the widget into `widgetRef`'s
 * container once `siteKey` is available. Pass null/undefined to defer rendering
 * (e.g. while a runtime /config fetch is still in flight) — that reads as
 * `loading`, since from a form's point of view it is not usable yet.
 */
export function createUseTurnstile(hooks: HooksApi) {
  const { useRef, useState, useEffect } = hooks;

  return function useTurnstile(siteKey: string | null | undefined): UseTurnstileResult {
    const widgetRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [token, setToken] = useState("");
    const [status, setStatus] = useState<TurnstileStatus>("loading");
    const [error, setError] = useState<string | undefined>(undefined);

    const fail = (why: string) => {
      setStatus("failed");
      setError(why);
    };

    useEffect(() => {
      if (!siteKey) return;
      let cancelled = false;
      void (async () => {
        try {
          await loadTurnstileScript();
        } catch (err) {
          // Was `catch { return }`. The hook then sat at token:"" forever, which
          // a caller cannot tell from an unsolved widget. THIS is the defect
          // fd-sundhed filed.
          if (!cancelled) fail(err instanceof Error ? err.message : "turnstile script load failed");
          return;
        }
        if (cancelled || widgetIdRef.current) return;
        if (!widgetRef.current) {
          // A permanent condition, not a transient one: the effect only re-runs
          // when siteKey changes, so if the container is missing now the widget
          // never renders. Silence here meant a form that could not be
          // submitted and gave no reason.
          fail("widgetRef was never attached to an element");
          return;
        }
        const ts = getTurnstileGlobal();
        if (!ts) {
          // The sneakiest of the three: the script LOADED, so nothing looks
          // wrong from the network's side, but the global never appeared.
          fail("turnstile script loaded but window.turnstile is undefined");
          return;
        }
        widgetIdRef.current = ts.render(widgetRef.current, {
          sitekey: siteKey,
          callback: (tok: string) => {
            setToken(tok);
            setStatus("solved");
          },
          // Expiry is not a failure — the challenge worked and simply aged out,
          // and Turnstile refreshes it. Back to 'ready', not 'failed'.
          "expired-callback": () => {
            setToken("");
            setStatus("ready");
          },
          "error-callback": () => {
            setToken("");
            fail("turnstile challenge reported an error");
          },
        });
        setStatus("ready");
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
      // Back to 'ready', not 'loading' — the script is still there. Resetting a
      // widget that failed to load cannot repair it, so a failure stays a
      // failure rather than being laundered into a hopeful state.
      if (widgetIdRef.current) {
        setStatus("ready");
        setError(undefined);
      }
    };

    return { widgetRef, token, status, error, reset };
  };
}
