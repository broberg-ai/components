// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F017.3 — the Preact primitives against the real stylesheet.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { createDirtyBus, type DirtyBus } from "../src/core";
import { SettingsCard, SettingsField, SettingsInput, SettingsSaveButton, SettingsToggle, useDirtyBus, useSaveHandler, useStored } from "../src/preact";

const CSS = readFileSync(resolve(__dirname, "../css/settings.css"), "utf8");
let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
});
afterEach(() => {
  cleanup();
  style.remove();
});

function Panel(p: { bus: DirtyBus; save: (name: string) => Promise<void> | void }) {
  const [name, setName] = useState("Acme");
  const [on, setOn] = useState(false);
  useSaveHandler(() => p.save(name), p.bus);
  return (
    <SettingsCard title="Generelt" testid="settings-panel-general">
      <SettingsField label="Appnavn" htmlFor="app-name">
        <SettingsInput id="app-name" testid="settings-app-name" value={name} onValue={setName} bus={p.bus} copy />
      </SettingsField>
      <SettingsField label="Vedligehold">
        <SettingsToggle checked={on} onToggle={setOn} label="Vedligehold" testid="settings-maintenance" bus={p.bus} />
      </SettingsField>
    </SettingsCard>
  );
}

describe("F017.3 — the save flow a user sees", () => {
  test("clean → edit → «Ikke gemt · Gem» → saving → «Gemt», and the panel received the typed value", async () => {
    const bus = createDirtyBus();
    const saved: string[] = [];
    render(<><SettingsSaveButton bus={bus} /><Panel bus={bus} save={(n) => void saved.push(n)} /></>);
    const btn = screen.getByTestId("settings-save-button") as HTMLButtonElement;
    expect([btn.dataset.status, btn.disabled, btn.textContent]).toEqual(["clean", true, "Gem"]);
    fireEvent.input(screen.getByTestId("settings-app-name"), { target: { value: "Nordlys 1791" } });
    expect([btn.dataset.status, btn.disabled, btn.textContent]).toEqual(["dirty", false, "Ikke gemt · Gem"]);
    fireEvent.click(btn);
    expect([btn.dataset.status, btn.textContent]).toEqual(["saving", "Gemmer…"]);
    await waitFor(() => expect(btn.dataset.status).toBe("saved"));
    expect([saved, btn.textContent]).toEqual([["Nordlys 1791"], "Gemt"]);
  });

  test("a panel that fails leaves the button «Kunne ikke gemme · Gem» and the form still unsaved", async () => {
    const bus = createDirtyBus();
    render(<><SettingsSaveButton bus={bus} /><Panel bus={bus} save={async () => { throw new Error("db down"); }} /></>);
    fireEvent.click(screen.getByTestId("settings-maintenance"));
    const btn = screen.getByTestId("settings-save-button") as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(btn.dataset.status).toBe("failed"));
    expect([btn.disabled, btn.textContent, bus.getState().dirty]).toEqual([false, "Kunne ikke gemme · Gem", true]);
  });

  test("English texts with lang=en", () => {
    const bus = createDirtyBus();
    render(<SettingsSaveButton bus={bus} lang="en" />);
    act(() => bus.markDirty());
    expect(screen.getByTestId("settings-save-button").textContent).toBe("Unsaved · Save");
  });
});

describe("F017.3 — the controls", () => {
  test("the toggle is a button with role=switch and aria-checked, and marks the form dirty", () => {
    const bus = createDirtyBus();
    render(<Panel bus={bus} save={() => undefined} />);
    const sw = screen.getByTestId("settings-maintenance");
    expect([sw.tagName, sw.getAttribute("role"), sw.getAttribute("aria-checked")]).toEqual(["BUTTON", "switch", "false"]);
    fireEvent.click(sw);
    expect([sw.getAttribute("aria-checked"), bus.getState().dirty]).toEqual(["true", true]);
    expect(document.querySelector('input[type="checkbox"], select')).toBeNull();
  });

  test("every interactive element carries a data-testid", () => {
    render(<><SettingsSaveButton bus={createDirtyBus()} /><Panel bus={createDirtyBus()} save={() => undefined} /></>);
    const missing = [...document.querySelectorAll("button, input, select, textarea, a")].filter((el) => !el.getAttribute("data-testid"));
    expect(missing.map((el) => el.outerHTML)).toEqual([]);
  });

  test("the row is a 180px label column beside the control (from the real stylesheet)", () => {
    render(<Panel bus={createDirtyBus()} save={() => undefined} />);
    const row = document.querySelector(".bst-field") as HTMLElement;
    expect(getComputedStyle(row).gridTemplateColumns).toBe("180px minmax(0, 1fr)");
  });
});

describe("F017.3 — hooks", () => {
  test("useDirtyBus subscribes on mount and unsubscribes on unmount", () => {
    // Asserted on the bus's own unsubscribe, not on renders: Preact never re-renders
    // an unmounted component, so a leaked subscription is invisible to a render
    // count — that version of this test let the leak through (mutation-measured).
    const bus = createDirtyBus();
    const off = vi.fn();
    const real = bus.onDirtyBus.bind(bus);
    bus.onDirtyBus = (h) => {
      const unsub = real(h);
      return () => {
        off();
        unsub();
      };
    };
    const renders = vi.fn();
    function Probe() {
      renders(useDirtyBus(bus).dirty);
      return null;
    }
    const { unmount } = render(<Probe />);
    act(() => bus.markDirty());
    expect([renders.mock.lastCall?.[0], off.mock.calls.length]).toEqual([true, 0]);
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  test("useStored reads, writes, and survives a remount", () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
    function Probe() {
      const [v, set] = useStored("dense", false);
      return <button data-testid="probe" onClick={() => set(!v)}>{String(v)}</button>;
    }
    const { unmount } = render(<Probe />);
    fireEvent.click(screen.getByTestId("probe"));
    unmount();
    render(<Probe />);
    expect([screen.getByTestId("probe").textContent, mem.get("dense")]).toEqual(["true", "true"]);
    vi.unstubAllGlobals();
  });

  test("useStored falls back silently when storage throws (private mode)", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } });
    function Probe() {
      const [v, set] = useStored("x", "fallback");
      return <button data-testid="probe" onClick={() => set("next")}>{v}</button>;
    }
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("fallback");
    fireEvent.click(screen.getByTestId("probe"));
    expect(screen.getByTestId("probe").textContent).toBe("next");
    vi.unstubAllGlobals();
  });
});
