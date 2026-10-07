// @vitest-environment happy-dom
/** @jsxImportSource preact */
// F029.10 — TenantSwitcher: only the user's own organisations, the active one
// marked, switching through the app's route, and a failed switch that says so.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFetchTenantAdapter, TenantSwitcher, type TenantMembershipRow } from "../src/preact";

afterEach(cleanup);

const ROWS: TenantMembershipRow[] = [
  { tenant: { id: "t-a", slug: "alpha", name: "Alpha Klinik" }, role: "admin" },
  { tenant: { id: "t-b", slug: "beta", name: "Beta Butik" }, role: "member" },
  { tenant: { id: "t-s", slug: "sleepy", name: "Sovende", status: "suspended" }, role: "member" },
];
const adapterOf = (rows: TenantMembershipRow[] | Error) => ({
  load: vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows.map((r) => ({ ...r, tenant: { ...r.tenant } }));
  }),
});
const openMenu = async () => {
  await waitFor(() => expect(screen.getByTestId("tenant-switcher-label").textContent).not.toBe("alpha"));
  fireEvent.click(screen.getByTestId("tenant-switcher-button"));
};

describe("TenantSwitcher", () => {
  it("lists EXACTLY the memberships the adapter returns, marks the active one, shows names not slugs", async () => {
    render(<TenantSwitcher lang="da" activeSlug="alpha" adapter={adapterOf(ROWS)} onSwitch={vi.fn()} />);
    await openMenu();
    const items = [...screen.getByTestId("tenant-switcher-menu").querySelectorAll("[role=menuitemradio]")];
    expect(items.map((i) => i.getAttribute("data-testid"))).toEqual(["tenant-switcher-item-alpha", "tenant-switcher-item-beta", "tenant-switcher-item-sleepy"]);
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(screen.getByTestId("tenant-switcher-label").textContent).toBe("Alpha Klinik");
    expect(screen.getByTestId("tenant-switcher-item-beta").textContent).toBe("Beta Butik"); // no roleLabel → no raw role (appkit, 7/10)
  });

  it("a suspended organisation cannot be chosen", async () => {
    const onSwitch = vi.fn();
    render(<TenantSwitcher lang="da" activeSlug="alpha" adapter={adapterOf(ROWS)} onSwitch={onSwitch} />);
    await openMenu();
    const s = screen.getByTestId("tenant-switcher-item-sleepy") as HTMLButtonElement;
    expect([s.disabled, s.textContent]).toEqual([true, "Sovendelukket"]);
    fireEvent.click(s);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("choosing another organisation calls the app's switch with its slug and closes; the active one does nothing", async () => {
    const onSwitch = vi.fn(async () => {});
    render(<TenantSwitcher lang="da" activeSlug="alpha" adapter={adapterOf(ROWS)} onSwitch={onSwitch} />);
    await openMenu();
    fireEvent.click(screen.getByTestId("tenant-switcher-item-alpha"));
    expect(onSwitch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("tenant-switcher-item-beta"));
    await waitFor(() => expect(onSwitch.mock.calls).toEqual([["beta"]]));
    await waitFor(() => expect(screen.queryByTestId("tenant-switcher-menu")).toBeNull());
  });

  it("a FAILED switch says so, keeps the current organisation, and the menu stays open", async () => {
    const onSwitch = vi.fn(async () => {
      throw new Error("403");
    });
    render(<TenantSwitcher lang="da" activeSlug="alpha" adapter={adapterOf(ROWS)} onSwitch={onSwitch} />);
    await openMenu();
    fireEvent.click(screen.getByTestId("tenant-switcher-item-beta"));
    expect((await screen.findByTestId("tenant-switcher-switch-error")).textContent).toBe("Kunne ikke skifte organisation. Du er stadig i Alpha Klinik.");
    expect(screen.getByTestId("tenant-switcher-label").textContent).toBe("Alpha Klinik");
    expect(screen.getByTestId("tenant-switcher-item-alpha").getAttribute("aria-checked")).toBe("true");
  });

  it("a failed load says so with a retry, and never invents a list", async () => {
    const a = adapterOf(new Error("down"));
    render(<TenantSwitcher lang="en" activeSlug="alpha" adapter={a} onSwitch={vi.fn()} />);
    await waitFor(() => expect(a.load).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("tenant-switcher-button"));
    expect((await screen.findByTestId("tenant-switcher-load-error")).textContent).toBe("Could not load your organisations.Try again");
    expect(screen.getByTestId("tenant-switcher-menu").querySelectorAll("[role=menuitemradio]").length).toBe(0);
    fireEvent.click(screen.getByTestId("tenant-switcher-retry"));
    expect(a.load).toHaveBeenCalledTimes(2);
  });

  it("one organisation → a plain label, no menu, nothing to click", async () => {
    render(<TenantSwitcher lang="da" activeSlug="alpha" adapter={adapterOf([ROWS[0]!])} onSwitch={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("tenant-switcher-label").textContent).toBe("Alpha Klinik"));
    expect(screen.queryByTestId("tenant-switcher-button")).toBeNull();
  });

  it("Escape and a click outside close the menu", async () => {
    render(<TenantSwitcher lang="da" activeSlug="alpha" adapter={adapterOf(ROWS)} onSwitch={vi.fn()} />);
    await openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("tenant-switcher-menu")).toBeNull());
    fireEvent.click(screen.getByTestId("tenant-switcher-button"));
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByTestId("tenant-switcher-menu")).toBeNull());
  });

  it("every interactive element has a data-testid, and there is no native <select>", async () => {
    render(<TenantSwitcher lang="da" activeSlug="alpha" adapter={adapterOf(ROWS)} onSwitch={vi.fn()} />);
    await openMenu();
    const root = screen.getByTestId("tenant-switcher");
    expect(root.querySelectorAll("select").length).toBe(0);
    expect([...root.querySelectorAll("button, a, input, select")].filter((e) => !e.getAttribute("data-testid")).map((e) => e.outerHTML)).toEqual([]);
  });
});

