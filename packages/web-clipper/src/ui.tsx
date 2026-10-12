/** @jsxImportSource preact */
// @broberg/web-clipper/ui — F099.6. The popup building blocks (Preact, on
// @broberg/theme tokens, no shadcn — owner decision D-7598d1), and the one
// ready popup that wires them to auth + a destination + the sender.
//
// Tokens read (all from @broberg/theme's palettes.css; no colour literal):
//   --bg --bg-card --bg-sunk --border --fg --fg-muted --hover --active
//   --accent --accent-fg --danger --success --radius
//
// Every interactive element carries a data-testid (`clipper-*`), so Lens can
// drive the popup when it is served as a page (examples/web-clipper).
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { makeOutsideClickHandler, selectKeyReducer, type SelectState } from "@broberg/ui-controls-core";
import type { Clip } from "./extract";
import { sendClip, type Destination, type SendResult, type Session, type Target } from "./transport";
import type { KeyValueStorage } from "./auth";

export type Lang = "da" | "en";
export const TEXT = {
  da: {
    login: "Log ind med Broberg ID", loggingIn: "Logger ind…", logout: "Log ud", loginAgain: "Log ind igen",
    target: "Gem i", chooseTarget: "Vælg hvor", noTargets: "Ingen steder at gemme",
    clip: "Klip siden", clipping: "Klipper…", clipped: "Klippet", nothingNew: "Intet nyt at sende",
    consent: "Optag denne samtale", consentHint: "Optagelse er slået fra for denne samtale.",
    unavailable: "Kunne ikke nå frem — prøv igen om lidt", refused: "Afvist",
    loginFailed: "Login blev ikke gennemført",
  },
  en: {
    login: "Sign in with Broberg ID", loggingIn: "Signing in…", logout: "Sign out", loginAgain: "Sign in again",
    target: "Save to", chooseTarget: "Choose where", noTargets: "Nowhere to save",
    clip: "Clip the page", clipping: "Clipping…", clipped: "Clipped", nothingNew: "Nothing new to send",
    consent: "Record this conversation", consentHint: "Recording is off for this conversation.",
    unavailable: "Could not get through — try again shortly", refused: "Refused",
    loginFailed: "Sign-in was not completed",
  },
} as const;

// ── building blocks ──────────────────────────────────────────────────────────

type Tone = "neutral" | "busy" | "ok" | "error";

export function ClipperButton(p: { testid: string; onClick: () => void; busy?: boolean; disabled?: boolean; primary?: boolean; children: ComponentChildren }) {
  return (
    <button
      type="button"
      class={"bwc-btn" + (p.primary ? " bwc-btn--primary" : "")}
      data-testid={p.testid}
      data-busy={p.busy ? "true" : undefined}
      disabled={p.disabled || p.busy}
      aria-busy={p.busy || undefined}
      onClick={p.onClick}
    >
      {p.busy ? <span class="bwc-spinner" aria-hidden="true" /> : null}
      {p.children}
    </button>
  );
}

export function ClipperStatus(p: { tone: Tone; testid?: string; children: ComponentChildren }) {
  return (
    <p class={"bwc-status is-" + p.tone} data-testid={p.testid ?? "clipper-status"} data-tone={p.tone} role={p.tone === "error" ? "alert" : "status"}>
      {p.children}
    </p>
  );
}

