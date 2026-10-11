// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.20 — the sidebar can carry a chat history (scout-F011.2): a "working"
// marker, a pin, and a plain group with day sub-headings.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { Sidebar, type PreactNavGroup } from "../src/preact";
import { vi } from "vitest";

afterEach(cleanup);
// Node 25's global localStorage has no .clear(); give the shell a real store (as preact.test.tsx).
const m = new Map<string, string>();
const store = { get length() { return m.size; }, clear: () => m.clear(), getItem: (k: string) => m.get(k) ?? null, key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => void m.delete(k), setItem: (k: string, v: string) => void m.set(k, String(v)) } as Storage;
Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true });
Object.defineProperty(window, "localStorage", { value: store, configurable: true });
beforeEach(() => {
  store.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});

const HISTORY: PreactNavGroup[] = [
  {
    label: "Historik",
    variant: "plain",
    items: [{ id: "c1", label: "Fastgjort samtale om budgettet for næste kvartal", href: "/c/1", pinned: true }],
    sections: [
      { label: "I dag", items: [{ id: "c2", label: "Kørende job", href: "/c/2", marker: "working" }, { id: "c3", label: "Rapport", href: "/c/3" }] },
      { label: "I går", items: [{ id: "c4", label: "Gammel", href: "/c/4" }] },
    ],
  },
];

describe("F092.20 — markers, pin, plain group, sections", () => {
  it("marker and pin render with Danish labels; title is the full label", () => {
    render(<Sidebar lang="da" groups={HISTORY} currentPath="/c/3" />);
    expect(screen.getByTestId("sidebar-item-c2-marker").getAttribute("aria-label")).toBe("Arbejder");
    expect(screen.getByTestId("sidebar-item-c1-pinned").getAttribute("aria-label")).toBe("Fastgjort");
    expect(screen.queryByTestId("sidebar-item-c3-marker")).toBeNull();
    expect(screen.queryByTestId("sidebar-item-c2-pinned")).toBeNull();
    expect(screen.getByTestId("sidebar-item-c1").getAttribute("title")).toBe("Fastgjort samtale om budgettet for næste kvartal");
  });

  it("English labels follow lang", () => {
    render(<Sidebar lang="en" groups={HISTORY} currentPath="/" />);
    expect([screen.getByTestId("sidebar-item-c2-marker").getAttribute("aria-label"), screen.getByTestId("sidebar-item-c1-pinned").getAttribute("aria-label")]).toEqual(["Working", "Pinned"]);
  });

  it("plain variant + sections: sub-headings in order, active item works inside a section, the group still collapses", () => {
    render(<Sidebar lang="da" groups={HISTORY} currentPath="/c/3" />);
    const group = screen.getByTestId("sidebar-group-historik").parentElement!;
    expect(group.classList.contains("bas-group--plain")).toBe(true);
    expect([...group.querySelectorAll(".bas-section__label")].map((n) => n.textContent)).toEqual(["I dag", "I går"]);
    expect(screen.getByTestId("sidebar-section-historik-i-dag").textContent).toContain("Rapport");
    expect(screen.getByTestId("sidebar-item-c3").getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByTestId("sidebar-group-historik"));
    expect([screen.queryByTestId("sidebar-item-c1"), screen.queryByTestId("sidebar-section-historik-i-dag")]).toEqual([null, null]);
  });

  it("without the new fields the markup is unchanged (no marker/pin/section nodes, plain class absent)", () => {
    const { container } = render(
      <Sidebar lang="da" groups={[{ label: "Overview", items: [{ id: "home", label: "Home", href: "/" }] }]} currentPath="/" />,
    );
    expect(container.querySelectorAll(".bas-item__marker, .bas-item__pin, .bas-section, .bas-group--plain").length).toBe(0);
    expect(container.querySelector(".bas-group")!.className).toBe("bas-group");
  });
});

