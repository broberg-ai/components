// @vitest-environment happy-dom
// <broberg-consent> against the BUILT dist — what a site actually installs.
// The gate builds before it tests; run `pnpm build` first locally.
import { beforeEach, describe, expect, it } from "vitest";
// Node 22+ ships its OWN global localStorage, which wins over happy-dom's and has
// no working storage unless Node runs with --localstorage-file (measured on Node
// 25: `localStorage.clear is not a function`). Install a real Storage-shaped
// store, as a browser has. Must run before the element is imported.
const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  get length() { return mem.size; },
};
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
// A non-literal specifier on purpose: CI typechecks BEFORE it builds, and a
// literal "../dist/element.js" fails typecheck with TS2307 there (measured,
// run 36461763429). The test itself runs after the build, against the dist.
const builtElement = "../dist/element.js";
await import(/* @vite-ignore */ builtElement);

const KEY = "broberg-consent";

function mount(attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("broberg-consent");
  el.setAttribute("policy-version", "2026-09");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}
const $ = (el: HTMLElement, id: string) => el.shadowRoot!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const visible = (el: HTMLElement, id: string) => {
  const n = $(el, id);
  if (!n) return false;
  // hidden on the node itself, or on the scrim wrapping the panel
  return !n.hasAttribute("hidden") && !n.parentElement?.hasAttribute("hidden");
};
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "null");

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("first layer (AC#0)", () => {
  it("first visit shows the banner, not the panel or the reopen handle", () => {
    const el = mount();
    expect(visible(el, "consent-banner")).toBe(true);
    expect(visible(el, "consent-panel")).toBe(false);
    expect(visible(el, "consent-reopen")).toBe(false);
  });

  it("«Afvis alle» stores essential only — strict equality", () => {
    const el = mount();
    $(el, "consent-reject-all")!.click();
    const r = stored();
    expect(r.policyVersion).toBe("2026-09");
    expect(r.categories).toStrictEqual({ essential: true, analytics: false, marketing: false });
    expect(visible(el, "consent-banner")).toBe(false);
  });

  it("«Accepter alle» stores every category", () => {
    const el = mount();
    $(el, "consent-accept-all")!.click();
    expect(stored().categories).toStrictEqual({ essential: true, analytics: true, marketing: true });
  });

  it("no optional category starts switched on in the panel", () => {
    const el = mount();
    $(el, "consent-customize")!.click();
    expect($(el, "consent-toggle-analytics")!.getAttribute("aria-checked")).toBe("false");
    expect($(el, "consent-toggle-marketing")!.getAttribute("aria-checked")).toBe("false");
    expect($(el, "consent-toggle-essential")).toBeNull(); // locked, not a switch
  });

  it("reject and accept carry the SAME style class (equal prominence)", () => {
    const el = mount();
    expect($(el, "consent-reject-all")!.className).toBe($(el, "consent-accept-all")!.className);
  });

  it("a granular choice stores exactly what was switched on", () => {
    const el = mount();
    $(el, "consent-customize")!.click();
    $(el, "consent-toggle-analytics")!.click();
    $(el, "consent-save")!.click();
    expect(stored().categories).toStrictEqual({ essential: true, analytics: true, marketing: false });
  });

  it("emits consent-change with the record", () => {
    const el = mount();
    let got: unknown = undefined;
    document.addEventListener("consent-change", (e) => (got = (e as CustomEvent).detail), { once: true });
    $(el, "consent-accept-all")!.click();
    expect((got as { categories: Record<string, boolean> }).categories.analytics).toBe(true);
  });
});

describe("persistence and policy version (AC#1)", () => {
  it("a stored decision survives a reload — no banner, reopen handle instead", () => {
    mount().shadowRoot!.querySelector<HTMLElement>('[data-testid="consent-reject-all"]')!.click();
    document.body.innerHTML = "";
    const el = mount();
    expect(visible(el, "consent-banner")).toBe(false);
    expect(visible(el, "consent-reopen")).toBe(true);
  });

  it("a changed policy-version brings the banner back with the 'updated' heading", () => {
    $(mount(), "consent-accept-all")!.click();
    document.body.innerHTML = "";
    const el = mount({ "policy-version": "2026-10" });
    expect(visible(el, "consent-banner")).toBe(true);
    expect($(el, "consent-banner")!.querySelector("h2")!.textContent).toBe("Vores cookie-politik er opdateret");
  });

  it("negative control: an unchanged version shows the ordinary heading on first visit", () => {
    const el = mount();
    expect($(el, "consent-banner")!.querySelector("h2")!.textContent).toBe("Vi bruger cookies");
  });
});