/** A custom listbox — never a native <select> (house rule). Keyboard via ui-controls-core. */
export function TargetPicker(p: { targets: Target[]; value: string | null; onChange: (id: string) => void; label: string; placeholder: string; testid?: string }) {
  const tid = p.testid ?? "clipper-target";
  const [state, setState] = useState<SelectState>({ open: false, highlighted: -1 });
  const root = useRef<HTMLDivElement>(null);
  const current = p.targets.find((t) => t.id === p.value) ?? null;

  useEffect(() => {
    if (!state.open) return;
    const h = makeOutsideClickHandler(() => [root.current], () => setState((s) => ({ ...s, open: false })));
    h.attach();
    return () => h.detach();
  }, [state.open]);

  const choose = (i: number) => {
    const t = p.targets[i];
    if (t) p.onChange(t.id);
    setState({ open: false, highlighted: i });
  };
  const onKey = (e: KeyboardEvent) => {
    const r = selectKeyReducer(state, e.key, p.targets.length);
    if (r.intent.type !== "none" || r.state !== state) e.preventDefault();
    setState(r.state);
    if (r.intent.type === "select") choose(r.intent.index);
  };

  return (
    <div class="bwc-picker" ref={root}>
      <span class="bwc-picker__label" id={`${tid}-label`}>{p.label}</span>
      <button
        type="button"
        class="bwc-picker__button"
        data-testid={`${tid}-button`}
        aria-haspopup="listbox"
        aria-expanded={state.open}
        aria-labelledby={`${tid}-label`}
        onClick={() => setState((s) => ({ open: !s.open, highlighted: Math.max(0, p.targets.findIndex((t) => t.id === p.value)) }))}
        onKeyDown={onKey}
      >
        <span class="bwc-picker__value">{current ? labelOf(current) : p.placeholder}</span>
        <span class="bwc-picker__chevron" aria-hidden="true">▾</span>
      </button>
      {state.open ? (
        <ul class="bwc-picker__list" role="listbox" data-testid={`${tid}-list`} aria-labelledby={`${tid}-label`}>
          {p.targets.map((t, i) => (
            <li
              key={t.id}
              role="option"
              class={"bwc-picker__option" + (i === state.highlighted ? " is-highlighted" : "")}
              aria-selected={t.id === p.value}
              data-testid={`${tid}-option-${t.id}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              {labelOf(t)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
const labelOf = (t: Target) => (t.group ? `${t.group} · ${t.label}` : t.label);

// ── the ready popup ──────────────────────────────────────────────────────────

export interface PopupAuth {
  login(): Promise<Session>;
  session(options?: { refresh?: boolean }): Promise<Session | null>;
  logout(): Promise<void>;
}

export interface ClipperPopupProps {
  title: string;
  auth: PopupAuth;
  destination: Destination;
  /** Gets the clip of the active tab — clipActiveTab(CONTENT_SCRIPT_PATH) in an extension. */
  getClip: () => Promise<Clip>;
  /** Where the chosen target and per-anchor consent are remembered (chrome.storage.local). */
  storage: KeyValueStorage;
  lang?: Lang;
}

type Phase =
  | { kind: "checking" }
  | { kind: "logged_out"; error?: string }
  | { kind: "logging_in" }
  | { kind: "ready" };
type ClipState =
  | { kind: "idle" }
  | { kind: "clipping" }
  | { kind: "done"; result: SendResult }
  | { kind: "error"; message: string };

export function ClipperPopup(p: ClipperPopupProps) {
  const t = TEXT[p.lang ?? "da"];
  const targetKey = `broberg-web-clipper:target:${p.destination.id}`;
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [clip, setClip] = useState<ClipState>({ kind: "idle" });
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  const loadTargets = async (session: Session) => {
    const list = await p.destination.targets(session);
    setTargets(list);
    const remembered = (await p.storage.get(targetKey)) as string | undefined;
    setTarget(list.some((x) => x.id === remembered) ? remembered! : list[0]?.id ?? null);
  };

  const enter = async (session: Session | null) => {
    if (!session) return setPhase({ kind: "logged_out" });
    setPhase({ kind: "ready" });
    await loadTargets(session).catch((e: unknown) => setClip({ kind: "error", message: errorText(e) }));
  };

  useEffect(() => {
    p.auth.session().then(enter, (e: unknown) => setPhase({ kind: "logged_out", error: errorText(e) }));
  }, []);

  const login = async () => {
    setPhase({ kind: "logging_in" });
    try {
      await enter(await p.auth.login());
    } catch (e) {
      setPhase({ kind: "logged_out", error: `${t.loginFailed}: ${errorText(e)}` });
    }
  };
  const logout = async () => {
    await p.auth.logout();
    setTargets(null);
    setClip({ kind: "idle" });
    setPhase({ kind: "logged_out" });
  };
  const choose = async (id: string) => {
    setTarget(id);
    await p.storage.set(targetKey, id);
  };

  const run = async (consentFor?: string) => {
    const chosen = targets?.find((x) => x.id === target);
    if (!chosen) return;
    setClip({ kind: "clipping" });
    try {
      const c = await p.getClip();
      const consentKey = c.anchor ? `broberg-web-clipper:consent:${p.destination.id}:${c.anchor}` : null;
      if (consentFor && consentKey) await p.storage.set(consentKey, true);
      const consented = consentKey ? (await p.storage.get(consentKey)) === true : false;
      const result = await sendClip({ destination: p.destination, target: chosen, clip: c, auth: p.auth, consented });
      setPendingAnchor(result.state === "consent_required" ? c.anchor ?? null : null);
      if (result.state === "login_required") setPhase({ kind: "logged_out" });
      setClip({ kind: "done", result });
    } catch (e) {
      setClip({ kind: "error", message: errorText(e) });
    }
  };

  return (
    <div class="bwc-popup" data-testid="clipper-root" data-phase={phase.kind}>
      <header class="bwc-popup__head">
        <h1 class="bwc-popup__title">{p.title}</h1>
        {phase.kind === "ready" ? <ClipperButton testid="clipper-logout" onClick={() => void logout()}>{t.logout}</ClipperButton> : null}
      </header>

      {phase.kind === "checking" ? <ClipperStatus tone="busy">…</ClipperStatus> : null}

      {phase.kind === "logged_out" || phase.kind === "logging_in" ? (
        <div class="bwc-popup__body">
          {clip.kind === "done" && clip.result.state === "login_required" ? <ClipperStatus tone="error">{t.loginAgain}</ClipperStatus> : null}
          {phase.kind === "logged_out" && phase.error ? <ClipperStatus tone="error">{phase.error}</ClipperStatus> : null}
          <ClipperButton testid="clipper-login" primary busy={phase.kind === "logging_in"} onClick={() => void login()}>
            {phase.kind === "logging_in" ? t.loggingIn : t.login}
          </ClipperButton>
        </div>
      ) : null}

      {phase.kind === "ready" ? (
        <div class="bwc-popup__body">
          {targets && targets.length === 0 ? <ClipperStatus tone="error">{t.noTargets}</ClipperStatus> : null}
          {targets && targets.length > 0 ? (
            <TargetPicker targets={targets} value={target} onChange={(id) => void choose(id)} label={t.target} placeholder={t.chooseTarget} />
          ) : null}
          <ClipperButton testid="clipper-clip" primary busy={clip.kind === "clipping"} disabled={!target} onClick={() => void run()}>
            {clip.kind === "clipping" ? t.clipping : t.clip}
          </ClipperButton>
          {pendingAnchor ? (
            <>
              <ClipperStatus tone="neutral">{t.consentHint}</ClipperStatus>
              <ClipperButton testid="clipper-consent" onClick={() => void run(pendingAnchor)}>{t.consent}</ClipperButton>
            </>
          ) : null}
          {clip.kind === "done" && clip.result.state !== "consent_required" ? <ResultLine result={clip.result} t={t} /> : null}
          {clip.kind === "error" ? <ClipperStatus tone="error">{clip.message}</ClipperStatus> : null}
        </div>
      ) : null}
    </div>
  );
}

function ResultLine({ result, t }: { result: SendResult; t: (typeof TEXT)[Lang] }) {
  switch (result.state) {
    case "sent":
      return <ClipperStatus tone="ok">{result.mode === "same" ? t.nothingNew : t.clipped}</ClipperStatus>;
    case "unavailable":
      return <ClipperStatus tone="error">{t.unavailable}</ClipperStatus>;
    case "refused":
      return <ClipperStatus tone="error">{`${t.refused}: ${result.message}`}</ClipperStatus>;
    default:
      return null;
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
