// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.1–.3 — the shell, the bell and the user menu, rendered.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { initPalette, initTheme } from "@broberg/theme";
import {
  AppShell,
  NotificationBell,
  PageHeader,
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

describe("AppShell — collapse and the two phone modes (F092.1, one trigger since F092.4)", () => {
  it("desktop fold is remembered after a remount", () => {
    const { unmount } = render(<AppShell lang="da" groups={GROUPS} currentPath="/" storageKey="t" />);
    fireEvent.click(screen.getByTestId("sidebar-trigger"));
    expect(screen.getByTestId("sidebar-root").className).toContain("is-collapsed");
    unmount();
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" storageKey="t" />);
    expect(screen.getByTestId("sidebar-root").className).toContain("is-collapsed");
    fireEvent.click(screen.getByTestId("sidebar-trigger"));
    expect(screen.getByTestId("sidebar-root").className).not.toContain("is-collapsed");
  });

  it("phone, drawer: the same trigger opens; backdrop and navigation close", () => {
    mockMatchMedia(true);
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" mobile="drawer" onNavigate={() => {}} />);
    expect(screen.getByTestId("app-shell").getAttribute("data-mobile")).toBe("drawer");
    fireEvent.click(screen.getByTestId("sidebar-trigger"));
    expect(screen.getByTestId("sidebar-root").className).toContain("is-open");
    expect(screen.getByTestId("sidebar-trigger").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByTestId("sidebar-backdrop"));
    expect(screen.getByTestId("sidebar-root").className).not.toContain("is-open");
    fireEvent.click(screen.getByTestId("sidebar-trigger"));
    fireEvent.click(screen.getByTestId("sidebar-item-board"));
    expect(screen.getByTestId("sidebar-root").className).not.toContain("is-open");
    // on a phone the trigger does not fold the desktop sidebar
    expect(screen.getByTestId("sidebar-root").className).not.toContain("is-collapsed");
  });

  it("rail: no backdrop, the sidebar is the rail", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" mobile="rail" />);
    expect(screen.getByTestId("app-shell").getAttribute("data-mobile")).toBe("rail");
    expect(screen.queryByTestId("sidebar-backdrop")).toBeNull();
    expect(screen.getByTestId("sidebar-root").className).toContain("is-mobile-rail");
  });
});

describe("F092.4 — one sidebar trigger like shadcn dashboard-01", () => {
  it("the three old buttons are gone", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" />);
    for (const id of ["sidebar-collapse", "sidebar-expand", "sidebar-toggle"]) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getAllByTestId("sidebar-trigger")).toHaveLength(1);
  });

  it("order in the content header: trigger, separator, h1 title", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" title="Dokumenter" />);
    const head = screen.getByTestId("content-header");
    expect([...head.children].map((c) => c.getAttribute("data-testid"))).toEqual([
      "sidebar-trigger",
      "content-header-separator",
      "content-header-title",
    ]);
    const h1 = screen.getByTestId("content-header-title");
    expect(h1.tagName).toBe("H1");
    expect(h1.textContent).toBe("Dokumenter");
    // the content header sits in <main>, to the right of the sidebar
    expect(screen.getByTestId("app-content").firstElementChild).toBe(head);
  });

  it("the icon is lucide PanelLeft, 16px", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" />);
    const svg = screen.getByTestId("sidebar-trigger").querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("16");
    const rect = svg.querySelector("rect")!;
    expect([rect.getAttribute("width"), rect.getAttribute("height"), rect.getAttribute("x"), rect.getAttribute("y"), rect.getAttribute("rx")]).toEqual(["18", "18", "3", "3", "2"]);
    expect(svg.querySelector("path")!.getAttribute("d")).toBe("M9 3v18");
  });

  it("aria-label and aria-expanded follow the desktop fold", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" />);
    const btn = screen.getByTestId("sidebar-trigger");
    expect([btn.getAttribute("aria-expanded"), btn.getAttribute("aria-label")]).toEqual(["true", "Skjul sidemenu"]);
    fireEvent.click(btn);
    expect([btn.getAttribute("aria-expanded"), btn.getAttribute("aria-label")]).toEqual(["false", "Vis sidemenu"]);
  });

  it("title: the prop wins, else the active item (a sub-item beats its parent), else no h1", () => {
    const nested: PreactNavGroup[] = [
      { label: "Main", items: [{ id: "models", label: "Models", href: "/models", children: [{ id: "genesis", label: "Genesis", href: "/models/genesis" }] }] },
    ];
    const { unmount } = render(<AppShell lang="da" groups={nested} currentPath="/models/genesis" />);
    expect(screen.getByTestId("content-header-title").textContent).toBe("Genesis");
    unmount();
    const r2 = render(<AppShell lang="da" groups={GROUPS} currentPath="/inbox" />);
    expect(screen.getByTestId("content-header-title").textContent).toBe("Inbox");
    r2.unmount();
    render(<AppShell lang="da" groups={GROUPS} currentPath="/nowhere" />);
    expect(screen.queryByTestId("content-header-title")).toBeNull();
    expect(screen.queryByTestId("content-header-separator")).toBeNull();
  });
});

