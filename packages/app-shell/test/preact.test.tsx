// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.1–.3 — the shell, the bell and the user menu, rendered.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { initPalette, initTheme } from "@broberg/theme";
import {
  AppShell,
  NotificationBell,
  PageTabs,
  Sidebar,
  TopBar,
  UserMenu,
  createMemoryNotificationSource,
  type NotificationSource,
  type PreactNavGroup,
} from "../src/preact";

const GROUPS: PreactNavGroup[] = [
  { label: "Overview", items: [{ id: "home", label: "Home", href: "/" }, { id: "inbox", label: "Inbox", href: "/inbox", badge: 120 }] },
  { label: "Build", items: [{ id: "board", label: "Board", href: "/board" }] },
];
const FOOTER = [{ id: "settings", label: "Settings", href: "/settings" }];

function mockMatchMedia(mobile: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: q.includes("max-width") ? mobile : q.includes("light") ? true : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  })) as unknown as typeof window.matchMedia;
}

// Node 25 ships a global localStorage without .clear() that shadows the DOM
// environment's (measured; consent-cookie's suite hit the same). Install a real
// Storage-shaped store so the shell's persistence is what is being tested.
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
  mockMatchMedia(false);
  for (const a of ["data-theme", "data-palette", "data-surfaces", "data-backdrop"]) document.documentElement.removeAttribute(a);
});
afterEach(cleanup);

describe("Sidebar (F092.1)", () => {
  it("renders groups + footer from data and marks the current item", () => {
    render(<Sidebar lang="da" groups={GROUPS} footer={FOOTER} currentPath="/board/42" />);
    expect(screen.getByTestId("sidebar-item-board").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("sidebar-item-board").className).toContain("is-active");
    expect(screen.getByTestId("sidebar-item-home").getAttribute("aria-current")).toBeNull();
    expect(screen.getByTestId("sidebar-item-settings")).toBeTruthy();
    expect(screen.getByTestId("sidebar-badge-inbox").textContent).toBe("99+");
  });

  it("a group folds and stays folded after a remount (localStorage)", () => {
    const { unmount } = render(<Sidebar lang="da" groups={GROUPS} currentPath="/" groupsKey="t.groups" />);
    fireEvent.click(screen.getByTestId("sidebar-group-build"));
    expect(screen.queryByTestId("sidebar-item-board")).toBeNull();
    unmount();
    render(<Sidebar lang="da" groups={GROUPS} currentPath="/" groupsKey="t.groups" />);
    expect(screen.queryByTestId("sidebar-item-board")).toBeNull();
    expect(screen.getByTestId("sidebar-group-build").getAttribute("aria-expanded")).toBe("false");
  });

  it("onNavigate takes the click (SPA) instead of a page load", () => {
    const nav = vi.fn();
    render(<Sidebar lang="da" groups={GROUPS} currentPath="/" onNavigate={nav} />);
    fireEvent.click(screen.getByTestId("sidebar-item-board"));
    expect(nav).toHaveBeenCalledWith("/board");
  });
});

describe("AppShell — collapse and the two phone modes (F092.1)", () => {
  it("desktop collapse is remembered after a remount", () => {
    const { unmount } = render(<AppShell lang="da" groups={GROUPS} currentPath="/" storageKey="t" />);
    fireEvent.click(screen.getByTestId("sidebar-collapse"));
    expect(screen.getByTestId("sidebar-root").className).toContain("is-collapsed");
    unmount();
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" storageKey="t" />);
    expect(screen.getByTestId("sidebar-root").className).toContain("is-collapsed");
    fireEvent.click(screen.getByTestId("sidebar-expand"));
    expect(screen.getByTestId("sidebar-root").className).not.toContain("is-collapsed");
  });

  it("drawer: hamburger opens, backdrop and navigation close", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" mobile="drawer" onNavigate={() => {}} />);
    expect(screen.getByTestId("app-shell").getAttribute("data-mobile")).toBe("drawer");
    fireEvent.click(screen.getByTestId("sidebar-toggle"));
    expect(screen.getByTestId("sidebar-root").className).toContain("is-open");
    fireEvent.click(screen.getByTestId("sidebar-backdrop"));
    expect(screen.getByTestId("sidebar-root").className).not.toContain("is-open");
    fireEvent.click(screen.getByTestId("sidebar-toggle"));
    fireEvent.click(screen.getByTestId("sidebar-item-board"));
    expect(screen.getByTestId("sidebar-root").className).not.toContain("is-open");
  });

  it("rail: no hamburger, no backdrop, the sidebar is the rail", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" mobile="rail" />);
    expect(screen.getByTestId("app-shell").getAttribute("data-mobile")).toBe("rail");
    expect(screen.queryByTestId("sidebar-toggle")).toBeNull();
    expect(screen.queryByTestId("sidebar-backdrop")).toBeNull();
    expect(screen.getByTestId("sidebar-root").className).toContain("is-mobile-rail");
  });
});

