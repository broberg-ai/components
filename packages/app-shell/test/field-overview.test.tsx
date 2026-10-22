// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.35 — Field's approved overview: a bottom tab bar on the phone, only
// Light/Dark/System in the user menu, the theme block before «Konto», and the
// app's own wording for shell texts. All additive.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { AppShell, type PreactNavGroup } from "../src/preact";

const GROUPS: PreactNavGroup[] = [
  { label: "Main", items: [
    { id: "overview", label: "Overblik", href: "/" },
    { id: "data", label: "Data", href: "/data", children: [{ id: "data-sites", label: "Steder", href: "/data/sites" }, { id: "data-kinds", label: "Typer", href: "/data/kinds" }] },
    { id: "settings", label: "Indstillinger", href: "/settings" },
  ] },
];
const USER = { name: "C B", email: "c@example.com" };
const setMobile = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as never;
};
beforeEach(() => {
  const m = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 }, configurable: true });
  setMobile(true);
});
afterEach(cleanup);

describe("mobile: bottom-nav", () => {
  it("renders one tab per top-level item; a parent's tab links to its first child", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" mobile="bottom-nav" />);
    const nav = screen.getByTestId("mobile-bottom-nav");
    const tabs = [...nav.querySelectorAll("a")].map((a) => [a.getAttribute("data-testid"), a.getAttribute("href"), a.textContent]);
    expect(tabs).toEqual([
      ["mobile-bottom-nav-overview", "/", "Overblik"],
      ["mobile-bottom-nav-data", "/data/sites", "Data"],
      ["mobile-bottom-nav-settings", "/settings", "Indstillinger"],
    ]);
    expect(screen.getByTestId("app-shell").getAttribute("data-mobile")).toBe("bottom-nav");
  });

  it("a parent's tab is active (aria-current) on ANY page in its section, not only the first child", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/data/kinds" mobile="bottom-nav" />);
    const cur = [...screen.getByTestId("mobile-bottom-nav").querySelectorAll("a")].map((a) => a.getAttribute("aria-current"));
    expect(cur).toEqual([null, "page", null]);
  });

  it("the root takes the app's own testid", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" mobile="bottom-nav" mobileNavTestId="overview-mobilenav" />);
    expect(screen.getByTestId("overview-mobilenav").tagName).toBe("NAV");
    expect(screen.getByTestId("overview-mobilenav-overview").getAttribute("aria-current")).toBe("page");
  });

  it("a tab click goes through onNavigate (SPA)", () => {
    const went: string[] = [];
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" mobile="bottom-nav" onNavigate={(h) => went.push(h)} />);
    fireEvent.click(screen.getByTestId("mobile-bottom-nav-settings"));
    expect(went).toEqual(["/settings"]);
  });

  const css = () => readFileSync(resolve(__dirname, "../css/app-shell.css"), "utf8");
  const phone = () => css().slice(css().indexOf("F092.35 — bottom tab bar"));
  it("CSS: on a phone the sidebar and its button are hidden; on desktop the bar is", () => {
    expect(phone()).toContain('.bas-root[data-mobile="bottom-nav"] .bas-sidebar,');
    expect(phone()).toContain('.bas-root[data-mobile="bottom-nav"] .bas-trigger,');
    expect(css()).toContain(".bas-bottomnav { display: none; }");
  });

  it("CSS: the bar is fixed at the bottom and clears the phone's safe area", () => {
    expect(phone()).toMatch(/\.bas-bottomnav \{\s*display: flex; position: fixed; left: 0; right: 0; bottom: 0;/);
    expect(phone()).toContain("    padding-bottom: env(safe-area-inset-bottom, 0px);");
  });

  it("a sidebar-footer user menu moves to the top row on a phone (the sidebar is hidden there)", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" mobile="bottom-nav" user={USER} userMenuPlacement="sidebar-footer" />);
    expect(screen.getByTestId("topbar-user-menu").closest('[data-testid="content-header"]')).not.toBeNull();
    expect(screen.queryByTestId("sidebar-user-menu")).toBeNull();
  });

  it("on desktop the sidebar-footer user menu stays in the sidebar", () => {
    setMobile(false);
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" mobile="bottom-nav" user={USER} userMenuPlacement="sidebar-footer" />);
    expect(screen.getByTestId("sidebar-user-menu")).toBeTruthy();
  });

  it("without bottom-nav there is no bottom bar", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" />);
    expect(screen.queryByTestId("mobile-bottom-nav")).toBeNull();
  });
});

