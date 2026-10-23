// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F018.4 — the Preact shell, asserted on what the DOM shows (strict equality).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { createPaletteController, type PaletteItem } from "../src/index";
import { CommandPalette, CommandPaletteProvider, useCommandPalette } from "../src/preact";

afterEach(cleanup);

function setup(extra: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const ran: string[] = [];
  const items: PaletteItem[] = [
    { id: "inbox", label: "Inbox", group: "Navigation", action: () => ran.push("inbox") },
    { id: "new", label: "New mail", group: "Actions", action: () => ran.push("new") },
    { id: "settings", label: "Settings", group: "Navigation", action: () => ran.push("settings") },
    { id: "docs", label: "Docs", group: "Links", href: "/docs" },
  ];
  const controller = createPaletteController({ items });
  render(<CommandPalette controller={controller} placeholder="Søg…" emptyText="Ingen resultater" {...extra} />);
  return { controller, ran };
}

const input = () => screen.getByTestId("command-palette-search-input") as HTMLInputElement;
const activeId = () => document.querySelector(".bcmdk-item.is-active")?.getAttribute("data-testid");
const key = (k: string) => fireEvent.keyDown(input(), { key: k });

describe("CommandPalette (preact)", () => {
  it("renders nothing while closed, and the full testid set once open", () => {
    const { controller } = setup();
    expect(screen.queryByTestId("command-palette-root")).toBe(null);
    act(() => controller.open());
    for (const id of ["root", "backdrop", "search-input", "close", "item-inbox", "item-new", "item-settings", "item-docs"]) {
      expect(screen.getByTestId(`command-palette-${id}`)).toBeTruthy();
    }
    expect(input().placeholder).toBe("Søg…");
  });

  it("groups rows by item.group in order of first appearance", () => {
    const { controller } = setup();
    act(() => controller.open());
    const titles = [...document.querySelectorAll(".bcmdk-group-title")].map((n) => n.textContent);
    expect(titles).toEqual(["Navigation", "Actions", "Links"]);
    const order = [...document.querySelectorAll(".bcmdk-item")].map((n) => n.getAttribute("data-testid"));
    expect(order).toEqual([
      "command-palette-item-inbox",
      "command-palette-item-settings",
      "command-palette-item-new",
      "command-palette-item-docs",
    ]);
  });

  it("ArrowDown/ArrowUp walk the VISUAL order and wrap; aria-activedescendant follows", () => {
    const { controller } = setup();
    act(() => controller.open());
    expect(activeId()).toBe("command-palette-item-inbox");
    key("ArrowDown");
    // results order is inbox,new,settings — visually settings comes second.
    expect(activeId()).toBe("command-palette-item-settings");
    key("ArrowDown");
    expect(activeId()).toBe("command-palette-item-new");
    key("ArrowDown");
    key("ArrowDown");
    expect(activeId()).toBe("command-palette-item-inbox"); // wrapped
    key("ArrowUp");
    expect(activeId()).toBe("command-palette-item-docs"); // wrapped backwards
    const active = document.querySelector(".bcmdk-item.is-active")!;
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-activedescendant")).toBe(active.id);
    expect(active.getAttribute("aria-selected")).toBe("true");
  });

  it("typing filters; no match shows the empty state", () => {
    const { controller } = setup();
    act(() => controller.open());
    fireEvent.input(input(), { target: { value: "sett" } });
    expect([...document.querySelectorAll(".bcmdk-item")].map((n) => n.getAttribute("data-testid"))).toEqual([
      "command-palette-item-settings",
    ]);
    fireEvent.input(input(), { target: { value: "zzzz" } });
    expect(screen.getByTestId("command-palette-empty").textContent).toBe("Ingen resultater");
  });

  it("Enter runs the highlighted action and closes", () => {
    const { controller, ran } = setup();
    act(() => controller.open());
    key("ArrowDown");
    key("Enter");
    expect(ran).toEqual(["settings"]);
    expect(controller.getState().open).toBe(false);
    expect(screen.queryByTestId("command-palette-root")).toBe(null);
  });

  it("an href item goes to onNavigate, not location", () => {
    const nav = vi.fn();
    const { controller } = setup({ onNavigate: nav });
    act(() => controller.open());
    fireEvent.click(screen.getByTestId("command-palette-item-docs"));
    expect(nav.mock.calls.map((c) => c[0])).toEqual(["/docs"]);
  });

  it("Escape and the backdrop close; focus returns to the opener", async () => {
    const { controller } = setup();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    act(() => controller.open());
    await waitFor(() => expect(document.activeElement).toBe(input()));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(controller.getState().open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("");
    act(() => controller.open());
    fireEvent.click(screen.getByTestId("command-palette-backdrop"));
    expect(controller.getState().open).toBe(false);
    opener.remove();
  });
});

describe("CommandPaletteProvider", () => {
  function Opener() {
    const palette = useCommandPalette();
    return <button data-testid="open-btn" onClick={() => palette.open()}>open</button>;
  }

  it("Cmd+K and Ctrl+K both toggle, with preventDefault; useCommandPalette opens programmatically", () => {
    const changes: boolean[] = [];
    render(
      <CommandPaletteProvider items={[{ id: "a", label: "Alpha" }]} onOpenChange={(o) => changes.push(o)}>
        <Opener />
      </CommandPaletteProvider>,
    );
    const ev = new KeyboardEvent("keydown", { key: "k", metaKey: true, cancelable: true });
    act(() => void window.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByTestId("command-palette-item-a")).toBeTruthy();
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "K", ctrlKey: true, cancelable: true })));
    expect(screen.queryByTestId("command-palette-root")).toBe(null);
    fireEvent.click(screen.getByTestId("open-btn"));
    expect(screen.getByTestId("command-palette-root")).toBeTruthy();
    expect(changes).toEqual([true, false, true]);
  });

  it("a controlled open prop drives the palette", () => {
    const { rerender } = render(<CommandPaletteProvider items={[{ id: "a", label: "Alpha" }]} open={false} />);
    expect(screen.queryByTestId("command-palette-root")).toBe(null);
    rerender(<CommandPaletteProvider items={[{ id: "a", label: "Alpha" }]} open={true} />);
    expect(screen.getByTestId("command-palette-root")).toBeTruthy();
  });
});

describe("source guard", () => {
  it("the shell imports no react, next/* or preact-iso", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/preact.tsx"), "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports.filter((s) => /^(react|react-dom|next|preact-iso)(\/|$)/.test(s))).toEqual([]);
  });
});
