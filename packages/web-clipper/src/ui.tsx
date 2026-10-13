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
import type { Destination, SendResult, Target } from "./transport";
import { createClipper, type Clipper, type ClipperAuth, type ClipperOptions, type ClipperState } from "./engine";
import type { KeyValueStorage } from "./auth";

export type Lang = "da" | "en";
export const TEXT = {
  da: {
    login: "Log ind med BrobergID", loggingIn: "Logger ind…", logout: "Log ud", loginAgain: "Log ind igen",
    target: "Gem i", chooseTarget: "Vælg hvor", noTargets: "Ingen steder at gemme",
    clip: "Klip siden", clipping: "Klipper…", clipped: "Klippet", nothingNew: "Intet nyt at sende",
    consent: "Optag denne samtale", consentHint: "Optagelse er slået fra for denne samtale.",
    unavailable: "Kunne ikke nå frem — prøv igen om lidt", refused: "Afvist",
    loginFailed: "Login blev ikke gennemført",
    sent: "sendt",
    incomplete: "Ikke hele samtalen kom med",
    notAConversation: "Siden er ikke en samtale — der er intet at optage her",
  },
  en: {
    login: "Sign in with BrobergID", loggingIn: "Signing in…", logout: "Sign out", loginAgain: "Sign in again",
    target: "Save to", chooseTarget: "Choose where", noTargets: "Nowhere to save",
    clip: "Clip the page", clipping: "Clipping…", clipped: "Clipped", nothingNew: "Nothing new to send",
    consent: "Record this conversation", consentHint: "Recording is off for this conversation.",
    unavailable: "Could not get through — try again shortly", refused: "Refused",
    loginFailed: "Sign-in was not completed",
    sent: "sent",
    incomplete: "Not the whole conversation was clipped",
    notAConversation: "This page is not a conversation — there is nothing to record here",
  },
} as const;
/** Every text the popup shows; ClipperPopup's `text` overrides any of them. */
export type ClipperTexts = { [K in keyof (typeof TEXT)["da"]]: string };

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

/** The login the popup needs (same as the engine's). */
export type PopupAuth = ClipperAuth;

/** F099.8 — a text field the consumer adds to the popup (Trail: tags; Jam: a note). */
export interface ClipperField {
  id: string;
  label: string;
  placeholder?: string;
}

export function ClipperFieldInput(p: { field: ClipperField; value: string; onValue: (v: string) => void }) {
  const id = `clipper-field-${p.field.id}`;
  return (
    <label class="bwc-field" for={id}>
      <span class="bwc-field__label">{p.field.label}</span>
      <input
        id={id}
        type="text"
        class="bwc-field__input"
        data-testid={id}
        value={p.value}
        placeholder={p.field.placeholder}
        onInput={(e) => p.onValue((e.currentTarget as HTMLInputElement).value)}
      />
    </label>
  );
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
  /** F099.8 — the consumer's own fields; their values reach send() as ctx.fields and are never stored. */
  fields?: ClipperField[];
  /** F099.9 — replace any of the popup's texts, e.g. { noTargets: "Opret en organisation først" }. */
  text?: Partial<ClipperTexts>;
}

/**
 * F099.12 — the headless engine (./engine) as a Preact hook: [state, actions].
 * Draw your OWN popup on it; ClipperPopup below is just one way to draw it.
 */
export function useClipper(options: ClipperOptions): [ClipperState, Clipper] {
  const ref = useRef<Clipper | null>(null);
  if (!ref.current) ref.current = createClipper(options);
  const engine = ref.current;
  const [state, setState] = useState<ClipperState>(engine.getState());
  useEffect(() => {
    const off = engine.subscribe(setState);
    void engine.start();
    return off;
  }, []);
  return [state, engine];
}

