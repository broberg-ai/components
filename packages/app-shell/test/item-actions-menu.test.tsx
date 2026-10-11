// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.29 — ItemActionsMenu on its own: a title «⌄» opens THE SAME menu as a row «…» (scout #2745).
import { afterEach, describe, expect, it, vi } from "vitest";
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
