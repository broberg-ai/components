// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.20 — the sidebar can carry a chat history (scout-F011.2): a "working"
// marker, a pin, and a plain group with day sub-headings.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { Sidebar, type PreactNavGroup } from "../src/preact";
import { vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

describe("F092.22 — focus, Enter on the focused item, confirm", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const ACTIONS = [
    { id: "pin", label: "Fastgør", kbd: "P" },
    { id: "project", label: "Tilføj til projekt", submenu: [{ id: "p-a", label: "Projekt A" }] },
    { id: "delete", label: "Slet", kbd: "D", danger: true, confirm: { label: "Tryk igen for at slette" } },
  ];
  const setup = () => {
    const fn = vi.fn();
    render(<Sidebar lang="da" groups={[{ label: "H", items: [{ id: "c", label: "Samtale", href: "/c", actions: ACTIONS }] }]} currentPath="/" onItemAction={fn} />);
    return fn;
  };
  const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k }); // where the USER's keys go

  it("opening moves focus INTO the menu (first item), and a shortcut sent to the focused element works", async () => {
    const fn = setup();
    screen.getByTestId("sidebar-item-c-more").focus();
    fireEvent.click(screen.getByTestId("sidebar-item-c-more"));
    await tick();
    expect(document.activeElement).toBe(screen.getByTestId("sidebar-item-c-action-pin"));
    key("p");
    expect(fn.mock.calls).toEqual([["c", "pin"]]);
  });

  it("arrows move real focus; Enter acts on the FOCUSED item — a submenu opens, nothing else fires (scout #2662)", async () => {
    const fn = setup();
    fireEvent.click(screen.getByTestId("sidebar-item-c-more"));
    await tick();
    key("ArrowDown");
    await tick();
    expect(document.activeElement).toBe(screen.getByTestId("sidebar-item-c-action-project"));
    key("Enter");
    await tick();
    expect([fn.mock.calls.length, !!screen.queryByTestId("sidebar-item-c-action-p-a")]).toEqual([0, true]);
  });

  it("Enter after focusing an item directly (Tab/programmatic) acts on THAT item, not the highlighted first", async () => {
    const fn = setup();
    fireEvent.click(screen.getByTestId("sidebar-item-c-more"));
    await tick();
    screen.getByTestId("sidebar-item-c-action-delete").focus();
    key("Enter"); // arms
    expect(fn.mock.calls).toEqual([]);
    expect(screen.getByTestId("sidebar-item-c-action-delete").textContent).toContain("Tryk igen for at slette");
  });

  it("confirm: first pick arms and keeps the menu open; second pick runs; closing resets", async () => {
    const fn = setup();
    fireEvent.click(screen.getByTestId("sidebar-item-c-more"));
    await tick();
    fireEvent.click(screen.getByTestId("sidebar-item-c-action-delete"));
    expect([fn.mock.calls.length, !!screen.queryByTestId("sidebar-item-c-menu")]).toEqual([0, true]);
    fireEvent.click(screen.getByTestId("sidebar-item-c-action-delete"));
    expect(fn.mock.calls).toEqual([["c", "delete"]]);
    // reset: arm, Escape, reopen → label is back to «Slet»
    fireEvent.click(screen.getByTestId("sidebar-item-c-more"));
    await tick();
    fireEvent.click(screen.getByTestId("sidebar-item-c-action-delete"));
    key("Escape");
    fireEvent.click(screen.getByTestId("sidebar-item-c-more"));
    await tick();
    expect(screen.getByTestId("sidebar-item-c-action-delete").querySelector(".bas-rowmenu__label")!.textContent).toBe("Slet");
  });
});

describe("F092.22 — keys typed before focus reaches the menu", () => {
  it("an ArrowDown on «…» while the menu is open moves the menu; Enter on «…» never picks an item", async () => {
    const fn = vi.fn();
    render(<Sidebar lang="da" groups={[{ label: "H", items: [{ id: "c", label: "S", href: "/c", actions: [{ id: "a", label: "A" }, { id: "b", label: "B", kbd: "B" }] }] }]} currentPath="/" onItemAction={fn} />);
    const more = screen.getByTestId("sidebar-item-c-more");
    fireEvent.click(more);
    fireEvent.keyDown(more, { key: "ArrowDown" }); // before the focus effect has run
    expect(screen.getByTestId("sidebar-item-c-action-b").classList.contains("is-active")).toBe(true);
    fireEvent.keyDown(more, { key: "Enter" });
    expect(fn.mock.calls).toEqual([]);
    fireEvent.keyDown(more, { key: "b" });
    expect(fn.mock.calls).toEqual([["c", "b"]]);
  });
});

