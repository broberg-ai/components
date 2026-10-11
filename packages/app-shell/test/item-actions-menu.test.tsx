// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.29 — ItemActionsMenu on its own: a title «⌄» opens THE SAME menu as a row «…» (scout #2745).
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { useRef, useState } from "preact/hooks";
import { ItemActionsMenu } from "../src/preact";
import type { NavAction } from "../src/index";

afterEach(cleanup);
const tick = () => new Promise((r) => setTimeout(r, 0));
const ACTIONS: NavAction[] = [
  { id: "pin", label: "Fastgør", kbd: "P" },
  { id: "rename", label: "Omdøb", kbd: "R", input: { value: "Rapport" } },
  { id: "project", label: "Tilføj til projekt", submenu: [{ id: "p-a", label: "Projekt A" }] },
  { id: "delete", label: "Slet", kbd: "D", danger: true, confirm: { label: "Tryk igen for at slette" } },
  { id: "share", label: "Del chat" },
];

function Title(p: { onAction: (id: string, v?: string) => void; onClose?: () => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={anchor} data-testid="title-trigger" onClick={() => setOpen(!open)}>Rapport ⌄</button>
      {open && anchor.current ? (
        <ItemActionsMenu actions={ACTIONS} anchor={anchor.current} lang="da" label="Rapport" testidPrefix="title" placement="down" onAction={p.onAction} onClose={() => { setOpen(false); p.onClose?.(); }} />
      ) : null}
    </>
  );
}
const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k });

describe("F092.29 — ItemActionsMenu used freely (a title anchor)", () => {
  it("opens with focus on the first item; P picks; the menu closes", async () => {
    const fn = vi.fn();
    render(<Title onAction={fn} />);
    fireEvent.click(screen.getByTestId("title-trigger"));
    await tick();
    expect(screen.getByTestId("title-menu").getAttribute("role")).toBe("menu"); // it really opened (the absence checks below mean something)
    expect(document.activeElement).toBe(screen.getByTestId("title-action-pin"));
    key("p");
    await tick();
    expect([fn.mock.calls, !!screen.queryByTestId("title-menu")]).toEqual([[["pin"]], false]);
  });

  it("Enter on a focused submenu item opens the submenu and fires nothing", async () => {
    const fn = vi.fn();
    render(<Title onAction={fn} />);
    fireEvent.click(screen.getByTestId("title-trigger"));
    await tick();
    screen.getByTestId("title-action-project").focus();
    key("Enter");
    await tick();
    expect([fn.mock.calls.length, !!screen.queryByTestId("title-action-p-a"), !!screen.queryByTestId("title-back")]).toEqual([0, true, true]);
  });

  it("D D confirms; the input action returns its text", async () => {
    const fn = vi.fn();
    render(<Title onAction={fn} />);
    fireEvent.click(screen.getByTestId("title-trigger"));
    await tick();
    key("d");
    expect([fn.mock.calls.length, screen.getByTestId("title-action-delete").querySelector(".bas-rowmenu__label")!.textContent]).toEqual([0, "Tryk igen for at slette"]);
    key("d");
    await tick();
    expect(fn.mock.calls).toEqual([["delete"]]);
    fireEvent.click(screen.getByTestId("title-trigger"));
    await tick();
    key("r");
    await tick();
    fireEvent.input(screen.getByTestId("title-input"), { target: { value: "Ny titel" } });
    fireEvent.click(screen.getByTestId("title-save"));
    expect(fn.mock.calls[1]).toEqual(["rename", "Ny titel"]);
  });

  it("Escape closes, calls onClose, and returns focus to the anchor; a click outside closes too", async () => {
    const onClose = vi.fn();
    render(<><Title onAction={() => {}} onClose={onClose} /><p data-testid="outside">x</p></>);
    fireEvent.click(screen.getByTestId("title-trigger"));
    await tick();
    key("Escape");
    await tick();
    expect([onClose.mock.calls.length, document.activeElement, !!screen.queryByTestId("title-menu")]).toEqual([1, screen.getByTestId("title-trigger"), false]);
    fireEvent.click(screen.getByTestId("title-trigger"));
    await tick();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    await tick();
    expect([onClose.mock.calls.length, !!screen.queryByTestId("title-menu")]).toEqual([2, false]);
  });
});

describe("F092.31 — placement up-start (scout #2790: «+» in a composer)", () => {
  const at = (rect: Partial<DOMRect>) => {
    const a = document.createElement("button");
    document.body.appendChild(a);
    a.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...rect }) as DOMRect;
    return a;
  };
  const menuStyle = () => screen.getByTestId("plus-menu").style;
  const open = async (anchor: HTMLElement, placement?: "auto" | "down" | "up-start") => {
    render(<ItemActionsMenu actions={ACTIONS} anchor={anchor} lang="da" label="Plus" testidPrefix="plus" placement={placement} onAction={() => {}} onClose={() => {}} />);
    await tick();
  };
  it("opens ABOVE the anchor, left edge = anchor.left", async () => {
    Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
    await open(at({ top: 800, bottom: 836, left: 260, right: 296 }), "up-start");
    expect([menuStyle().left, menuStyle().top]).toEqual(["260px", "796px"]); // h=0 in happy-dom: bottom edge = anchor.top - 4
  });
  it("clamps inside the viewport (8px margin)", async () => {
    Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
    await open(at({ top: 800, bottom: 836, left: 1400, right: 1436 }), "up-start");
    expect(menuStyle().left).toBe(`${1440 - 240 - 8}px`);
  });
  it("falls back below when there is no room above", async () => {
    Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
    await open(at({ top: 2, bottom: 38, left: 260, right: 296 }), "up-start");
    expect(menuStyle().top).toBe("42px");
  });
  it("auto is unchanged: right-aligned to the anchor's right edge", async () => {
    Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
    await open(at({ top: 100, bottom: 136, left: 260, right: 296 }));
    expect([menuStyle().left, menuStyle().top]).toEqual([`${296 - 240}px`, "140px"]);
  });
});