const NESTED: PreactNavGroup[] = [
  {
    label: "Platform",
    items: [
      { id: "playground", label: "Playground", href: "/playground", icon: <i>P</i>, children: [
        { id: "history", label: "History", href: "/playground/history" },
        { id: "starred", label: "Starred", href: "/playground/starred" },
      ] },
      { id: "models", label: "Models", href: "/models", icon: <i>M</i>, children: [{ id: "genesis", label: "Genesis", href: "/models/genesis" }] },
      { id: "docs", label: "Docs", href: "/docs", icon: <i>D</i> },
    ],
  },
];

describe("F092.5 — items with children open and close", () => {
  it("a parent is a button with a chevron; click toggles aria-expanded and the sub-list", () => {
    render(<AppShell lang="da" groups={NESTED} currentPath="/docs" storageKey="n" />);
    const t = screen.getByTestId("sidebar-item-playground-toggle");
    expect([t.tagName, t.getAttribute("type")]).toEqual(["BUTTON", "button"]); // native button: Enter and Space work
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("sidebar-item-history")).toBeNull();
    fireEvent.click(t);
    expect(t.getAttribute("aria-expanded")).toBe("true");
    expect(t.querySelector(".bas-chev")!.className).toContain("is-open");
    expect(screen.getByTestId("sidebar-item-history").closest(".bas-sub")).not.toBeNull();
    fireEvent.click(t);
    expect(screen.queryByTestId("sidebar-item-history")).toBeNull();
  });

  it("open items are remembered after a remount", () => {
    const { unmount } = render(<AppShell lang="da" groups={NESTED} currentPath="/docs" storageKey="n" />);
    fireEvent.click(screen.getByTestId("sidebar-item-models-toggle"));
    unmount();
    render(<AppShell lang="da" groups={NESTED} currentPath="/docs" storageKey="n" />);
    expect(screen.getByTestId("sidebar-item-models-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("sidebar-item-genesis")).toBeTruthy();
  });

  it("the parent of the current page starts open, and both are marked", () => {
    render(<AppShell lang="da" groups={NESTED} currentPath="/playground/starred" storageKey="n" />);
    const t = screen.getByTestId("sidebar-item-playground-toggle");
    expect(t.getAttribute("aria-expanded")).toBe("true");
    expect(t.className).toContain("is-parent-active");
    expect(screen.getByTestId("sidebar-item-starred").className).toContain("is-active");
    expect(screen.getByTestId("sidebar-item-starred").getAttribute("aria-current")).toBe("page");
  });

  it("phone drawer: children work the same and a sub-item click closes the drawer", () => {
    mockMatchMedia(true);
    render(<AppShell lang="da" groups={NESTED} currentPath="/docs" onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId("sidebar-trigger"));
    fireEvent.click(screen.getByTestId("sidebar-item-playground-toggle"));
    fireEvent.click(screen.getByTestId("sidebar-item-history"));
    expect(screen.getByTestId("sidebar-root").className).not.toContain("is-open");
  });
});

describe("F092.6 — collapse to an icon rail with the brand mark", () => {
  const mark = <b data-testid="logo">B</b>;

  it("collapse=icon: folded is the rail, not gone; offcanvas is the default", () => {
    const { unmount } = render(<AppShell lang="da" groups={NESTED} currentPath="/docs" />);
    expect(screen.getByTestId("sidebar-root").getAttribute("data-collapse")).toBe("offcanvas");
    unmount();
    render(<AppShell lang="da" groups={NESTED} currentPath="/docs" collapse="icon" brandMark={mark} storageKey="r" />);
    const root = screen.getByTestId("sidebar-root");
    expect(root.getAttribute("data-collapse")).toBe("icon");
    expect(root.className).not.toContain("is-railed");
    fireEvent.click(screen.getByTestId("sidebar-trigger"));
    expect(root.className).toContain("is-collapsed");
    expect(root.className).toContain("is-railed");
  });

  it("the rail shows the brand mark, and every icon has its label as aria-label and title", () => {
    localStorage.setItem("r.collapsed", "1");
    render(<AppShell lang="da" groups={NESTED} currentPath="/docs" collapse="icon" brandMark={mark} storageKey="r" />);
    expect(screen.getByTestId("sidebar-brand-mark").contains(screen.getByTestId("logo"))).toBe(true);
    const docs = screen.getByTestId("sidebar-item-docs");
    expect([docs.getAttribute("aria-label"), docs.getAttribute("title")]).toEqual(["Docs", "Docs"]);
    expect(docs.className).toContain("is-active");
    const pg = screen.getByTestId("sidebar-item-playground-toggle");
    expect([pg.getAttribute("aria-label"), pg.getAttribute("title")]).toEqual(["Playground", "Playground"]);
  });

  it("children open in a flyout from the rail; Escape and a click outside close it", () => {
    localStorage.setItem("r.collapsed", "1");
    render(<AppShell lang="da" groups={NESTED} currentPath="/docs" collapse="icon" brandMark={mark} storageKey="r" />);
    expect(screen.queryByTestId("sidebar-item-history")).toBeNull();
    fireEvent.click(screen.getByTestId("sidebar-item-playground-toggle"));
    const fly = screen.getByTestId("sidebar-flyout-playground");
    expect(fly.contains(screen.getByTestId("sidebar-item-history"))).toBe(true);
    expect(fly.closest(".bas-sub")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("sidebar-flyout-playground")).toBeNull();
    fireEvent.click(screen.getByTestId("sidebar-item-playground-toggle"));
    expect(screen.getByTestId("sidebar-flyout-playground")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("sidebar-flyout-playground")).toBeNull();
  });

  it("the rail state is remembered after a remount", () => {
    const { unmount } = render(<AppShell lang="da" groups={NESTED} currentPath="/docs" collapse="icon" storageKey="r2" />);
    fireEvent.click(screen.getByTestId("sidebar-trigger"));
    unmount();
    render(<AppShell lang="da" groups={NESTED} currentPath="/docs" collapse="icon" storageKey="r2" />);
    expect(screen.getByTestId("sidebar-root").className).toContain("is-railed");
  });
});

describe("F092.7 — the logo goes to the start page", () => {
  const brand = <span>Nordlys</span>;

  it("without homeHref the brand is not a link", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" brand={brand} />);
    expect(screen.queryByTestId("brand-home")).toBeNull();
  });

  it("brand → onNavigate(homeHref); a cmd-click is left to the browser", () => {
    const nav = vi.fn();
    render(<AppShell lang="da" groups={GROUPS} currentPath="/inbox" brand={brand} homeHref="/" onNavigate={nav} />);
    const a = screen.getByTestId("brand-home");
    expect([a.tagName, a.getAttribute("href")]).toEqual(["A", "/"]);
    fireEvent.click(a, { metaKey: true });
    expect(nav).not.toHaveBeenCalled();
    fireEvent.click(a);
    expect(nav).toHaveBeenCalledWith("/");
  });

  it("phone drawer: the brand inside the drawer closes it", () => {
    mockMatchMedia(true);
    render(<AppShell lang="da" groups={GROUPS} currentPath="/inbox" brand={brand} homeHref="/" onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId("sidebar-trigger"));
    expect(screen.getByTestId("sidebar-root").className).toContain("is-open");
    fireEvent.click(screen.getByTestId("sidebar-brand-home"));
    expect(screen.getByTestId("sidebar-root").className).not.toContain("is-open");
  });

  it("the rail's brand mark is a home link with a label (homeLabel, else Forside)", () => {
    localStorage.setItem("h.collapsed", "1");
    const { unmount } = render(<AppShell lang="da" groups={GROUPS} currentPath="/" collapse="icon" brandMark={<b>B</b>} homeHref="/" storageKey="h" />);
    expect(screen.getByTestId("brand-mark-home").getAttribute("aria-label")).toBe("Forside");
    unmount();
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" collapse="icon" brandMark={<b>B</b>} homeHref="/dash" homeLabel="Nordlys" storageKey="h" />);
    const m = screen.getByTestId("brand-mark-home");
    expect([m.getAttribute("aria-label"), m.getAttribute("href")]).toEqual(["Nordlys", "/dash"]);
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

  it("a javascript: link from the server is not followed — the row only marks seen", async () => {
    const evil = { ...row("x", "Klik"), navigate: "javascript:alert(document.cookie)" };
    const src = createMemoryNotificationSource([evil]);
    const nav = vi.fn();
    render(<NotificationBell lang="da" source={src} onNavigate={nav} />);
    fireEvent.click(screen.getByTestId("topbar-notifications"));
    await waitFor(() => expect(screen.getAllByTestId("notification-row")).toHaveLength(1));
    fireEvent.click(screen.getAllByTestId("notification-row")[0]!);
    await waitFor(() => expect(src.rows()[0]!.seenAt).not.toBeNull());
    expect(nav).not.toHaveBeenCalled();
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

describe("F092.9 — «Markér alle læst» closes the panel when it worked", () => {
  const row = (id: string) => ({ id, kind: "x", title: id, body: null, navigate: null, refId: null, createdAt: Date.now(), seenAt: null });

  for (const phone of [false, true]) {
    const panel = phone ? "notifications-drawer" : "notifications-dropdown";
    it(`success closes the ${panel} and the count goes`, async () => {
      mockMatchMedia(phone);
      const src = createMemoryNotificationSource([row("a"), row("b")]);
      render(<NotificationBell lang="da" source={src} />);
      await waitFor(() => expect(screen.getByTestId("topbar-notifications-count").textContent).toBe("2"));
      fireEvent.click(screen.getByTestId("topbar-notifications"));
      await screen.findByTestId(panel);
      await waitFor(() => expect((screen.getByTestId("notifications-mark-all") as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByTestId("notifications-mark-all"));
      await waitFor(() => expect(screen.queryByTestId(panel)).toBeNull());
      await waitFor(() => expect(screen.queryByTestId("topbar-notifications-count")).toBeNull());
    });
  }

  it("failure keeps the panel open, says so, and leaves the count", async () => {
    const base = createMemoryNotificationSource([row("a")]);
    const src: NotificationSource = { ...base, markAllSeen: async () => { throw new Error("HTTP 500"); } };
    render(<NotificationBell lang="da" source={src} />);
    await waitFor(() => expect(screen.getByTestId("topbar-notifications-count").textContent).toBe("1"));
    fireEvent.click(screen.getByTestId("topbar-notifications"));
    await waitFor(() => expect((screen.getByTestId("notifications-mark-all") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("notifications-mark-all"));
    expect((await screen.findByTestId("notifications-mark-all-error")).textContent).toBe("Kunne ikke markere alle som læst. Prøv igen.");
    expect(screen.getByTestId("notifications-dropdown")).toBeTruthy();
    expect(screen.getByTestId("topbar-notifications-count").textContent).toBe("1");
  });
});

describe("F092.9 — a click outside closes the bell panel; Escape returns focus to the bell", () => {
  const row = (id: string) => ({ id, kind: "x", title: id, body: null, navigate: null, refId: null, createdAt: Date.now(), seenAt: null });

  it("mousedown on page content (not the overlay) closes the dropdown; inside the panel it does not", async () => {
    render(
      <div>
        <NotificationBell lang="da" source={createMemoryNotificationSource([row("a")])} />
        <div data-testid="dropzone">drop</div>
      </div>,
    );
    fireEvent.click(screen.getByTestId("topbar-notifications"));
    await screen.findByTestId("notifications-dropdown");
    fireEvent.mouseDown(screen.getByTestId("notifications-list"));
    expect(screen.getByTestId("notifications-dropdown")).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("dropzone"));
    await waitFor(() => expect(screen.queryByTestId("notifications-dropdown")).toBeNull());
  });

  it("Escape closes and puts focus back on the bell", async () => {
    render(<NotificationBell lang="da" source={createMemoryNotificationSource([row("a")])} />);
    fireEvent.click(screen.getByTestId("topbar-notifications"));
    await screen.findByTestId("notifications-dropdown");
    (screen.getByTestId("notifications-mark-all") as HTMLButtonElement).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("notifications-dropdown")).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId("topbar-notifications"));
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

describe("PageHeader — title optional (0.2.1)", () => {
  it("without a title: description and actions, and no h1", () => {
    render(<PageHeader description="Alle filer" actions={<button data-testid="upload">Upload</button>} />);
    const head = screen.getByTestId("page-header");
    expect(head.querySelector("h1")).toBeNull();
    expect(head.textContent).toBe("Alle filerUpload");
    expect(screen.getByTestId("upload")).toBeTruthy();
  });
  it("with a title it is still the h1", () => {
    render(<PageHeader title="Medier" />);
    expect(screen.getByTestId("page-header").querySelector("h1")!.textContent).toBe("Medier");
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
