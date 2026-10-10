// @vitest-environment happy-dom
// F014.21 — the banner follows @broberg/theme's dark palette, and switches language
// when the APP changes <html lang> (appkit #2481). Against the BUILT dist, like
// element.test.ts; run `pnpm build` first locally.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
const builtElement = "../dist/element.js";
await import(/* @vite-ignore */ builtElement);

function mount(attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("broberg-consent");
  el.setAttribute("policy-version", "2026-10");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}
const $ = (el: HTMLElement, id: string) => el.shadowRoot!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const tick = () => new Promise((r) => setTimeout(r, 0));
const clearCookies = () => { for (const c of document.cookie.split("; ")) { const n = c.split("=")[0]; if (n) document.cookie = `${n}=; Max-Age=0; Path=/`; } };

let style: HTMLStyleElement | null = null;
const tokens = (css: string) => {
  style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
};
const bannerBg = (el: HTMLElement) => getComputedStyle($(el, "consent-banner")!).backgroundColor;

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.lang = "da";
  clearCookies();
});
afterEach(() => {
  style?.remove();
  style = null;
});

describe("F014.21 — colours: shadcn first, then @broberg/theme, then the light fallback", () => {
  it("@broberg/theme's dark --bg-card is used when --card is absent", () => {
    tokens(":root{--bg-card:rgb(31, 27, 22);--fg:rgb(245, 241, 234)}");
    const el = mount();
    expect([bannerBg(el), getComputedStyle($(el, "consent-banner")!).color]).toEqual(["rgb(31, 27, 22)", "rgb(245, 241, 234)"]);
  });

  it("shadcn's --card still wins over --bg-card", () => {
    tokens(":root{--card:rgb(10, 20, 30);--bg-card:rgb(31, 27, 22)}");
    expect(bannerBg(mount())).toBe("rgb(10, 20, 30)");
  });

  it("no tokens at all: the white fallback is unchanged", () => {
    expect(bannerBg(mount())).toMatch(/^(#fff|rgb\(255, 255, 255\))$/);
  });
});

describe("F014.21 — language follows <html lang> after mount", () => {
  it("the app switching <html lang> to en re-renders the banner in English", async () => {
    const el = mount();
    expect($(el, "consent-reject-all")!.textContent).toBe("Afvis alle");
    document.documentElement.lang = "en";
    await tick();
    expect($(el, "consent-reject-all")!.textContent).toBe("Reject all");
  });

  it("the element's own lang attribute still wins over <html lang>", async () => {
    const el = mount({ lang: "da" });
    document.documentElement.lang = "en";
    await tick();
    expect($(el, "consent-reject-all")!.textContent).toBe("Afvis alle");
  });
});
