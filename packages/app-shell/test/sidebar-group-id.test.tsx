// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F029.14 — buzzalert #5146: a group's testid was a slug of the TRANSLATED label,
// so «Opsætning» became sidebar-group-ops-tning and English «Setup» sidebar-group-setup.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/preact";
import { Sidebar, type PreactNavGroup } from "../src/preact";

afterEach(cleanup);

const ids = (c: Element) => [...c.querySelectorAll("[data-testid^='sidebar-group-']")].map((e) => e.getAttribute("data-testid"));
const group = (label: string, extra: Partial<PreactNavGroup> = {}): PreactNavGroup => ({
  label,
  items: [{ id: "x", label: "x", href: "/x" }],
  action: { icon: null, label: "Filter", onClick: vi.fn() },
  ...extra,
});

describe("sidebar group testid (F029.14)", () => {
  it("with an `id`, the testids are the SAME in Danish and English", () => {
    const da = render(<Sidebar lang="da" groups={[group("Opsætning", { id: "setup" })]} currentPath="/" />);
    const daIds = ids(da.container);
    cleanup();
    const en = render(<Sidebar lang="en" groups={[group("Setup", { id: "setup" })]} currentPath="/" />);
    expect(daIds).toStrictEqual(ids(en.container));
    expect(daIds).toStrictEqual(["sidebar-group-setup", "sidebar-group-setup-action"]);
  });

  it("an unlabelled group uses the id too", () => {
    const r = render(<Sidebar lang="da" groups={[group("Opsætning", { id: "setup", hideLabel: true, action: undefined })]} currentPath="/" />);
    expect(ids(r.container)).toStrictEqual(["sidebar-group-setup-unlabelled"]);
  });

  it("NEGATIVE CONTROL: without an `id` nothing changed — still the label slug (0.25.2 output)", () => {
    const r = render(<Sidebar lang="da" groups={[group("Opsætning")]} currentPath="/" />);
    expect(ids(r.container)).toStrictEqual(["sidebar-group-ops-tning", "sidebar-group-ops-tning-action"]);
  });
});
