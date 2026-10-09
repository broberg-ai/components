// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.15 — the user menu at the bottom of the sidebar, with radio groups and
// zoom (Scout's approved KAI shell). Everything additive: without the new props
// the shell renders exactly as before.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { AppShell, UserMenu, type PreactNavGroup } from "../src/preact";

const GROUPS: PreactNavGroup[] = [{ label: "Overview", items: [{ id: "home", label: "Home", href: "/" }] }];
const USER = { name: "Christian Broberg", email: "c@example.com", subtitle: "Administrator · Enhed Nord" };

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}
const store = memoryStorage();
Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true });
Object.defineProperty(window, "localStorage", { value: store, configurable: true });
beforeEach(() => {
  localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe("AC0 — placement", () => {
  it("sidebar-footer: the user button sits in the sidebar's bottom, not in the content's top row, and opens upward", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" user={USER} userMenuPlacement="sidebar-footer" />);
    const btn = screen.getByTestId("sidebar-user-menu");
    expect(btn.closest('[data-testid="sidebar-user"]')).not.toBeNull();
    expect(btn.closest('[data-testid="content-header"]')).toBeNull();
    expect(screen.queryByTestId("topbar-user-menu")).toBeNull();
    expect(screen.getByTestId("sidebar-user-subtitle").textContent).toBe("Administrator · Enhed Nord");
    fireEvent.click(btn);
    expect(screen.getByTestId("topbar-user-menu-dropdown").className).toBe("bas-menu is-up");
  });

  it("default (no prop): exactly as before — top row, opens downward, no sidebar user", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" user={USER} />);
    const btn = screen.getByTestId("topbar-user-menu");
    expect(btn.closest('[data-testid="content-header"]')).not.toBeNull();
    expect(screen.queryByTestId("sidebar-user")).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId("topbar-user-menu-dropdown").className).toBe("bas-menu");
  });

  it("layout=topbar + sidebar-footer: the full-width bar carries no user menu either", () => {
    render(<AppShell lang="da" layout="topbar" groups={GROUPS} currentPath="/" user={USER} userMenuPlacement="sidebar-footer" />);
    expect(screen.queryByTestId("topbar-user-menu")).toBeNull();
    expect(screen.getByTestId("sidebar-user-menu")).toBeTruthy();
  });
});

describe("AC1 — radio groups", () => {
  const sections = [
    { id: "org", label: "Organisation", items: [{ id: "a", label: "Acme", checked: true }, { id: "b", label: "Beta", hint: "2 enheder" }] },
    { id: "area", label: "Scout", items: [{ id: "chat", label: "Scout Chat", checked: true }, { id: "admin", label: "Scout Admin" }] },
  ];
  it("render as menuitemradio with aria-checked; a pick reports (section, item) and closes the menu", () => {
    const onSectionSelect = vi.fn();
    render(<UserMenu lang="da" user={USER} sections={sections} onSectionSelect={onSectionSelect} />);
    fireEvent.click(screen.getByTestId("topbar-user-menu"));
    const a = screen.getByTestId("user-menu-section-org-a");
    const b = screen.getByTestId("user-menu-section-org-b");
    expect([a.getAttribute("role"), a.getAttribute("aria-checked"), b.getAttribute("aria-checked")]).toEqual(["menuitemradio", "true", "false"]);
    expect(screen.getByTestId("user-menu-section-org").getAttribute("aria-label")).toBe("Organisation");
    expect(b.textContent).toContain("2 enheder");
    fireEvent.click(screen.getByTestId("user-menu-section-area-admin"));
    expect(onSectionSelect.mock.calls).toEqual([["area", "admin"]]);
    expect(screen.queryByTestId("topbar-user-menu-dropdown")).toBeNull();
  });

  it("an item shows its hint (e.g. ⌘K)", () => {
    render(<UserMenu lang="da" user={USER} items={[{ id: "search", label: "Søg", hint: "⌘K", onSelect: () => {} }]} />);
    fireEvent.click(screen.getByTestId("topbar-user-menu"));
    expect(screen.getByTestId("user-menu-search").querySelector(".bas-mi__hint")?.textContent).toBe("⌘K");
  });
});

describe("AC2 — zoom", () => {
  it("− / value / +; a click reports value ± step", () => {
    const onChange = vi.fn();
    render(<UserMenu lang="da" user={USER} zoom={{ value: 100, onChange }} />);
    fireEvent.click(screen.getByTestId("topbar-user-menu"));
    expect(screen.getByTestId("user-menu-zoom-value").textContent).toBe("100 %");
    fireEvent.click(screen.getByTestId("user-menu-zoom-in"));
    fireEvent.click(screen.getByTestId("user-menu-zoom-out"));
    expect(onChange.mock.calls).toEqual([[110], [90]]);
  });

  it("the buttons are off at the limits", () => {
    const onChange = vi.fn();
    render(<UserMenu lang="da" user={USER} zoom={{ value: 80, onChange, min: 80, max: 120, step: 20 }} />);
    fireEvent.click(screen.getByTestId("topbar-user-menu"));
    expect([(screen.getByTestId("user-menu-zoom-out") as HTMLButtonElement).disabled, (screen.getByTestId("user-menu-zoom-in") as HTMLButtonElement).disabled]).toEqual([true, false]);
    cleanup();
    render(<UserMenu lang="da" user={USER} zoom={{ value: 120, onChange, min: 80, max: 120, step: 20 }} />);
    fireEvent.click(screen.getByTestId("topbar-user-menu"));
    expect([(screen.getByTestId("user-menu-zoom-out") as HTMLButtonElement).disabled, (screen.getByTestId("user-menu-zoom-in") as HTMLButtonElement).disabled]).toEqual([false, true]);
  });
});

describe("the open drawer traps no position:fixed descendant (F092.15)", () => {
  it("css: .is-mobile-drawer.is-open uses transform:none, never a translate", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(__dirname, "../css/app-shell.css"), "utf8");
    const block = css.match(/\.bas-sidebar\.is-mobile-drawer\.is-open\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block.match(/transform:\s*([^;]+);/)?.[1]?.trim()).toBe("none");
  });
});