/** The ready-made popup — optional. Built on useClipper, so it behaves exactly like a popup you draw yourself. */
export function ClipperPopup(p: ClipperPopupProps) {
  const t: ClipperTexts = { ...TEXT[p.lang ?? "da"], ...p.text };
  const [s, clipper] = useClipper({ auth: p.auth, destination: p.destination, getClip: p.getClip, storage: p.storage });
  // Component state only: tags for one page are not tags for the next, so nothing here is stored.
  const [values, setValues] = useState<Record<string, string>>({});
  const fields = () => (p.fields?.length ? Object.fromEntries(p.fields.map((f) => [f.id, values[f.id] ?? ""])) : undefined);
  const run = (consent?: boolean) => {
    const f = fields();
    void clipper.clip({ ...(consent ? { consent: true } : {}), ...(f ? { fields: f } : {}) });
  };
  const phase = s.phase;
  const loginError = phase.kind === "logged_out" ? (phase.reason === "login_again" ? t.loginAgain : phase.reason === "login_failed" ? `${t.loginFailed}: ${phase.message ?? ""}` : null) : null;
  const done = s.run.kind === "done" ? s.run : null;

  return (
    <div class="bwc-popup" data-testid="clipper-root" data-phase={phase.kind}>
      <header class="bwc-popup__head">
        <h1 class="bwc-popup__title">{p.title}</h1>
        {phase.kind === "ready" ? <ClipperButton testid="clipper-logout" onClick={() => void clipper.logout()}>{t.logout}</ClipperButton> : null}
      </header>

      {phase.kind === "checking" ? <ClipperStatus tone="busy">…</ClipperStatus> : null}

      {phase.kind === "logged_out" || phase.kind === "logging_in" ? (
        <div class="bwc-popup__body">
          {loginError ? <ClipperStatus tone="error">{loginError}</ClipperStatus> : null}
          <ClipperButton testid="clipper-login" primary busy={phase.kind === "logging_in"} onClick={() => void clipper.login()}>
            {phase.kind === "logging_in" ? t.loggingIn : t.login}
          </ClipperButton>
        </div>
      ) : null}

      {phase.kind === "ready" ? (
        <div class="bwc-popup__body">
          {s.targets && s.targets.length === 0 ? <ClipperStatus tone="error">{t.noTargets}</ClipperStatus> : null}
          {s.targets && s.targets.length > 0 ? (
            <TargetPicker targets={s.targets} value={s.target} onChange={(id) => void clipper.choose(id)} label={t.target} placeholder={t.chooseTarget} />
          ) : null}
          {p.fields?.map((f) => (
            <ClipperFieldInput key={f.id} field={f} value={values[f.id] ?? ""} onValue={(v) => setValues((cur) => ({ ...cur, [f.id]: v }))} />
          ))}
          <ClipperButton testid="clipper-clip" primary busy={s.run.kind === "clipping"} disabled={!s.target} onClick={() => run()}>
            {s.run.kind === "clipping" ? t.clipping : t.clip}
          </ClipperButton>
          {s.consentFor ? (
            <>
              <ClipperStatus tone="neutral">{t.consentHint}</ClipperStatus>
              <ClipperButton testid="clipper-consent" onClick={() => run(true)}>{t.consent}</ClipperButton>
            </>
          ) : null}
          {s.notAConversation ? (
            // Never silent (jam 13/10: «den blinker blot»): consent is per conversation, and this page is none.
            <ClipperStatus tone="error" testid="clipper-not-a-conversation">{t.notAConversation}</ClipperStatus>
          ) : null}
          {done && done.result.state !== "consent_required" ? <ResultLine result={done.result} t={t} /> : null}
          {done && done.clip.completeness?.complete === false && done.result.state === "sent" ? (
            // The owner's rule: an incomplete clip must never look complete.
            <ClipperStatus tone="error" testid="clipper-incomplete">{`${t.incomplete}. ${done.clip.completeness.reason ?? ""}`.trim()}</ClipperStatus>
          ) : null}
          {s.run.kind === "error" ? <ClipperStatus tone="error">{s.run.message}</ClipperStatus> : null}
        </div>
      ) : null}
    </div>
  );
}

function ResultLine({ result, t }: { result: SendResult; t: ClipperTexts }) {
  switch (result.state) {
    case "sent":
      return <ClipperStatus tone="ok">{result.mode === "same" ? t.nothingNew : `${t.clipped} · ${result.sent} ${t.sent}`}</ClipperStatus>;
    case "unavailable":
      return <ClipperStatus tone="error">{t.unavailable}</ClipperStatus>;
    case "refused":
      return <ClipperStatus tone="error">{`${t.refused}: ${result.message}`}</ClipperStatus>;
    default:
      return null;
  }
}