describe("the way back (AC#2)", () => {
  it("the reopen handle opens the panel, reflecting the stored choice", () => {
    const el = mount();
    $(el, "consent-accept-all")!.click();
    $(el, "consent-reopen")!.click();
    expect(visible(el, "consent-panel")).toBe(true);
    expect($(el, "consent-toggle-analytics")!.getAttribute("aria-checked")).toBe("true");
  });

  it("any [data-broberg-consent-open] on the page opens the panel", () => {
    const el = mount();
    $(el, "consent-reject-all")!.click();
    const a = document.createElement("a");
    a.href = "#";
    a.setAttribute("data-broberg-consent-open", "");
    document.body.appendChild(a);
    a.click();
    expect(visible(el, "consent-panel")).toBe(true);
  });

  it("«Træk samtykke tilbage» clears the record and the banner returns", () => {
    const el = mount();
    $(el, "consent-accept-all")!.click();
    $(el, "consent-reopen")!.click();
    $(el, "consent-withdraw")!.click();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(visible(el, "consent-banner")).toBe(true);
  });

  it("reopen-position=right moves the handle to the right edge", () => {
    const el = mount({ "reopen-position": "right" });
    $(el, "consent-reject-all")!.click();
    expect($(el, "consent-reopen")!.classList.contains("right")).toBe(true);
    const def = mount();
    expect($(def, "consent-reopen")!.classList.contains("right")).toBe(false);
  });

  it("hide-reopen hides the handle (for a site with its own footer link)", () => {
    const el = mount({ "hide-reopen": "" });
    $(el, "consent-reject-all")!.click();
    expect(visible(el, "consent-reopen")).toBe(false);
  });
});

describe("keyboard (AC#3)", () => {
  const key = (el: HTMLElement, k: string, shift = false) =>
    $(el, "consent-panel")!.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true }));

  it("Escape closes the panel WITHOUT granting consent", () => {
    const el = mount();
    $(el, "consent-customize")!.click();
    $(el, "consent-toggle-analytics")!.click();
    key(el, "Escape");
    expect(visible(el, "consent-panel")).toBe(false);
    expect(visible(el, "consent-banner")).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("Tab wraps inside the panel (focus trap)", () => {
    const el = mount();
    $(el, "consent-accept-all")!.click();
    $(el, "consent-reopen")!.click();
    const panel = $(el, "consent-panel")!;
    const items = Array.from(panel.querySelectorAll<HTMLElement>("button"));
    items[items.length - 1]!.focus();
    key(el, "Tab");
    expect(el.shadowRoot!.activeElement).toBe(items[0]);
    key(el, "Tab", true);
    expect(el.shadowRoot!.activeElement).toBe(items[items.length - 1]);
  });

  // Lens, Chromium, 28/9: focus moved ONTO a button during the activating click
  // let a second activation hit it — «Gem valg» then reopened the panel. Focus
  // must never land on a control that makes or changes a choice.
  it("opening the panel focuses the dialog, not a switch", () => {
    const el = mount();
    $(el, "consent-customize")!.click();
    expect(el.shadowRoot!.activeElement).toBe($(el, "consent-panel"));
  });

  it("a decision does not put focus on the reopen handle", () => {
    const el = mount();
    $(el, "consent-customize")!.click();
    $(el, "consent-save")!.click();
    expect(el.shadowRoot!.activeElement).not.toBe($(el, "consent-reopen"));
  });

  it("a second activation right after «Gem valg» does not reopen the panel", () => {
    const el = mount();
    $(el, "consent-customize")!.click();
    $(el, "consent-save")!.click();
    (el.shadowRoot!.activeElement as HTMLElement | null)?.click();
    expect(visible(el, "consent-panel")).toBe(false);
  });

  it("withdrawing focuses the banner, not «Afvis alle»", () => {
    const el = mount();
    $(el, "consent-accept-all")!.click();
    $(el, "consent-reopen")!.click();
    $(el, "consent-withdraw")!.click();
    expect(el.shadowRoot!.activeElement).toBe($(el, "consent-banner"));
  });

  it("every interactive element carries a data-testid", () => {
    const el = mount();
    $(el, "consent-accept-all")!.click();
    $(el, "consent-reopen")!.click();
    const missing = Array.from(el.shadowRoot!.querySelectorAll("button,a")).filter((n) => !n.getAttribute("data-testid"));
    expect(missing.map((n) => n.outerHTML)).toStrictEqual([]);
  });
});

describe("configuration", () => {
  it("lang=en switches the texts", () => {
    const el = mount({ lang: "en" });
    expect($(el, "consent-reject-all")!.textContent).toBe("Reject all");
  });

  it("storage-key is honoured", () => {
    const el = mount({ "storage-key": "site-x" });
    $(el, "consent-reject-all")!.click();
    expect(localStorage.getItem("site-x")).not.toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("the manager is exposed on the element and on window", () => {
    const el = mount() as HTMLElement & { manager: { has(k: string): boolean } };
    $(el, "consent-accept-all")!.click();
    expect(el.manager.has("analytics")).toBe(true);
    expect((globalThis as unknown as { brobergConsent: typeof el.manager }).brobergConsent).toBe(el.manager);
  });

  it("text is escaped — a site-supplied privacy-href cannot inject markup", () => {
    const el = mount({ "privacy-href": '"><img src=x onerror=alert(1)>' });
    expect(el.shadowRoot!.querySelector("img")).toBeNull();
  });
});