describe("F092.32 — a robust menu (scout #2801: value, separator, size, keyboard-only ring)", () => {
  const FILTERS: NavAction[] = [
    { id: "type", label: "Type", value: "All", submenu: [{ id: "t-all", label: "All" }] },
    { id: "status", label: "Status", value: "Active" },
    { id: "group", label: "Group by", value: "Project", separator: true },
  ];
  const open = async (keyboardAnchor: boolean) => {
    const a = document.createElement("button");
    document.body.appendChild(a);
    a.matches = (s: string) => (s === ":focus-visible" ? keyboardAnchor : Element.prototype.matches.call(a, s));
    render(<ItemActionsMenu actions={FILTERS} anchor={a} lang="da" label="Filter" testidPrefix="filter" onAction={() => {}} onClose={() => {}} />);
    await tick();
    return screen.getByTestId("filter-menu");
  };

  it("value: shown after the label, before the chevron; absent when not set", async () => {
    await open(false);
    const row = screen.getByTestId("filter-action-type");
    const value = screen.getByTestId("filter-action-type-value");
    expect(value.textContent).toBe("All");
    expect(value.previousElementSibling?.className).toBe("bas-rowmenu__label");
    expect(value.nextElementSibling?.tagName.toLowerCase()).toBe("svg");
    expect(row.querySelectorAll(".bas-rowmenu__value").length).toBe(1);
    expect(screen.getByTestId("filter-action-status-value").textContent).toBe("Active");
  });

  it("separator: a role=separator line right BEFORE the item, and ↓ steps over it", async () => {
    const menu = await open(false);
    const group = screen.getByTestId("filter-action-group");
    expect(group.previousElementSibling?.getAttribute("role")).toBe("separator");
    expect(menu.querySelectorAll('[role="separator"]').length).toBe(1);
    screen.getByTestId("filter-action-status").focus();
    key("ArrowDown");
    await tick();
    expect(document.activeElement).toBe(group);
  });

  it("focus ring: off after a mouse open, on after a key in the menu", async () => {
    const menu = await open(false);
    expect(document.activeElement).toBe(screen.getByTestId("filter-action-type")); // focus still moves in
    expect(menu.classList.contains("is-kbd")).toBe(false);
    key("ArrowDown");
    await tick();
    expect(menu.classList.contains("is-kbd")).toBe(true);
  });

  it("focus ring: on at open when the anchor was keyboard-focused (Tab + Enter)", async () => {
    const menu = await open(true);
    expect(menu.classList.contains("is-kbd")).toBe(true);
  });

  it("CSS: the outline is drawn only under .is-kbd; size tokens default to scout's measurement", () => {
    const css = readFileSync(resolve(__dirname, "../css/app-shell.css"), "utf8");
    expect(css).toMatch(/\.bas-rowmenu__item:focus, \.bas-rowmenu__back:focus \{ outline: none; \}/);
    expect(css).toMatch(/\.bas-rowmenu\.is-kbd \.bas-rowmenu__item:focus[^{]*\{ outline: 2px solid/);
    const item = css.match(/\.bas-rowmenu__item, \.bas-rowmenu__back \{[^}]*\}/)![0];
    expect(item).toContain("min-height: var(--bas-menu-row-height, 44px)");
    expect(item).toContain("font-size: var(--bas-menu-font-size, calc(17px * var(--bas-font-scale, 1)))");
    const panel = css.match(/\.bas-rowmenu \{[^}]*\}/)![0];
    expect(panel).toContain("border-radius: var(--bas-menu-radius, 14px)");
    expect(panel).toContain("padding: var(--bas-menu-padding, 6px)");
    expect(css).toMatch(/\.bas-rowmenu__value \{[^}]*color: var\(--fg-muted\)/);
  });
});

describe("F092.33 — a long value clips the value, never the label (scout #2830)", () => {
  const css = () => readFileSync(resolve(__dirname, "../css/app-shell.css"), "utf8");
  it("the label keeps its content width; the value shrinks first and ellipses", () => {
    const label = css().match(/\.bas-rowmenu__label \{[^}]*\}/)![0];
    const value = css().match(/\.bas-rowmenu__value \{[^}]*\}/)![0];
    expect(label).toContain("flex: 1 1 auto");
    expect(value).toContain("flex: 0 1000 auto");
    expect(value).toContain("min-width: 0");
    expect(value).toContain("text-overflow: ellipsis");
  });
  it("the menu sizes to its content between 240 and 320px; JS sets no fixed width", async () => {
    const panel = css().match(/\.bas-rowmenu \{[^}]*\}/)![0];
    expect(panel).toContain("min-width: var(--bas-menu-min-width, 240px)");
    expect(panel).toContain("max-width: min(var(--bas-menu-max-width, 320px), calc(100vw - 16px))");
    const a = document.createElement("button");
    document.body.appendChild(a);
    render(<ItemActionsMenu actions={ACTIONS} anchor={a} lang="da" label="W" testidPrefix="w" onAction={() => {}} onClose={() => {}} />);
    await tick();
    expect(screen.getByTestId("w-menu").style.width).toBe("");
  });
});
