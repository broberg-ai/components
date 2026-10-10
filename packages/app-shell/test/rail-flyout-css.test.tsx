// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.16 — the rail's flyout showed its title and NO child links: the rail rule
// `.bas-sidebar.is-railed .bas-item__label {display:none}` (0,3,0) beat the
// flyout's `{display:block}` (0,2,0), because the flyout renders inside the
// sidebar. Asserted against the real stylesheet, not the markup — the markup was
// always right, which is why the F092.6 test stayed green over an empty flyout.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { AppShell, type PreactNavGroup } from "../src/preact";

const CSS = readFileSync(resolve(__dirname, "../css/app-shell.css"), "utf8");

const NESTED: PreactNavGroup[] = [
  {
    label: "Platform",
    items: [
      { id: "playground", label: "Playground", href: "/playground", icon: <i>P</i>, children: [
        { id: "history", label: "History", href: "/playground/history" },
        { id: "starred", label: "Starred", href: "/playground/starred" },
      ] },
      { id: "docs", label: "Docs", href: "/docs", icon: <i>D</i> },
    ],
  },
];

// Node 25's global localStorage has no .clear() and shadows happy-dom's — same
// shim as preact.test.tsx, so the rail state is what is being tested.
const mem = new Map<string, string>();
const store = {
  get length() { return mem.size; },
  clear: () => mem.clear(),
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  key: (i: number) => [...mem.keys()][i] ?? null,
  removeItem: (k: string) => void mem.delete(k),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
} as Storage;
Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true });
Object.defineProperty(window, "localStorage", { value: store, configurable: true });

let style: HTMLStyleElement;
beforeEach(() => {
  localStorage.clear();
  style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
});
afterEach(() => {
  cleanup();
  style.remove();
});

describe("F092.16 — the rail's flyout shows its children", () => {
  it("child labels are displayed and the items are left-aligned with padding", () => {
    localStorage.setItem("r.collapsed", "1");
    render(<AppShell lang="da" groups={NESTED} currentPath="/docs" collapse="icon" storageKey="r" />);
    expect(screen.getByTestId("sidebar-root").className).toContain("is-railed");
    fireEvent.click(screen.getByTestId("sidebar-item-playground-toggle"));
    for (const id of ["history", "starred"]) {
      const item = screen.getByTestId(`sidebar-item-${id}`);
      const label = item.querySelector(".bas-item__label") as HTMLElement;
      const ls = getComputedStyle(label);
      const is = getComputedStyle(item);
      expect([id, ls.display, is.justifyContent, is.paddingLeft]).toEqual([id, "block", "flex-start", "8px"]);
    }
  });

  it("the rail itself still hides its own labels (negative control)", () => {
    localStorage.setItem("r.collapsed", "1");
    render(<AppShell lang="da" groups={NESTED} currentPath="/docs" collapse="icon" storageKey="r" />);
    const docs = screen.getByTestId("sidebar-item-docs");
    expect(getComputedStyle(docs.querySelector(".bas-item__label") as HTMLElement).display).toBe("none");
    expect(getComputedStyle(docs).justifyContent).toBe("center");
  });
});
