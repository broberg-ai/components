// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.20 — the sidebar can carry a chat history (scout-F011.2): a "working"
// marker, a pin, and a plain group with day sub-headings.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { Sidebar, type PreactNavGroup } from "../src/preact";

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
