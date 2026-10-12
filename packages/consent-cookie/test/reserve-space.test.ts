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
const builtElement = "../dist/element.js";
await import(/* @vite-ignore */ builtElement);

// F014.22 — reserve-space + data-banner-open (broberg-ai #2911).
// happy-dom has no layout, so the banner's top is stubbed: 150px above the
// viewport bottom = the space the page must reserve.
const clearCookies = () => { for (const c of document.cookie.split("; ")) { const n = c.split("=")[0]; if (n) document.cookie = `${n}=; Max-Age=0; Path=/`; } };
function mount(attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("broberg-consent");
  el.setAttribute("policy-version", "2026-09");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}
const click = (el: HTMLElement, id: string) => el.shadowRoot!.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.click();
const html = () => document.documentElement.style.paddingBottom;

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.style.paddingBottom = "";
  clearCookies();
  storage.clear();
  Element.prototype.getBoundingClientRect = function () {
    return { top: window.innerHeight - 150, bottom: window.innerHeight, left: 0, right: 0, width: 0, height: 150, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
});

describe("F014.22 — the banner can reserve space at the bottom", () => {
  it("reserve-space: <html> gets the banner's top-to-bottom distance while it is open", () => {
    mount({ "reserve-space": "" });
    expect(html()).toBe("150px");
  });

  it("a choice removes it and puts the site's own inline padding back exactly", () => {
    document.documentElement.style.paddingBottom = "7px";
    const el = mount({ "reserve-space": "" });
    expect(html()).toBe("150px");
    click(el, "consent-reject-all");
    expect(html()).toBe("7px");
  });

  it("without reserve-space the document is never touched", () => {
    document.documentElement.style.paddingBottom = "7px";
    mount();
    expect(html()).toBe("7px");
  });

  it("data-banner-open mirrors the banner, with or without reserve-space", () => {
    const el = mount();
    expect(el.hasAttribute("data-banner-open")).toBe(true);
    click(el, "consent-accept-all");
    expect(el.hasAttribute("data-banner-open")).toBe(false);
  });

  it("removing the element releases the space", () => {
    const el = mount({ "reserve-space": "" });
    expect(html()).toBe("150px");
    el.remove();
    expect(html()).toBe("");
  });

  it("turning reserve-space on while the banner is open reserves at once; off releases", () => {
    const el = mount();
    expect(html()).toBe("");
    el.setAttribute("reserve-space", "");
    expect(html()).toBe("150px");
    el.removeAttribute("reserve-space");
    expect(html()).toBe("");
  });
});
