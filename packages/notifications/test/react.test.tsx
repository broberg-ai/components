// @vitest-environment happy-dom
// F074.4 — the React wrapper, asserted on the RENDERED DOM.
//
// What lives here is what happy-dom CAN prove: one count across bells, a
// portalled panel surviving its own clicks, the ARIA on the rendered nodes. The
// focus trap is deliberately NOT here — happy-dom reports green on a trap that
// catches nothing, so that half is driven through a real engine via Lens.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor } from "@testing-library/react";
import { createPortal } from "react-dom";
import { useRef } from "react";
import { BellProvider, Bell, BellPanel, BellMarkAll, BellLayer, useBellShell } from "../src/react.js";
import type { BellShellConfig } from "../src/shell.js";
import type { NotificationRow } from "../src/types.js";

afterEach(cleanup);

const labels = { bell: "Notifikationer", panel: "Notifikationer", markAll: "Markér alle læst", seeAll: "Se alle", empty: "Intet endnu", close: "Luk" };

const row = (id: string): NotificationRow => ({
  id, kind: "info", title: `Række ${id}`, body: null, navigate: null, refId: null, createdAt: 0, seenAt: null,
});

function config(over: Partial<BellShellConfig> = {}): BellShellConfig {
  let count = 3;
  return {
    labels,
    countUnseen: vi.fn(async () => count),
    markAllSeen: vi.fn(async () => { count = 0; return ["a", "b", "c"]; }),
    loadRows: vi.fn(async () => [row("a"), row("b"), row("c")]),
    ...over,
  };
}

describe("two bells, one count (AC#0)", () => {
  it("both triggers show the provider's number, and mark-all takes BOTH to zero", async () => {
    const cfg = config();
    render(
      <BellProvider config={cfg}>
        <div data-testid="mobile"><Bell /></div>
        <div data-testid="desktop"><Bell /></div>
        <BellPanel><BellMarkAll /></BellPanel>
      </BellProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId("bell-count").map((n) => n.textContent)).toStrictEqual(["3", "3"]));
    await act(async () => { fireEvent.click(screen.getAllByTestId("bell-trigger")[0]!); });
    await act(async () => { fireEvent.click(screen.getByTestId("bell-mark-all")); });
    await waitFor(() => expect(screen.getAllByTestId("bell-count").map((n) => n.textContent)).toStrictEqual(["0", "0"]));
  });
});

describe("a PORTALLED panel survives its own clicks (AC#1)", () => {
  // The panel is rendered OUTSIDE the trigger's DOM subtree, into document.body —
  // with panel and trigger under one parent, the contains()-on-one-root bug is
  // invisible, so this test has to portal or it asserts nothing.
  function Portalled({ onRow }: { onRow: () => void }) {
    const trig = useRef<HTMLElement | null>(null);
    return (
      <>
        <header data-testid="topbar"><span ref={trig}><Bell /></span></header>
        {createPortal(
          <BellPanel triggerRef={trig}>
            <button type="button" data-testid="row-a" onClick={onRow}>Række a</button>
          </BellPanel>,
          document.body,
        )}
        <main data-testid="background">baggrund</main>
      </>
    );
  }

  it("a click on a row runs its handler and the panel stays open; a background click closes it", async () => {
    const onRow = vi.fn();
    render(<BellProvider config={config()}><Portalled onRow={onRow} /></BellProvider>);
    await act(async () => { fireEvent.click(screen.getByTestId("bell-trigger")); });
    const panel = await screen.findByTestId("bell-panel");
    // Really portalled: the panel is not inside the topbar.
    expect(screen.getByTestId("topbar").contains(panel)).toBe(false);

    const rowEl = screen.getByTestId("row-a");
    await act(async () => {
      fireEvent.pointerDown(rowEl); fireEvent.mouseDown(rowEl); fireEvent.click(rowEl);
    });
    expect(onRow).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("bell-panel")).not.toBeNull();

    const bg = screen.getByTestId("background");
    await act(async () => { fireEvent.pointerDown(bg); fireEvent.mouseDown(bg); fireEvent.click(bg); });
    await waitFor(() => expect(screen.queryByTestId("bell-panel")).toBeNull());
  });
});

describe("the ARIA consumers lacked, on the rendered DOM (AC#10)", () => {
  it("trigger has aria-haspopup + aria-controls → the panel's id; a modal layer has aria-modal=true", async () => {
    function AlarmButton() {
      const { shell } = useBellShell();
      return (
        <button type="button" data-testid="open-alarm"
          onClick={(e) => shell.pushLayer({ id: "alarm", modal: true, focusReturn: e.currentTarget })}>alarm</button>
      );
    }
    const cfg = config();
    render(
      <BellProvider config={cfg}>
        <Bell />
        <BellPanel><AlarmButton /></BellPanel>
        <BellLayer id="alarm"><button type="button">Kvittér</button></BellLayer>
      </BellProvider>,
    );
    const trig = screen.getByTestId("bell-trigger");
    expect(trig.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trig.getAttribute("aria-controls")).toBeNull(); // nothing to point at while closed

    await act(async () => { fireEvent.click(trig); });
    const panel = await screen.findByTestId("bell-panel");
    expect(trig.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.id).not.toBe("");
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("false");

    await act(async () => { fireEvent.click(screen.getByTestId("open-alarm")); });
    const layer = await screen.findByTestId("bell-layer-alarm");
    expect(layer.getAttribute("role")).toBe("alertdialog");
    expect(layer.getAttribute("aria-modal")).toBe("true");
  });
});

describe("the empty panel is the common case (AC#6/#15, DOM half)", () => {
  it("renders the consumer's empty text, and Tab inside it does not throw", async () => {
    render(
      <BellProvider config={config({ loadRows: async () => [], countUnseen: async () => 0 })}>
        <Bell />
        <BellPanel><span>skal ikke vises</span></BellPanel>
      </BellProvider>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId("bell-trigger")); });
    expect((await screen.findByTestId("bell-empty")).textContent).toBe("Intet endnu");
    expect(() => fireEvent.keyDown(document, { key: "Tab" })).not.toThrow();
    expect(screen.queryByTestId("bell-panel")).not.toBeNull();
  });
});

describe("redraw, never re-mount (AC#20, DOM half)", () => {
  it("the panel node is the SAME node after mark-all", async () => {
    render(
      <BellProvider config={config()}>
        <Bell />
        <BellPanel><BellMarkAll /></BellPanel>
      </BellProvider>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId("bell-trigger")); });
    const before = await screen.findByTestId("bell-panel");
    await act(async () => { fireEvent.click(screen.getByTestId("bell-mark-all")); });
    await waitFor(() => expect(screen.getByTestId("bell-count").textContent).toBe("0"));
    expect(screen.getByTestId("bell-panel")).toBe(before);
  });
});