describe("TopBar — bell and user menu always last, in that order (F092.1/.2)", () => {
  it("order: brand, actions, bell, user menu", () => {
    render(<TopBar lang="da" brand={<span data-testid="brand">B</span>} actions={<span data-testid="act">A</span>} user={{ name: "Ann Berg" }} />);
    const ids = [...screen.getByTestId("topbar-root").querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid"));
    const order = ["brand", "act", "topbar-notifications", "topbar-user-menu"].map((id) => ids.indexOf(id));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("the bell is there with no source at all, showing the empty state", async () => {
    render(<TopBar lang="da" />);
    fireEvent.click(screen.getByTestId("topbar-notifications"));
    expect(await screen.findByTestId("notifications-empty")).toBeTruthy();
  });
});

describe("NotificationBell (F092.2) — on @broberg/notifications' bell shell", () => {
  const row = (id: string, title: string, seenAt: number | null = null) => ({ id, kind: "x", title, body: null, navigate: `/${id}`, refId: null, createdAt: Date.now(), seenAt });
  const items = () => [row("a", "Første"), row("b", "Anden", 5)];

  it("count, click → seen + navigate, mark-all → 0", async () => {
    const src = createMemoryNotificationSource(items());
    const nav = vi.fn();
    render(<NotificationBell lang="da" source={src} onNavigate={nav} />);
    await waitFor(() => expect(screen.getByTestId("topbar-notifications-count").textContent).toBe("1"));
    fireEvent.click(screen.getByTestId("topbar-notifications"));
    await screen.findByTestId("notifications-dropdown");
    await waitFor(() => expect(screen.getAllByTestId("notification-row")).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId("notification-row")[0]!);
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/a"));
    expect(src.rows().find((n) => n.id === "a")!.seenAt).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId("topbar-notifications-count")).toBeNull());

    src.push(row("c", "Ny"));
    await waitFor(() => expect(screen.getByTestId("topbar-notifications-count").textContent).toBe("1"));
    fireEvent.click(screen.getByTestId("topbar-notifications"));
    await screen.findByTestId("notifications-mark-all");
    await waitFor(() => expect((screen.getByTestId("notifications-mark-all") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("notifications-mark-all"));
    await waitFor(() => expect(screen.queryByTestId("topbar-notifications-count")).toBeNull());
    expect(src.rows().every((n) => n.seenAt != null)).toBe(true);
  });

  it("99+ above 99", async () => {
    const many = Array.from({ length: 120 }, (_, i) => row(String(i), "x"));
    render(<NotificationBell lang="da" source={createMemoryNotificationSource(many)} />);
    await waitFor(() => expect(screen.getByTestId("topbar-notifications-count").textContent).toBe("99+"));
  });

  it("on a phone the panel is a bottom sheet", async () => {
    mockMatchMedia(true);
    render(<NotificationBell lang="da" source={createMemoryNotificationSource(items())} />);
    fireEvent.click(screen.getByTestId("topbar-notifications"));
    expect(await screen.findByTestId("notifications-drawer")).toBeTruthy();
  });

  it("a failing source says 'could not load', not 'no notifications'", async () => {
    const broken: NotificationSource = {
      loadRows: async () => { throw new Error("HTTP 500"); },
      countUnseen: async () => { throw new Error("HTTP 500"); },
      markSeen: async () => [],
      markAllSeen: async () => [],
    };
    render(<NotificationBell lang="da" source={broken} />);
    fireEvent.click(screen.getByTestId("topbar-notifications"));
    expect(await screen.findByTestId("notifications-error")).toBeTruthy();
    expect(screen.queryByTestId("notifications-empty")).toBeNull();
  });

  it("Escape closes the panel (the shell's innermost-layer rule)", async () => {
    render(<NotificationBell lang="da" source={createMemoryNotificationSource(items())} />);
    fireEvent.click(screen.getByTestId("topbar-notifications"));
    await screen.findByTestId("notifications-dropdown");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("notifications-dropdown")).toBeNull());
  });
});

describe("UserMenu (F092.3)", () => {
  it("BID picture when present, initials when not", () => {
    const { unmount } = render(<UserMenu lang="da" user={{ name: "Ann Berg", picture: "https://id.broberg.ai/avatar/1.webp" }} />);
    expect(screen.getByTestId("avatar-picture").getAttribute("src")).toBe("https://id.broberg.ai/avatar/1.webp");
    unmount();
    render(<UserMenu lang="da" user={{ name: "Ann Berg", email: "ann@x.dk" }} />);
    expect(screen.getByTestId("avatar-initials").textContent).toBe("AB");
  });

  it("identity, Konto → BID, app items, sign out", async () => {
    const out = vi.fn();
    const pick = vi.fn();
    render(<UserMenu lang="da" user={{ name: "Ann Berg", email: "ann@x.dk" }} accountHref="https://id.broberg.ai/account" items={[{ id: "team", label: "Team", onSelect: pick }]} onSignOut={out} />);
    fireEvent.click(screen.getByTestId("topbar-user-menu"));
    expect(screen.getByTestId("topbar-user-menu-dropdown").textContent).toContain("ann@x.dk");
    expect(screen.getByTestId("user-menu-account").getAttribute("href")).toBe("https://id.broberg.ai/account");
    fireEvent.click(screen.getByTestId("user-menu-team"));
    expect(pick).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("topbar-user-menu"));
    fireEvent.click(screen.getByTestId("topbar-sign-out"));
    await waitFor(() => expect(out).toHaveBeenCalled());
  });

  it("appearance writes through @broberg/theme to <html>", () => {
    initTheme({ storageKey: "t.theme", defaultPreference: "dark" });
    initPalette({ paletteKey: "t.p", surfacesKey: "t.s", backdropKey: "t.b" });
    render(<UserMenu lang="da" user={{ name: "A" }} />);
    fireEvent.click(screen.getByTestId("topbar-user-menu"));
    const html = document.documentElement;
    fireEvent.click(screen.getByTestId("user-menu-theme-light"));
    expect(html.getAttribute("data-theme")).toBe("light");
    fireEvent.click(screen.getByTestId("user-menu-palette-broberg"));
    expect(html.getAttribute("data-palette")).toBe("broberg");
    expect(screen.getByTestId("user-menu-palette-broberg").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("user-menu-surfaces-layered"));
    expect(html.getAttribute("data-surfaces")).toBe("layered");
    fireEvent.click(screen.getByTestId("user-menu-backdrop-plain"));
    expect(html.getAttribute("data-backdrop")).toBe("plain");
    expect(screen.getByTestId("user-menu-palette-broberg").textContent).toBe("Fjord");
  });

  it("closes on Escape and on a click outside", () => {
    render(<div><span data-testid="outside">x</span><UserMenu lang="da" user={{ name: "A" }} /></div>);
    fireEvent.click(screen.getByTestId("topbar-user-menu"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("topbar-user-menu-dropdown")).toBeNull();
    fireEvent.click(screen.getByTestId("topbar-user-menu"));
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("topbar-user-menu-dropdown")).toBeNull();
  });
});

describe("PageTabs (F092.1)", () => {
  const tabs = [{ id: "general", label: "General" }, { id: "team", label: "Team" }];
  it("query mode: ?tab=, first tab when absent", () => {
    const { unmount } = render(<PageTabs tabs={tabs} currentUrl="/settings" />);
    expect(screen.getByTestId("page-tab-general").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("page-tab-team").getAttribute("href")).toBe("/settings?tab=team");
    unmount();
    render(<PageTabs tabs={tabs} currentUrl="/settings?tab=team" />);
    expect(screen.getByTestId("page-tab-team").getAttribute("aria-current")).toBe("page");
  });
  it("path mode: each tab its own route", () => {
    render(<PageTabs mode="path" tabs={[{ id: "a", label: "A", href: "/x/a" }, { id: "b", label: "B", href: "/x/b" }]} currentUrl="/x/b" />);
    expect(screen.getByTestId("page-tab-b").getAttribute("aria-current")).toBe("page");
  });
});