describe("F092.21 — row actions", () => {
  const ACTIONS = [
    { id: "pin", label: "Fastgør", kbd: "P" },
    { id: "rename", label: "Omdøb", kbd: "R", input: { value: "Rapport" } },
    { id: "move", label: "Flyt til", submenu: [{ id: "move-a", label: "Projekt A" }, { id: "move-b", label: "Projekt B" }] },
    { id: "delete", label: "Slet", kbd: "D", danger: true },
  ];
  const groups: PreactNavGroup[] = [{ label: "Historik", items: [{ id: "c3", label: "Rapport", href: "/c/3", actions: ACTIONS }, { id: "c4", label: "Uden", href: "/c/4" }] }];
  const setup = () => {
    const onItemAction = vi.fn();
    render(<Sidebar lang="da" groups={groups} currentPath="/" onItemAction={onItemAction} />);
    return onItemAction;
  };

  it("«…» only on items with actions, labelled, opens a menu with one button per action; danger is marked", () => {
    setup();
    expect(screen.queryByTestId("sidebar-item-c4-more")).toBeNull();
    const more = screen.getByTestId("sidebar-item-c3-more");
    expect([more.getAttribute("aria-label"), more.getAttribute("aria-haspopup"), more.getAttribute("aria-expanded")]).toEqual(["Mere for Rapport", "menu", "false"]);
    fireEvent.click(more);
    expect(screen.getByTestId("sidebar-item-c3-menu").getAttribute("role")).toBe("menu");
    expect(["pin", "rename", "move", "delete"].map((a) => !!screen.queryByTestId(`sidebar-item-c3-action-${a}`))).toEqual([true, true, true, true]);
    expect(screen.getByTestId("sidebar-item-c3-action-delete").classList.contains("is-danger")).toBe(true);
    // the item link is still a plain link to its page
    expect(screen.getByTestId("sidebar-item-c3").getAttribute("href")).toBe("/c/3");
  });

  it("click an action → onItemAction(item, action) and the menu closes, focus back on «…»", () => {
    const fn = setup();
    fireEvent.click(screen.getByTestId("sidebar-item-c3-more"));
    fireEvent.click(screen.getByTestId("sidebar-item-c3-action-pin"));
    expect(fn.mock.calls).toEqual([["c3", "pin"]]);
    expect(screen.queryByTestId("sidebar-item-c3-menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("sidebar-item-c3-more"));
  });

  it("keys: arrows move, Enter picks; a kbd letter picks; Escape closes without a call", () => {
    const fn = setup();
    fireEvent.click(screen.getByTestId("sidebar-item-c3-more"));
    const menu = screen.getByTestId("sidebar-item-c3-menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByTestId("sidebar-item-c3-action-move").classList.contains("is-active")).toBe(true);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect([fn.mock.calls.length, screen.queryByTestId("sidebar-item-c3-menu")]).toEqual([0, null]);
    fireEvent.click(screen.getByTestId("sidebar-item-c3-more"));
    fireEvent.keyDown(screen.getByTestId("sidebar-item-c3-menu"), { key: "d" });
    expect(fn.mock.calls).toEqual([["c3", "delete"]]);
    fireEvent.click(screen.getByTestId("sidebar-item-c3-more"));
    fireEvent.keyDown(screen.getByTestId("sidebar-item-c3-menu"), { key: "Enter" }); // highlighted = first
    expect(fn.mock.calls.at(-1)).toEqual(["c3", "pin"]);
  });

  it("submenu: switches to the sub-list with a back arrow; back returns; a leaf calls onItemAction", () => {
    const fn = setup();
    fireEvent.click(screen.getByTestId("sidebar-item-c3-more"));
    fireEvent.click(screen.getByTestId("sidebar-item-c3-action-move"));
    expect([!!screen.queryByTestId("sidebar-item-c3-back"), !!screen.queryByTestId("sidebar-item-c3-action-move-a"), screen.queryByTestId("sidebar-item-c3-action-pin")]).toEqual([true, true, null]);
    fireEvent.click(screen.getByTestId("sidebar-item-c3-back"));
    expect([screen.queryByTestId("sidebar-item-c3-back"), !!screen.queryByTestId("sidebar-item-c3-action-pin")]).toEqual([null, true]);
    fireEvent.click(screen.getByTestId("sidebar-item-c3-action-move"));
    fireEvent.click(screen.getByTestId("sidebar-item-c3-action-move-b"));
    expect(fn.mock.calls).toEqual([["c3", "move-b"]]);
  });

  it("input (rename): prefilled; Enter saves the edited value; Escape cancels without a call", () => {
    const fn = setup();
    fireEvent.click(screen.getByTestId("sidebar-item-c3-more"));
    fireEvent.keyDown(screen.getByTestId("sidebar-item-c3-menu"), { key: "r" });
    const input = screen.getByTestId("sidebar-item-c3-input") as HTMLInputElement;
    expect(input.value).toBe("Rapport");
    fireEvent.keyDown(screen.getByTestId("sidebar-item-c3-menu"), { key: "Escape" });
    expect([fn.mock.calls.length, screen.queryByTestId("sidebar-item-c3-input")]).toEqual([0, null]);
    fireEvent.click(screen.getByTestId("sidebar-item-c3-more"));
    fireEvent.click(screen.getByTestId("sidebar-item-c3-action-rename"));
    const field = screen.getByTestId("sidebar-item-c3-input") as HTMLInputElement;
    fireEvent.input(field, { target: { value: "Rapport Q4" } });
    fireEvent.keyDown(screen.getByTestId("sidebar-item-c3-menu"), { key: "Enter" });
    expect(fn.mock.calls).toEqual([["c3", "rename", "Rapport Q4"]]);
    fireEvent.click(screen.getByTestId("sidebar-item-c3-more"));
    fireEvent.click(screen.getByTestId("sidebar-item-c3-action-rename"));
    fireEvent.click(screen.getByTestId("sidebar-item-c3-save"));
    expect(fn.mock.calls.at(-1)).toEqual(["c3", "rename", "Rapport"]);
  });

  it("the menu is a fixed popover and closes when something outside is pressed", () => {
    setup();
    fireEvent.click(screen.getByTestId("sidebar-item-c3-more"));
    expect(screen.getByTestId("sidebar-item-c3-menu").style.position).toBe("fixed");
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("sidebar-item-c3-menu")).toBeNull();
  });
});
