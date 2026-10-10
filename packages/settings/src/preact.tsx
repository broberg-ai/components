/** @jsxImportSource preact */
// F017.3 — the settings primitives for Stack B (Preact), on @broberg/theme tokens.
//
// The shape every settings page in the fleet already has: Card → SectionHeading →
// fields → one Save button that knows whether anything is unsaved. Panels own
// their own fetch and persist; they register a save handler and mark the form
// dirty, and the button does the rest. Tabs are NOT here: @broberg/app-shell's
// PageTabs (mode "query", ?tab=<id>) already is the tab strip (F017.5 notes).
//
// Tokens read (all from @broberg/theme's palettes.css; no colour is a literal):
//   --bg-card --bg-sunk --border --fg --fg-muted --fg-faint --hover --active
//   --accent --olive-btn --paper --danger --success --radius
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { copyToClipboard, settingsBus, type DirtyBus, type DirtyState, type SaveHandler } from "./core.js";

export type Lang = "da" | "en";

const TEXT = {
  da: { save: "Gem", unsaved: "Ikke gemt", saving: "Gemmer…", saved: "Gemt", failed: "Kunne ikke gemme", copy: "Kopiér", copied: "Kopieret" },
  en: { save: "Save", unsaved: "Unsaved", saving: "Saving…", saved: "Saved", failed: "Could not save", copy: "Copy", copied: "Copied" },
} as const;

/** The bus's state, re-rendering on every change. Unsubscribes on unmount. */
export function useDirtyBus(bus: DirtyBus = settingsBus): DirtyState {
  const [state, setState] = useState<DirtyState>(bus.getState());
  useEffect(() => {
    setState(bus.getState());
    return bus.onDirtyBus({ onChange: setState });
  }, [bus]);
  return state;
}

/**
 * A panel's part of Save: `fn` runs when Save is pressed. Throw or reject to fail
 * the save — the form stays "unsaved" and the button says so.
 */
export function useSaveHandler(fn: SaveHandler, bus: DirtyBus = settingsBus): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => bus.onDirtyBus({ onSave: () => ref.current() }), [bus]);
}

/**
 * A value remembered in localStorage — for a per-user display preference, not for
 * settings that belong on the server. Falls back silently when storage is
 * unavailable (private mode, blocked, SSR): the value then lives for the session.
 */
export function useStored<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  });
  const set = (next: T) => {
    setValue(next);
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(next));
    } catch {
      // storage refused — keep the in-memory value
    }
  };
  return [value, set];
}

export function SettingsCard(p: { title?: ComponentChildren; description?: ComponentChildren; testid?: string; children: ComponentChildren }) {
  return (
    <section class="bst-card" data-testid={p.testid}>
      {p.title ? <SectionHeading description={p.description}>{p.title}</SectionHeading> : null}
      <div class="bst-card__body">{p.children}</div>
    </section>
  );
}

export function SectionHeading(p: { description?: ComponentChildren; children: ComponentChildren }) {
  return (
    <header class="bst-heading">
      <h2 class="bst-heading__title">{p.children}</h2>
      {p.description ? <p class="bst-heading__desc">{p.description}</p> : null}
    </header>
  );
}

/** One row: label column (180px) beside the control, stacked on a phone. */
export function SettingsField(p: { label: ComponentChildren; hint?: ComponentChildren; htmlFor?: string; children: ComponentChildren }) {
  return (
    <div class="bst-field">
      <div class="bst-field__label">
        <label for={p.htmlFor}>{p.label}</label>
        {p.hint ? <p class="bst-field__hint">{p.hint}</p> : null}
      </div>
      <div class="bst-field__control">{p.children}</div>
    </div>
  );
}

export interface SettingsInputProps {
  id: string;
  value: string;
  onValue: (value: string) => void;
  /** data-testid of the input; the copy button gets `<testid>-copy`. */
  testid: string;
  type?: "text" | "email" | "url" | "password" | "number";
  placeholder?: string;
  readOnly?: boolean;
  /** Show a copy button beside the field (keys, URLs). */
  copy?: boolean;
  lang?: Lang;
  bus?: DirtyBus;
}

/** A text field that marks the form unsaved on every edit. */
export function SettingsInput(p: SettingsInputProps) {
  const bus = p.bus ?? settingsBus;
  const t = TEXT[p.lang ?? "da"];
  const [copied, setCopied] = useState(false);
  return (
    <div class="bst-input">
      <input
        id={p.id}
        class="bst-input__field"
        data-testid={p.testid}
        type={p.type ?? "text"}
        value={p.value}
        placeholder={p.placeholder}
        readOnly={p.readOnly}
        onInput={(e) => {
          p.onValue((e.currentTarget as HTMLInputElement).value);
          bus.markDirty();
        }}
      />
      {p.copy ? (
        <button
          type="button"
          class="bst-btn"
          data-testid={`${p.testid}-copy`}
          onClick={async () => {
            if (await copyToClipboard(p.value, { onReset: () => setCopied(false) })) setCopied(true);
          }}
        >
          {copied ? t.copied : t.copy}
        </button>
      ) : null}
    </div>
  );
}

/** An on/off switch — a button with role="switch", never a native checkbox. */
export function SettingsToggle(p: { checked: boolean; onToggle: (checked: boolean) => void; label: string; testid: string; disabled?: boolean; bus?: DirtyBus }) {
  const bus = p.bus ?? settingsBus;
  return (
    <button
      type="button"
      role="switch"
      class={"bst-switch" + (p.checked ? " is-on" : "")}
      aria-checked={p.checked}
      aria-label={p.label}
      data-testid={p.testid}
      disabled={p.disabled}
      onClick={() => {
        p.onToggle(!p.checked);
        bus.markDirty();
      }}
    >
      <span class="bst-switch__knob" aria-hidden="true" />
    </button>
  );
}

/**
 * The one Save button. Dimmed while nothing is unsaved; «Ikke gemt · Gem» when
 * something is; a spinner while every panel writes; «Gemt» for two seconds after;
 * «Kunne ikke gemme» — and still unsaved — when a panel failed.
 */
export function SettingsSaveButton(p: { lang?: Lang; testid?: string; bus?: DirtyBus }) {
  const bus = p.bus ?? settingsBus;
  const t = TEXT[p.lang ?? "da"];
  const state = useDirtyBus(bus);
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = bus.onDirtyBus({
      onSaved: () => {
        setJustSaved(true);
        clearTimeout(timer);
        timer = setTimeout(() => setJustSaved(false), 2000);
      },
      onDirty: () => setJustSaved(false),
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [bus]);
  const failed = state.error !== undefined && !state.saving;
  const status = state.saving ? "saving" : failed ? "failed" : state.dirty ? "dirty" : justSaved ? "saved" : "clean";
  const label =
    status === "saving" ? t.saving : status === "failed" ? `${t.failed} · ${t.save}` : status === "dirty" ? `${t.unsaved} · ${t.save}` : status === "saved" ? t.saved : t.save;
  return (
    <button
      type="button"
      class={"bst-save is-" + status}
      data-testid={p.testid ?? "settings-save-button"}
      data-status={status}
      disabled={status === "clean" || status === "saved" || status === "saving"}
      aria-live="polite"
      onClick={() => void bus.requestSave()}
    >
      {status === "saving" ? <span class="bst-spinner" aria-hidden="true" /> : null}
      {label}
    </button>
  );
}