describe("F092.22 — two keys before a re-render", () => {
  it("ArrowDown twice in the same tick lands on the third item", async () => {
    render(<Sidebar lang="da" groups={[{ label: "H", items: [{ id: "c", label: "S", href: "/c", actions: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "x", label: "X" }] }] }]} currentPath="/" />);
    fireEvent.click(screen.getByTestId("sidebar-item-c-more"));
    await new Promise((r) => setTimeout(r, 0));
    const menu = screen.getByTestId("sidebar-item-c-menu");
    // dispatch two keydowns synchronously, without letting Preact re-render in between
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId("sidebar-item-c-action-x").classList.contains("is-active")).toBe(true);
  });
});

describe("F092.22 — Enter then ↓ before any re-render", () => {
  it("the first arrow after opening is not lost (focus still on «…»)", async () => {
    render(<Sidebar lang="da" groups={[{ label: "H", items: [{ id: "c", label: "S", href: "/c", actions: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "x", label: "X" }] }] }]} currentPath="/" />);
    const more = screen.getByTestId("sidebar-item-c-more");
    more.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0)); // rendered (layout effects ran), passive effects not necessarily — the gap a fast key fell into
    more.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    more.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId("sidebar-item-c-action-x").classList.contains("is-active")).toBe(true);
  });
});

describe("F092.23 — idle marker and a group without a heading (scout #2701)", () => {
  it("idle is the same marker element in grey, decorative; working keeps its label", () => {
    render(<Sidebar lang="da" groups={[{ label: "H", items: [{ id: "a", label: "Kører", href: "/a", marker: "working" }, { id: "b", label: "Færdig", href: "/b", marker: "idle" }] }]} currentPath="/" />);
    const w = screen.getByTestId("sidebar-item-a-marker");
    const i = screen.getByTestId("sidebar-item-b-marker");
    expect([w.className, w.getAttribute("aria-label"), w.getAttribute("aria-hidden")]).toEqual(["bas-item__marker", "Arbejder", null]);
    expect([i.className, i.getAttribute("aria-label"), i.getAttribute("aria-hidden"), i.getAttribute("role")]).toEqual(["bas-item__marker bas-item__marker--idle", null, "true", null]);
  });

  it("the idle ring is grey, not the accent", () => {
    const css = readFileSync(resolve(__dirname, "../css/app-shell.css"), "utf8");
    expect(css).toMatch(/\.bas-item__marker--idle \{ border-color: var\(--border\); background: transparent; \}/);
  });

  it("hideLabel: no heading row, no fold button, always open — even with a stored fold for that label", () => {
    store.setItem("broberg-app-shell.groups", JSON.stringify(["Scout chat"])); // a fold stored for this label
    render(<Sidebar lang="da" groups={[{ label: "Scout chat", hideLabel: true, items: [{ id: "c1", label: "Samtale", href: "/c/1", marker: "idle" }] }, { label: "Andet", items: [] }]} currentPath="/" />);
    const g = screen.getByTestId("sidebar-group-scout-chat-unlabelled");
    expect([g.getAttribute("role"), g.getAttribute("aria-label"), !!screen.queryByTestId("sidebar-group-scout-chat"), !!screen.queryByTestId("sidebar-item-c1"), g.querySelector(".bas-group__label")]).toEqual(["group", "Scout chat", false, true, null]);
    expect(!!screen.queryByTestId("sidebar-group-andet")).toBe(true); // a labelled group is unchanged
  });
});

describe("F092.26 — collapsible:false: a text heading, always open (scout #2728)", () => {
  it("no button, no chevron, no aria-expanded — and a stored fold cannot hide it", () => {
    store.setItem("broberg-app-shell.groups", JSON.stringify(["Historik"]));
    render(<Sidebar lang="da" groups={[{ label: "Historik", variant: "plain", collapsible: false, items: [{ id: "h", label: "Samtale", href: "/h" }] }, { label: "Andet", items: [{ id: "o", label: "O", href: "/o" }] }]} currentPath="/" />);
    const head = screen.getByTestId("sidebar-group-historik");
    expect([head.tagName, head.className, head.getAttribute("aria-expanded"), head.querySelector("svg"), head.textContent, !!screen.queryByTestId("sidebar-item-h")]).toEqual(["DIV", "bas-group__label bas-group__label--static", null, null, "Historik", true]);
    expect(screen.getByTestId("sidebar-group-andet").tagName).toBe("BUTTON"); // default unchanged
  });
});
