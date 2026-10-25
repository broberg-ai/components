// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.37 — helpdesk switches pages with ?fane=<id>, which the path cannot see:
// the app says which item is active (activeId), and an item can keep its own testid.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import { AppShell, type PreactNavGroup } from "../src/preact";
import { activeNavLabel } from "../src/index";

const GROUPS: PreactNavGroup[] = [
  { label: "Main", items: [
    { id: "a", label: "Alfa", href: "/?fane=a" },
    { id: "b", label: "Beta", href: "/?fane=b" },
    { id: "p", label: "Parent", href: "/?fane=p", children: [{ id: "c", label: "Child", href: "/?fane=c" }] },
  ] },
];
const setMobile = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as never;
};
beforeEach(() => {
  const m = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { value: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 }, configurable: true });
  setMobile(false);
});
afterEach(cleanup);

const active = () => [...document.querySelectorAll(".bas-sidebar .is-active")].map((e) => e.getAttribute("data-testid"));

describe("F092.37 — activeId", () => {
  it("without activeId, ?fane=… makes every item look active (the reported defect, unchanged)", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/?fane=b" />);
    // Every "/?fane=…" item reads as "/" — a, b and the open child c.
    expect(active()).toEqual(["sidebar-item-a", "sidebar-item-b", "sidebar-item-c"]);
  });

  it("with activeId=\"b\" only b is active and carries aria-current", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/?fane=b" activeId="b" />);
    expect(active()).toEqual(["sidebar-item-b"]);
    expect(screen.getByTestId("sidebar-item-b").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("sidebar-item-a").getAttribute("aria-current")).toBeNull();
  });

  it("activeId on a child makes its parent active and names the page title", () => {
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" activeId="c" />);
    expect(screen.getByTestId("sidebar-item-p-toggle").className).toContain("is-parent-active");
    expect(activeNavLabel(GROUPS, undefined, "/", "c")).toBe("Child");
    expect(activeNavLabel(GROUPS, undefined, "/?fane=b")).toBe("Alfa");
  });

  it("the phone's bottom tab bar marks the same item", () => {
    setMobile(true);
    render(<AppShell lang="da" groups={GROUPS} currentPath="/?fane=b" activeId="b" mobile="bottom-nav" />);
    const on = [...screen.getByTestId("mobile-bottom-nav").querySelectorAll(".is-active")].map((e) => e.getAttribute("data-testid"));
    expect(on).toEqual(["mobile-bottom-nav-b"]);
  });
});

describe("F092.37 — NavItem.testid", () => {
  it("replaces the item link's testid; without it the default stays", () => {
    const groups: PreactNavGroup[] = [{ label: "Main", items: [{ id: "x", label: "X", href: "/x", testid: "nav-x" }, { id: "y", label: "Y", href: "/y" }] }];
    render(<AppShell lang="da" groups={groups} currentPath="/x" />);
    expect(screen.getByTestId("nav-x").getAttribute("href")).toBe("/x");
    expect(screen.queryByTestId("sidebar-item-x")).toBeNull();
    expect(screen.getByTestId("sidebar-item-y").getAttribute("href")).toBe("/y");
  });
});