const openMenu = () => fireEvent.click(screen.getByTestId("topbar-user-menu"));

describe("userMenu.appearance { palette, surfaces }", () => {
  it("palette:false and surfaces:false leave only Light/Dark/System", () => {
    setMobile(false);
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" user={USER} userMenu={{ appearance: { palette: false, surfaces: false } }} />);
    openMenu();
    expect(screen.getByTestId("user-menu-theme")).toBeTruthy();
    expect(screen.queryByTestId("user-menu-palette")).toBeNull();
    expect(screen.queryByTestId("user-menu-surfaces")).toBeNull();
  });

  it("palette:false alone keeps the surfaces row", () => {
    setMobile(false);
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" user={USER} userMenu={{ appearance: { palette: false } }} />);
    openMenu();
    expect(screen.queryByTestId("user-menu-palette")).toBeNull();
    expect(screen.getByTestId("user-menu-surfaces")).toBeTruthy();
  });
});

describe("appearancePosition", () => {
  const order = () => {
    const menu = screen.getByTestId("topbar-user-menu-dropdown");
    const ids = [...menu.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid"));
    return [ids.indexOf("user-menu-theme"), ids.indexOf("user-menu-account")];
  };
  it('"top" puts the theme block before «Konto»', () => {
    setMobile(false);
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" user={USER} userMenu={{ accountHref: "/acct", appearancePosition: "top" }} />);
    openMenu();
    const [theme, account] = order();
    expect(theme).toBeGreaterThanOrEqual(0);
    expect(theme < account).toBe(true);
  });
  it("default keeps it after «Konto»", () => {
    setMobile(false);
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" user={USER} userMenu={{ accountHref: "/acct" }} />);
    openMenu();
    const [theme, account] = order();
    expect(account < theme).toBe(true);
  });
});

describe("strings — the app's own shell texts", () => {
  it("overrides the sidebar button label in the given language only", () => {
    setMobile(false);
    const strings = { en: { collapse: "Toggle sidebar" } };
    render(<AppShell lang="en" groups={GROUPS} currentPath="/" strings={strings} />);
    expect(screen.getByTestId("sidebar-trigger").getAttribute("aria-label")).toBe("Toggle sidebar");
    cleanup();
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" strings={strings} />);
    expect(screen.getByTestId("sidebar-trigger").getAttribute("aria-label")).toBe("Skjul sidemenu");
  });

  const themeLabels = () => [...screen.getByTestId("user-menu-theme").querySelectorAll("button")].map((b) => b.textContent);
  it("reaches the user menu inside the shell: Lyst / Mørkt", () => {
    setMobile(false);
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" user={USER} userMenu={{ accountHref: "/acct" }} strings={{ da: { light: "Lyst", dark: "Mørkt" } }} />);
    openMenu();
    expect(themeLabels().slice(0, 2)).toEqual(["Lyst", "Mørkt"]);
  });

  it("keys you do not give stay the package's (System, Konto)", () => {
    setMobile(false);
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" user={USER} userMenu={{ accountHref: "/acct" }} strings={{ da: { light: "Lyst" } }} />);
    openMenu();
    expect(themeLabels()[2]).toBe("System");
    expect(screen.getByTestId("user-menu-account").textContent).toBe("Konto");
  });
});
