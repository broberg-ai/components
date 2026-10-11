// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.24 — the app's default text size (fontScale) and the sidebar row tokens.
// Christian via scout #2716: «et site/app skal kunne have større skrifttyper hvis
// kunden (mig) som default synes det».
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import { AppShell, type PreactNavGroup } from "../src/preact";

const CSS = readFileSync(resolve(__dirname, "../css/app-shell.css"), "utf8");
afterEach(cleanup);
const m = new Map<string, string>();
const store = { get length() { return m.size; }, clear: () => m.clear(), getItem: (k: string) => m.get(k) ?? null, key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => void m.delete(k), setItem: (k: string, v: string) => void m.set(k, String(v)) } as Storage;
Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true });
Object.defineProperty(window, "localStorage", { value: store, configurable: true });
beforeEach(() => {
  store.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});
const GROUPS: PreactNavGroup[] = [{ label: "Menu", items: [{ id: "a", label: "A", href: "/a" }] }];

describe("F092.24 — fontScale: the app's default text size", () => {
  it("no fixed px font-size is left: every size scales with --bas-font-scale", () => {
    const sizes = [...CSS.matchAll(/font-size:\s*([^;}]+)/g)].map((x) => x[1]!.trim());
    expect(sizes.length).toBeGreaterThan(50);
    expect(sizes.filter((v) => !v.includes("var(--bas-font-scale, 1)"))).toEqual([]);
  });

  it("the scale is NOT declared on .bas-root (an app's :root value must not be shadowed)", () => {
    const root = CSS.match(/\.bas-root \{[^}]*\}/)![0];
    expect(root.includes("--bas-font-scale:")).toBe(false);
  });

  it("fontScale sets --bas-font-scale on the root; without it there is no inline style", () => {
    const { unmount } = render(<AppShell lang="da" groups={GROUPS} currentPath="/" storageKey="t" fontScale={1.2} />);
    expect(screen.getByTestId("app-shell").style.getPropertyValue("--bas-font-scale")).toBe("1.2");
    unmount();
    render(<AppShell lang="da" groups={GROUPS} currentPath="/" storageKey="t" />);
    expect(screen.getByTestId("app-shell").getAttribute("style")).toBe(null);
  });
});

describe("F092.24 — sidebar row tokens, current values as fallbacks", () => {
  const rule = (sel: string) => CSS.match(new RegExp(sel.replace(/[.*]/g, "\\$&") + " \\{[^}]*\\}"))![0];
  it("menu items and history rows (.bas-item) read the tokens", () => {
    const item = rule(".bas-item");
    for (const d of [
      "gap: var(--bas-item-gap, 10px)",
      "padding: var(--bas-item-padding, 7px 10px)",
      "border-radius: var(--bas-item-radius, 6px)",
      "font-size: var(--bas-item-font-size, calc(13px * var(--bas-font-scale, 1)))",
    ]) expect(item).toContain(d);
    expect(rule(".bas-item.is-active")).toContain("background: var(--bas-item-active-bg, var(--accent-soft))");
    expect(rule(".bas-item.is-active")).toContain("font-weight: var(--bas-item-active-weight, 500)");
    expect(rule(".bas-item__icon")).toContain("color: var(--bas-item-icon-color, var(--fg-subtle))");
  });
});

describe("F092.25 — line-height token (scout #2720: «samme afstand som i Claude Desktop»)", () => {
  it("rows read --bas-item-line-height with NO fallback, so an unset token inherits exactly as before", () => {
    const item = CSS.match(/\.bas-item \{[^}]*\}/)![0];
    expect(item).toContain("line-height: var(--bas-item-line-height);");
  });
});
