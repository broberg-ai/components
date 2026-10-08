// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F092.13 — ConfirmDialog: what a person sees and can do, read from the DOM.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "preact/hooks";
import { ConfirmDialog, type ConfirmDialogProps } from "../src/preact";

afterEach(cleanup);

const base = (over: Partial<ConfirmDialogProps> = {}): ConfirmDialogProps => ({
  open: true,
  title: "Slet dokument?",
  body: "«Cover page» slettes permanent.",
  confirmLabel: "Slet",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  ...over,
});
const tid = (id: string) => screen.getByTestId(id);

describe("AC0 — what it renders", () => {
  it("an alertdialog with title and body wired to it; closed renders nothing", () => {
    const { rerender } = render(<ConfirmDialog {...base()} />);
    const dlg = tid("confirm-dialog");
    expect([dlg.getAttribute("role"), dlg.getAttribute("aria-modal")]).toEqual(["alertdialog", "true"]);
    expect(document.getElementById(dlg.getAttribute("aria-labelledby")!)!.textContent).toBe("Slet dokument?");
    expect(document.getElementById(dlg.getAttribute("aria-describedby")!)!.textContent).toBe("«Cover page» slettes permanent.");
    expect([tid("confirm-dialog-cancel").textContent, tid("confirm-dialog-confirm").textContent]).toEqual(["Annuller", "Slet"]);
    rerender(<ConfirmDialog {...base({ open: false })} />);
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(screen.queryByTestId("confirm-dialog-backdrop")).toBeNull();
  });
  it("Danish defaults when no labels are given", () => {
    render(<ConfirmDialog {...base({ confirmLabel: undefined })} />);
    expect([tid("confirm-dialog-cancel").textContent, tid("confirm-dialog-confirm").textContent]).toEqual(["Annuller", "Bekræft"]);
  });
});

function Harness(props: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button data-testid="opener" onClick={() => setOpen(true)}>Slet</button>
      <ConfirmDialog open={open} title="Slet?" onCancel={() => setOpen(false)} onConfirm={() => { props.onConfirm?.(); setOpen(false); }} />
    </div>
  );
}

describe("AC1 — focus", () => {
  it("opens with focus on Cancel and gives it back to the opener when it closes", () => {
    render(<Harness />);
    const opener = tid("opener");
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(tid("confirm-dialog-cancel"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  it("Tab and Shift+Tab stay inside the window", () => {
    render(<ConfirmDialog {...base()} />);
    const cancel = tid("confirm-dialog-cancel");
    const confirm = tid("confirm-dialog-confirm");
    confirm.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });
});

describe("AC2 — dismissing, and the busy lock", () => {
  it("Escape and a click on the backdrop cancel; a click inside does not", () => {
    const p = base();
    render(<ConfirmDialog {...p} />);
    fireEvent.mouseDown(tid("confirm-dialog"));
    fireEvent.mouseDown(tid("confirm-dialog-title"));
    expect(p.onCancel).toHaveBeenCalledTimes(0);
    fireEvent.mouseDown(tid("confirm-dialog-backdrop"));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(p.onCancel).toHaveBeenCalledTimes(2);
    fireEvent.click(tid("confirm-dialog-confirm"));
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
  });
  it("while busy: both buttons disabled, Escape and backdrop do nothing, confirm shows it is working", () => {
    const p = base({ busy: true });
    render(<ConfirmDialog {...p} />);
    const [cancel, confirm] = [tid("confirm-dialog-cancel") as HTMLButtonElement, tid("confirm-dialog-confirm") as HTMLButtonElement];
    expect([cancel.disabled, confirm.disabled]).toEqual([true, true]);
    expect(confirm.querySelector(".bas-confirm__spinner")).toBeTruthy();
    expect(tid("confirm-dialog").getAttribute("aria-busy")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(tid("confirm-dialog-backdrop"));
    fireEvent.click(confirm);
    expect([p.onCancel, p.onConfirm].map((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([0, 0]);
  });
  it("Escape reads busy at the moment of the key, not when the window opened", () => {
    const p = base();
    const { rerender } = render(<ConfirmDialog {...p} />);
    rerender(<ConfirmDialog {...p} busy />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(p.onCancel).toHaveBeenCalledTimes(0);
  });
});

describe("AC3 — error, destructive, testids", () => {
  it("an error is shown as role=alert and the window stays open", () => {
    render(<ConfirmDialog {...base({ error: "Kunne ikke slette. Prøv igen." })} />);
    const err = tid("confirm-dialog-error");
    expect([err.getAttribute("role"), err.textContent]).toEqual(["alert", "Kunne ikke slette. Prøv igen."]);
    expect(tid("confirm-dialog")).toBeTruthy();
  });
  it("destructive gives the red confirm button; without it, it is not red", () => {
    const { rerender } = render(<ConfirmDialog {...base({ destructive: true })} />);
    expect(tid("confirm-dialog-confirm").classList.contains("is-danger")).toBe(true);
    rerender(<ConfirmDialog {...base()} />);
    expect(tid("confirm-dialog-confirm").classList.contains("is-danger")).toBe(false);
  });
  it("the testid prefix can be set, and every button carries one", () => {
    render(<ConfirmDialog {...base({ testId: "doc-delete" })} />);
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(tid("doc-delete")).toBeTruthy();
    expect([...document.querySelectorAll("button")].map((b) => b.getAttribute("data-testid"))).toEqual(["doc-delete-cancel", "doc-delete-confirm"]);
    expect(document.querySelectorAll("dialog").length).toBe(0);
  });
});

describe("AC4 — CSS uses theme tokens only", () => {
  it("the confirm rules write no colour literal except rgba shadows/backdrop", () => {
    const css = readFileSync(join(__dirname, "../css/app-shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const confirm = [...css.matchAll(/([^{}]*bas-confirm[^{}]*)\{([^{}]*)\}/g)].map((m) => m[2]).join(";");
    expect(confirm.length).toBeGreaterThan(0);
    expect(confirm.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(confirm.match(/\b(?:rgb|hsl)a?\((?![^)]*,\s*\.\d+\))[^)]*\)/gi) ?? []).toEqual([]);
  });
});
