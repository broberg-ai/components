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
import type { EmbeddedLogin, EmbeddedState, KeyValueStorage } from "./auth";

export type Lang = "da" | "en";
export const TEXT = {
  da: {
    login: "Log ind med BID", loggingIn: "Logger ind…", logout: "Log ud", loginAgain: "Log ind igen",
    target: "Gem i", chooseTarget: "Vælg hvor", noTargets: "Ingen steder at gemme",
    clip: "Klip siden", clipping: "Klipper…", clipped: "Klippet", nothingNew: "Intet nyt at sende",
    consent: "Optag denne samtale", consentHint: "Optagelse er slået fra for denne samtale.",
    unavailable: "Kunne ikke nå frem — prøv igen om lidt", refused: "Afvist",
    loginFailed: "Login blev ikke gennemført",
    sent: "sendt",
    incomplete: "Ikke hele samtalen kom med",
    filesMissing: "Alle ture er gemt — {n} filer mangler",
    notAConversation: "Siden er ikke en samtale — der er intet at optage her",
    // F099.24 — the embedded login (BID mockup 01a1409a)
    elTitle: "Log ind for at gemme klip",
    elLead: "Med dit BID. Vi sender en engangskode til din mail — du skal ikke bruge din adgangskode her.",
    elEmail: "Mailadresse", elEmailPlaceholder: "navn@firma.dk", elSend: "Send kode", elSending: "Sender kode…",
    elCheckMail: "Tjek din mail", elSentTo: "Vi har sendt en kode til {email}. Den virker i 10 minutter.",
    elCode: "Kode", elVerify: "Log ind", elVerifying: "Logger ind…", elResend: "Send ny kode", elChangeEmail: "Anden mail",
    el2faTitle: "Bekræft det er dig", el2faLead: "Din konto har tofaktor slået til. Skriv koden fra din godkendelses-app.",
    el2faLeadSms: "Vi har sendt en kode på SMS.", el2faCode: "Kode fra app", el2faCodeSms: "Kode fra SMS", el2faVerify: "Bekræft", el2faSms: "Send en SMS i stedet",
    elBadCode: "Koden passer ikke. Prøv igen, eller få en ny kode.", elAttemptsLeft: "{n} forsøg tilbage.",
    elExpired: "Koden er udløbet. Få en ny kode.",
    elLockedTitle: "Vent lidt", elLocked: "Der er prøvet for mange koder. Af hensyn til din konto kan du prøve igen om {min} minutter.",
    elOfflineTitle: "Ingen forbindelse", elOffline: "Kan ikke nå BID lige nu. Tjek din internetforbindelse.", elRetry: "Prøv igen",
    elInvalid: "Noget gik galt. Prøv igen.", elSecured: "Secured by",
    // F099.26 — passkey first (BID mockup 01a1409a v2)
    elPasskeyLead: "Med Face ID, fingeraftryk eller din telefon — uden at forlade udvidelsen.", elPasskeyFrame: "Log ind med adgangsnøgle",
    elOther: "Andre muligheder", elMailCode: "Få en kode på mail", elBackPasskey: "← Log ind med adgangsnøgle",
    elPasskeyNotFound: "Der er ingen adgangsnøgle til BID på denne enhed. Få en kode på mail under «Andre muligheder».",
    elPasskeyFailed: "Adgangsnøglen virkede ikke. Prøv igen, eller få en kode på mail.",
  },
  en: {
    login: "Sign in with BID", loggingIn: "Signing in…", logout: "Sign out", loginAgain: "Sign in again",
    target: "Save to", chooseTarget: "Choose where", noTargets: "Nowhere to save",
    clip: "Clip the page", clipping: "Clipping…", clipped: "Clipped", nothingNew: "Nothing new to send",
    consent: "Record this conversation", consentHint: "Recording is off for this conversation.",
    unavailable: "Could not get through — try again shortly", refused: "Refused",
    loginFailed: "Sign-in was not completed",
    sent: "sent",
    filesMissing: "Every turn was saved — {n} files are missing",
    incomplete: "Not the whole conversation was clipped",
    notAConversation: "This page is not a conversation — there is nothing to record here",
    elTitle: "Sign in to save clips",
    elLead: "With your BID. We send a one-time code to your mail — no password here.",
    elEmail: "Email address", elEmailPlaceholder: "name@company.com", elSend: "Send code", elSending: "Sending code…",
    elCheckMail: "Check your mail", elSentTo: "We sent a code to {email}. It works for 10 minutes.",
    elCode: "Code", elVerify: "Sign in", elVerifying: "Signing in…", elResend: "Send a new code", elChangeEmail: "Other email",
    el2faTitle: "Confirm it is you", el2faLead: "Your account has two-factor on. Enter the code from your authenticator app.",
    el2faLeadSms: "We sent a code by SMS.", el2faCode: "Code from app", el2faCodeSms: "Code from SMS", el2faVerify: "Confirm", el2faSms: "Send an SMS instead",
    elBadCode: "That code is not right. Try again, or get a new code.", elAttemptsLeft: "{n} attempts left.",
    elExpired: "The code has expired. Get a new code.",
    elLockedTitle: "Hold on", elLocked: "Too many codes were tried. To protect your account, try again in {min} minutes.",
    elOfflineTitle: "No connection", elOffline: "BID cannot be reached right now. Check your connection.", elRetry: "Try again",
    elInvalid: "Something went wrong. Try again.", elSecured: "Secured by",
    elPasskeyLead: "With Face ID, fingerprint or your phone — without leaving the extension.", elPasskeyFrame: "Sign in with a passkey",
    elOther: "Other options", elMailCode: "Get a code by mail", elBackPasskey: "← Sign in with a passkey",
    elPasskeyNotFound: "There is no BID passkey on this device. Get a code by mail under «Other options».",
    elPasskeyFailed: "The passkey did not work. Try again, or get a code by mail.",
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

// ── the embedded login (F099.24) ─────────────────────────────────────────────

/** Six one-digit boxes; typing moves on, Backspace moves back, pasting a whole code fills them all. */
export function CodeInput(p: { testid: string; label: string; value: string; onValue: (v: string) => void; bad?: boolean; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => p.value[i] ?? "");
  const put = (from: number, text: string) => {
    const clean = text.replace(/\D/g, "");
    if (!clean) return;
    const next = (p.value.slice(0, from) + clean).slice(0, 6);
    p.onValue(next);
    refs.current[Math.min(next.length, 5)]?.focus();
  };
  return (
    <div class="bwc-field">
      <span class="bwc-field__label" id={`${p.testid}-label`}>{p.label}</span>
      <div class={"bwc-code" + (p.bad ? " is-bad" : "")} data-testid={p.testid} role="group" aria-labelledby={`${p.testid}-label`}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            class="bwc-code__box"
            data-testid={`${p.testid}-${i}`}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            // No maxLength: autofill of a one-time code (and a typed/filled whole code) lands in box 0 as ALL
            // six digits; maxLength=1 cut it to one (measured by Lens 15/10). put() spreads them instead.
            value={d}
            disabled={p.disabled}
            aria-label={`${p.label} ${i + 1}`}
            onInput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              if (v.length > 1) return put(i, v);
              if (/\d/.test(v)) put(i, v);
              else p.onValue(p.value.slice(0, i));
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !digits[i] && i > 0) {
                p.onValue(p.value.slice(0, i - 1));
                refs.current[i - 1]?.focus();
              }
            }}
            onPaste={(e) => {
              e.preventDefault();
              put(i, e.clipboardData?.getData("text") ?? "");
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** The step's error in words; null when there is none. */
function errorWords(state: EmbeddedState, t: ClipperTexts): string | null {
  const e = state.error;
  if (!e) return null;
  switch (e.kind) {
    case "invalid_code":
      return e.attemptsLeft !== undefined ? `${t.elBadCode} ${t.elAttemptsLeft.replace("{n}", String(e.attemptsLeft))}` : t.elBadCode;
    case "expired":
      return t.elExpired;
    case "invalid_request":
      return t.elInvalid;
    case "passkey":
      return e.reason === "not_found" ? t.elPasskeyNotFound : e.reason === "failed" ? t.elPasskeyFailed : null;
    default:
      return null; // locked / too_many / unavailable / not_embedded have their own screens
  }
}

/**
 * F099.24 — the embedded login as a screen (BID's mockup 01a1409a): mail → code → second factor.
 * F099.26 — mockup v2: it opens on the passkey (BID's frame), the mail code under «Andre muligheder»;
 * a client BID gives no passkey gets the mail screen straight away.
 * ONE way to draw auth.embedded(); draw your own on the same engine if your popup looks different.
 * Calls `onSignedIn` once the session is stored; `onFallback` when BID says this client may not
 * log in here (fall back to the login window).
 */
export function EmbeddedLoginForm(p: { login: EmbeddedLogin; lang?: Lang; text?: Partial<ClipperTexts>; onSignedIn: () => void; onFallback?: () => void }) {
  const t: ClipperTexts = { ...TEXT[p.lang ?? "da"], ...p.text };
  const [s, setS] = useState<EmbeddedState>(p.login.state());
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // F099.26 — «Andre muligheder» is open; and whether BID has a passkey for this client at all.
  const [other, setOther] = useState(false);
  const passkeyOff = useRef(false);
  if (s.error?.kind === "passkey" && s.error.reason === "not_enabled") passkeyOff.current = true;
  // True from mount until we know where to stand, and while a passkey flow is being started — so the
  // mail screen never flashes before the frame.
  const [starting, setStarting] = useState(true);
  const passkey = async () => {
    setOther(false);
    if (p.login.state().step === "passkey") return;
    setStarting(true);
    await p.login.passkeyStart();
    setStarting(false);
  };
  useEffect(() => {
    const off = p.login.subscribe(setS);
    void p.login.resume().then(async (r) => {
      if (r.step === "email" && (!r.error || r.error.kind === "expired")) await p.login.passkeyStart();
      setStarting(false);
    });
    return off;
  }, [p.login]);
  useEffect(() => {
    if (s.step === "signed_in") p.onSignedIn();
    if (s.error?.kind === "not_embedded") p.onFallback?.();
    if (s.step !== "code" && s.step !== "second_factor") setCode("");
  }, [s.step, s.error?.kind]);

  const err = errorWords(s, t);
  const brand = (
    <div class="bwc-bid">
      <span class="bwc-bid__mark">B<span class="bwc-bid__id">ID</span></span>
    </div>
  );
  const secured = (
    <p class="bwc-bid__secured">
      {t.elSecured} <b>B<span class="bwc-bid__id">ID</span></b>
    </p>
  );
  const wait = s.error && (s.error.kind === "locked" || s.error.kind === "too_many_requests") ? s.error : null;

  if (wait) {
    const min = Math.max(1, Math.ceil((wait.retryAfter ?? 600) / 60));
    return (
      <div class="bwc-login" data-testid="embedded-login-denied">
        {brand}
        <h2 class="bwc-login__title">{t.elLockedTitle}</h2>
        <ClipperStatus tone="error" testid="embedded-login-error">{t.elLocked.replace("{min}", String(min))}</ClipperStatus>
        <ClipperButton testid="embedded-login-restart" onClick={() => void p.login.restart()}>{t.elChangeEmail}</ClipperButton>
        {secured}
      </div>
    );
  }
  if (s.error?.kind === "unavailable") {
    return (
      <div class="bwc-login" data-testid="embedded-login-offline">
        {brand}
        <h2 class="bwc-login__title">{t.elOfflineTitle}</h2>
        <p class="bwc-login__lead">{t.elOffline}</p>
        <ClipperButton testid="embedded-login-retry" primary onClick={() => void p.login.resume()}>{t.elRetry}</ClipperButton>
        {secured}
      </div>
    );
  }
  if ((s.step === "passkey" && !other) || (starting && s.step === "email" && !passkeyOff.current)) {
    return (
      <div class="bwc-login" data-testid="embedded-login-passkey">
        {brand}
        <h2 class="bwc-login__title">{t.elTitle}</h2>
        <p class="bwc-login__lead">{t.elPasskeyLead}</p>
        {s.step === "passkey" && !s.busy ? (
          <iframe class="bwc-passkey-frame" data-testid="embedded-login-passkey-frame" src={s.frameUrl} allow="publickey-credentials-get" title={t.elPasskeyFrame} />
        ) : (
          <ClipperStatus tone="busy" testid="embedded-login-passkey-busy">{s.step === "passkey" ? t.elVerifying : "…"}</ClipperStatus>
        )}
        {err ? <ClipperStatus tone="error" testid="embedded-login-error">{err}</ClipperStatus> : null}
        <div class="bwc-login__links bwc-login__links--center">
          <ClipperButton testid="embedded-login-other-options" disabled={s.busy} onClick={() => setOther(true)}>{t.elOther}</ClipperButton>
        </div>
        {secured}
      </div>
    );
  }
  if (s.step === "email" || s.step === "passkey") {
    const ok = /.+@.+\..+/.test(email.trim());
    const v1 = passkeyOff.current; // no passkey for this client: the mail screen IS the login
    const mailErr = s.error?.kind === "passkey" ? null : err; // a passkey error belongs to the passkey screen
    return (
      <form class="bwc-login" data-testid="embedded-login-email" onSubmit={(e) => { e.preventDefault(); if (ok && !s.busy) void p.login.start(email.trim()); }}>
        {brand}
        <h2 class="bwc-login__title">{v1 ? t.elTitle : t.elOther}</h2>
        {v1 ? <p class="bwc-login__lead">{t.elLead}</p> : null}
        <label class="bwc-field" for="embedded-login-email-input">
          <span class="bwc-field__label">{v1 ? t.elEmail : t.elMailCode}</span>
          <input id="embedded-login-email-input" class="bwc-field__input" data-testid="embedded-login-email-input" type="email" autoComplete="email" placeholder={t.elEmailPlaceholder} value={email} disabled={s.busy} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} />
        </label>
        {mailErr ? <ClipperStatus tone="error" testid="embedded-login-error">{mailErr}</ClipperStatus> : null}
        <ClipperButton testid="embedded-login-send-code" primary busy={s.busy} disabled={!ok || s.busy} onClick={() => void p.login.start(email.trim())}>
          {s.busy ? t.elSending : t.elSend}
        </ClipperButton>
        {v1 ? null : (
          <div class="bwc-login__links bwc-login__links--center">
            <ClipperButton testid="embedded-login-back-passkey" disabled={s.busy} onClick={() => void passkey()}>{t.elBackPasskey}</ClipperButton>
          </div>
        )}
        {secured}
      </form>
    );
  }
  if (s.step === "code") {
    return (
      <form class="bwc-login" data-testid="embedded-login-code" onSubmit={(e) => { e.preventDefault(); if (code.length === 6 && !s.busy) void p.login.verify(code); }}>
        {brand}
        <h2 class="bwc-login__title">{t.elCheckMail}</h2>
        <p class="bwc-login__lead">{t.elSentTo.replace("{email}", s.email)}</p>
        <CodeInput testid="embedded-login-code-input" label={t.elCode} value={code} onValue={setCode} bad={s.error?.kind === "invalid_code"} disabled={s.busy} />
        {err ? <ClipperStatus tone="error" testid="embedded-login-error">{err}</ClipperStatus> : null}
        <ClipperButton testid="embedded-login-verify" primary busy={s.busy} disabled={code.length !== 6 || s.busy} onClick={() => void p.login.verify(code)}>
          {s.busy ? t.elVerifying : t.elVerify}
        </ClipperButton>
        <div class="bwc-login__links">
          <ClipperButton testid="embedded-login-resend" disabled={s.busy} onClick={() => { setCode(""); void p.login.resend(); }}>{t.elResend}</ClipperButton>
          <ClipperButton testid="embedded-login-change-email" disabled={s.busy} onClick={() => void p.login.restart()}>{t.elChangeEmail}</ClipperButton>
        </div>
        {secured}
      </form>
    );
  }
  if (s.step === "second_factor") {
    const method: "totp" | "sms" = s.smsSent || !s.methods.includes("totp") ? "sms" : "totp";
    return (
      <form class="bwc-login" data-testid="embedded-login-2fa" onSubmit={(e) => { e.preventDefault(); if (code.length === 6 && !s.busy) void p.login.verifySecondFactor(method, code); }}>
        {brand}
        <h2 class="bwc-login__title">{t.el2faTitle}</h2>
        <p class="bwc-login__lead">{method === "sms" && s.smsSent ? t.el2faLeadSms : t.el2faLead}</p>
        <CodeInput testid="embedded-login-2fa-input" label={method === "sms" ? t.el2faCodeSms : t.el2faCode} value={code} onValue={setCode} bad={s.error?.kind === "invalid_code"} disabled={s.busy} />
        {err ? <ClipperStatus tone="error" testid="embedded-login-error">{err}</ClipperStatus> : null}
        <ClipperButton testid="embedded-login-2fa-verify" primary busy={s.busy} disabled={code.length !== 6 || s.busy} onClick={() => void p.login.verifySecondFactor(method, code)}>
          {t.el2faVerify}
        </ClipperButton>
        {s.methods.includes("sms") && !s.smsSent ? (
          <ClipperButton testid="embedded-login-2fa-sms" disabled={s.busy} onClick={() => { setCode(""); void p.login.sendSms(); }}>{t.el2faSms}</ClipperButton>
        ) : null}
        {secured}
      </form>
    );
  }
  return <ClipperStatus tone="busy">…</ClipperStatus>;
}

// ── the ready popup ──────────────────────────────────────────────────────────

/** The login the popup needs (same as the engine's); with `embedded` (F099.24) the popup logs in inside itself. */
export type PopupAuth = ClipperAuth & { embedded?(): EmbeddedLogin };

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
  /**
   * F099.24 — log in INSIDE the popup (auth.embedded(), BID F084.166) instead of the login window.
   * Off by default: turn it on when BID serves the embedded endpoints for your client. A BID that
   * answers 403 client_not_embedded or 404 falls back to the window by itself.
   */
  embeddedLogin?: boolean;
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
  // F099.24 — log in inside the popup when the auth offers it; the window stays as the fallback.
  const embedded = useRef<EmbeddedLogin | null>(null);
  if (!embedded.current && p.embeddedLogin && p.auth.embedded) embedded.current = p.auth.embedded();
  const [windowLogin, setWindowLogin] = useState(false);
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

      {phase.kind === "logged_out" && embedded.current && !windowLogin ? (
        <div class="bwc-popup__body">
          {loginError && phase.reason === "login_again" ? <ClipperStatus tone="error">{loginError}</ClipperStatus> : null}
          <EmbeddedLoginForm login={embedded.current} lang={p.lang} text={p.text} onSignedIn={() => void clipper.start()} onFallback={() => setWindowLogin(true)} />
        </div>
      ) : null}

      {(phase.kind === "logged_out" && (!embedded.current || windowLogin)) || phase.kind === "logging_in" ? (
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
            // The owner's rule: an incomplete clip must never look complete. But «only files are missing»
            // is not «the conversation is broken» (jam 13/10: the orange text scared the owner).
            done.clip.completeness.missing === "files" ? (
              <ClipperStatus tone="neutral" testid="clipper-incomplete-files">
                {`${t.filesMissing.replace("{n}", String(done.clip.completeness.problems?.length ?? 1))}. ${done.clip.completeness.problems?.join("; ") ?? done.clip.completeness.reason ?? ""}`.trim()}
              </ClipperStatus>
            ) : (
              <ClipperStatus tone="error" testid="clipper-incomplete">{`${t.incomplete}. ${done.clip.completeness.reason ?? ""}`.trim()}</ClipperStatus>
            )
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
      // a refused LATER batch must not hide that earlier ones arrived (owner 13/10)
      return <ClipperStatus tone="error">{`${t.refused}: ${result.message}${result.sent ? ` · ${result.sent} ${t.sent}` : ""}`}</ClipperStatus>;
    default:
      return null;
  }
}