describe("createFetchTenantAdapter", () => {
  it("GET /api/me/memberships same-origin; non-2xx and a bad body throw", async () => {
    const f = vi.fn(async () => Response.json(ROWS));
    expect(await createFetchTenantAdapter({ fetch: f as unknown as typeof fetch }).load()).toEqual(ROWS);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("/api/me/memberships");
    await expect(createFetchTenantAdapter({ fetch: (async () => Response.json({ error: "x" }, { status: 401 })) as unknown as typeof fetch }).load()).rejects.toMatchObject({ status: 401 });
    await expect(createFetchTenantAdapter({ fetch: (async () => Response.json({ not: "a list" })) as unknown as typeof fetch }).load()).rejects.toThrow();
  });
});

it("layout guard (393 px): a long organisation name is cut off, never widens the bar", () => {
  const css = readFileSync(join(__dirname, "../css/app-shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map((x) => x.trim()).includes(sel)).map((m) => m[2]).join(";");
  expect(rule(".bas-tenant__label")).toMatch(/text-overflow:\s*ellipsis/);
  expect(rule(".bas-tenant__label")).toMatch(/min-width:\s*0/);
  expect(rule(".bas-tenant")).toMatch(/max-width:\s*100%/);

});

describe("TenantSwitcher on a phone (appkit pilot, 7/10)", () => {
  it("roleLabel puts the role in the app's own words; the active row still says active", async () => {
    const roleLabel = (r: string) => ({ admin: "Administrator", member: "Medarbejder" })[r] ?? r;
    render(<TenantSwitcher lang="da" activeSlug="alpha" adapter={adapterOf(ROWS)} onSwitch={vi.fn()} roleLabel={roleLabel} />);
    await openMenu();
    expect(screen.getByTestId("tenant-switcher-role-beta").textContent).toBe("Medarbejder");
    expect(screen.getByTestId("tenant-switcher-role-alpha").textContent).not.toBe("Administrator");
  });

  describe("the menu stays on screen (appkit, 393 px, Lens b0ff5fb2)", () => {
    const at = (left: number, width = 320) => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return { left, right: left + width, top: 0, bottom: 0, width, height: 0, x: left, y: 0, toJSON() {} } as DOMRect;
      });
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 393 });
      Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 393 });
    };
    afterEach(() => vi.restoreAllMocks());

    it("past the right edge → shifted left to 16 px from it", async () => {
      at(200); // right = 520 > 393 - 16
      render(<TenantSwitcher lang="da" activeSlug="alpha" adapter={adapterOf(ROWS)} onSwitch={vi.fn()} />);
      await openMenu();
      expect(screen.getByTestId("tenant-switcher-menu").style.transform).toBe("translateX(-143px)");
    });

    it("past the left edge → shifted right to 16 px", async () => {
      at(-30);
      render(<TenantSwitcher lang="da" activeSlug="alpha" adapter={adapterOf(ROWS)} onSwitch={vi.fn()} />);
      await openMenu();
      expect(screen.getByTestId("tenant-switcher-menu").style.transform).toBe("translateX(46px)");
    });

    it("already inside → left alone", async () => {
      at(20);
      render(<TenantSwitcher lang="da" activeSlug="alpha" adapter={adapterOf(ROWS)} onSwitch={vi.fn()} />);
      await openMenu();
      expect(screen.getByTestId("tenant-switcher-menu").style.transform).toBe("");
    });
  });
});
