// @broberg/web-clipper/engine — F099.12. The clipper WITHOUT a face.
//
// Owner, 13/10: «Design skal styres af det site der ejer Web Clipper — du skal
// tage dig af backend og data». So this is everything the popup DOES and none
// of what it LOOKS like: log in, load the places to save, remember the chosen
// one, clip, ask for consent per conversation, send, and say what happened.
// No element, no CSS, no text — a state you read and actions you call. Draw it
// however your extension wants (Preact via useClipper in /ui, React, plain DOM).
//
// The ready-made ClipperPopup in /ui is built on this same engine, so the
// reference popup and your own can never behave differently.
import type { Clip } from "./extract";
import { sendClip, type Destination, type SendResult, type Session, type Target } from "./transport";
import type { KeyValueStorage } from "./auth";

/** The login the clipper needs — createBidAuth / popupAuth fit as they are. */
export interface ClipperAuth {
  login(): Promise<Session>;
  session(options?: { refresh?: boolean }): Promise<Session | null>;
  logout(): Promise<void>;
}

export interface ClipperOptions {
  auth: ClipperAuth;
  destination: Destination;
  /** Gets the clip of the active tab — clipActiveTab(CONTENT_SCRIPT_PATH) in an extension. */
  getClip: () => Promise<Clip>;
  /** Where the chosen target and per-conversation consent are remembered (chrome.storage.local). */
  storage: KeyValueStorage;
}

export type ClipperPhase =
  /** Asking whether someone is already logged in. */
  | { kind: "checking" }
  /** reason "login_again": the session ended (a 401 that a refresh did not cure). "login_failed": the login itself failed, see `message`. */
  | { kind: "logged_out"; reason?: "login_again" | "login_failed"; message?: string }
  | { kind: "logging_in" }
  | { kind: "ready" };

export type ClipperRun =
  | { kind: "idle" }
  | { kind: "clipping" }
  /** `clip` is what was sent: read clip.completeness to tell the person if it was not everything. */
  | { kind: "done"; result: SendResult; clip: Clip }
  | { kind: "error"; message: string };

export interface ClipperState {
  phase: ClipperPhase;
  /** null until loaded; [] means the person has nowhere to save. */
  targets: Target[] | null;
  /** The chosen target's id (remembered per destination). */
  target: string | null;
  run: ClipperRun;
  /** Recording must be switched on for this conversation before anything is sent — call clip({ consent: true }). */
  consentFor: string | null;
  /** consent_required on a page that is no conversation: there is nothing to switch on. Say so; never blink. */
  notAConversation: boolean;
}

export interface Clipper {
  getState(): ClipperState;
  /** Called on every change; returns an unsubscribe. */
  subscribe(fn: (s: ClipperState) => void): () => void;
  /** Check for an existing login and load the targets. Call once when the popup opens. */
  start(): Promise<void>;
  login(): Promise<void>;
  logout(): Promise<void>;
  choose(targetId: string): Promise<void>;
  /** Clip the page and send it. `consent: true` switches recording on for this conversation first. `fields` reach send() as ctx.fields. */
  clip(options?: { consent?: boolean; fields?: Record<string, string> }): Promise<void>;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createClipper(o: ClipperOptions): Clipper {
  const targetKey = `broberg-web-clipper:target:${o.destination.id}`;
  let state: ClipperState = { phase: { kind: "checking" }, targets: null, target: null, run: { kind: "idle" }, consentFor: null, notAConversation: false };
  const listeners = new Set<(s: ClipperState) => void>();
  const set = (patch: Partial<ClipperState>) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  };

  const loadTargets = async (session: Session) => {
    const list = await o.destination.targets(session);
    const remembered = (await o.storage.get(targetKey)) as string | undefined;
    set({ targets: list, target: list.some((x) => x.id === remembered) ? remembered! : list[0]?.id ?? null });
  };

  const enter = async (session: Session | null) => {
    if (!session) return set({ phase: { kind: "logged_out" } });
    set({ phase: { kind: "ready" } });
    try {
      await loadTargets(session);
    } catch (e) {
      // The same rule as sending: a 401 is the login, refreshed once; anything else is an error to show.
      if (e instanceof Error && (e as { status?: number }).status === 401) {
        const fresh = await o.auth.session({ refresh: true }).catch(() => null);
        if (fresh) return loadTargets(fresh).catch((e2: unknown) => set({ run: { kind: "error", message: errorText(e2) } }));
        return set({ phase: { kind: "logged_out", reason: "login_again" } });
      }
      set({ run: { kind: "error", message: errorText(e) } });
    }
  };

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async start() {
      try {
        await enter(await o.auth.session());
      } catch (e) {
        set({ phase: { kind: "logged_out", reason: "login_failed", message: errorText(e) } });
      }
    },
    async login() {
      set({ phase: { kind: "logging_in" } });
      try {
        await enter(await o.auth.login());
      } catch (e) {
        set({ phase: { kind: "logged_out", reason: "login_failed", message: errorText(e) } });
      }
    },
    async logout() {
      await o.auth.logout();
      set({ targets: null, run: { kind: "idle" }, consentFor: null, notAConversation: false, phase: { kind: "logged_out" } });
    },
    async choose(id) {
      set({ target: id });
      await o.storage.set(targetKey, id);
    },
    async clip(options = {}) {
      const chosen = state.targets?.find((x) => x.id === state.target);
      if (!chosen) return;
      set({ run: { kind: "clipping" }, notAConversation: false });
      try {
        const c = await o.getClip();
        const consentKey = c.anchor ? `broberg-web-clipper:consent:${o.destination.id}:${c.anchor}` : null;
        if (options.consent && consentKey) await o.storage.set(consentKey, true);
        const consented = consentKey ? (await o.storage.get(consentKey)) === true : false;
        const result = await sendClip({ destination: o.destination, target: chosen, clip: c, auth: o.auth, consented, ...(options.fields ? { fields: options.fields } : {}) });
        const needsConsent = result.state === "consent_required";
        set({
          run: { kind: "done", result, clip: c },
          consentFor: needsConsent ? c.anchor ?? null : null,
          notAConversation: needsConsent && !c.anchor,
          ...(result.state === "login_required" ? { phase: { kind: "logged_out", reason: "login_again" } } : {}),
        });
      } catch (e) {
        set({ run: { kind: "error", message: errorText(e) } });
      }
    },
  };
}
