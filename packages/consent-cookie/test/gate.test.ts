// @vitest-environment happy-dom
// F014.9 — marked scripts and iframes run only after consent. Against the BUILT dist.
import { beforeEach, describe, expect, it, vi } from "vitest";

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

type W = typeof globalThis & { __ran?: Record<string, number>; dataLayer?: unknown[]; gtag?: unknown };
const w = globalThis as W;
const ran = (k: string) => w.__ran?.[k] ?? 0;

// Built with DOM calls, not innerHTML: a script inserted via innerHTML never
// runs in any browser, which would make "the app code still runs" a claim the
// test could not falsify.
function script(code: string, attrs: Record<string, string> = {}) {
  const s = document.createElement("script");
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  s.text = code;
  document.body.appendChild(s);
}
function page() {
  document.body.innerHTML = "";
  script("window.__ran = window.__ran || {}; window.__ran.app = (window.__ran.app||0) + 1;");
  script("window.__ran.analytics = (window.__ran.analytics||0) + 1;", { type: "text/plain", "data-consent": "analytics" });
  script("window.__ran.marketing = (window.__ran.marketing||0) + 1;", { type: "text/plain", "data-consent": "marketing" });
  script("window.__ran.typo = (window.__ran.typo||0) + 1;", { type: "text/plain", "data-consent": "analytic" });
  const f = document.createElement("iframe");
  f.setAttribute("data-testid", "yt");
  f.setAttribute("data-consent", "marketing");
  f.setAttribute("data-consent-src", "about:blank#youtube-embed");
  document.body.appendChild(f);
}
function mount(attrs: Record<string, string> = {}) {
  const el = document.createElement("broberg-consent") as HTMLElement & { reload: () => void };
  el.setAttribute("policy-version", "1");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}
const click = (el: HTMLElement, id: string) => el.shadowRoot!.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.click();

beforeEach(() => {
  mem.clear();
  w.__ran = {};
  delete w.dataLayer;
  delete w.gtag;
});

describe("scripts (AC#0)", () => {
  it("nothing marked runs before consent; unmarked app code runs as always", () => {
    page();
    mount();
    expect(ran("app")).toBe(1);
    expect(ran("analytics")).toBe(0);
    expect(ran("marketing")).toBe(0);
  });

  it("accepting statistics runs that script exactly once; marketing and a misspelt category never run", () => {
    page();
    const el = mount();
    click(el, "consent-customize");
    click(el, "consent-toggle-analytics");
    click(el, "consent-save");
    expect(ran("analytics")).toBe(1);
    expect(ran("marketing")).toBe(0);
    expect(ran("typo")).toBe(0);
    // A second decision must not run it again.
    click(el, "consent-reopen");
    click(el, "consent-panel-accept-all");
    expect(ran("analytics")).toBe(1);
    expect(ran("marketing")).toBe(1);
    expect(ran("typo")).toBe(0);
  });

  it("«Afvis alle» runs nothing", () => {
    page();
    const el = mount();
    click(el, "consent-reject-all");
    expect(ran("analytics") + ran("marketing")).toBe(0);
  });

  it("a returning visitor's stored choice runs the allowed scripts on load", () => {
    page();
    click(mount(), "consent-accept-all");
    w.__ran = {};
    page();
    mount();
    expect(ran("analytics")).toBe(1);
    expect(ran("marketing")).toBe(1);
  });
});

describe("iframes (AC#1)", () => {
  it("no src before consent; src set after the category is granted", () => {
    page();
    const el = mount();
    const f = () => document.querySelector<HTMLIFrameElement>('[data-testid="yt"]')!;
    expect(f().getAttribute("src")).toBeNull();
    click(el, "consent-reject-all");
    expect(f().getAttribute("src")).toBeNull();
    click(el, "consent-reopen");
    click(el, "consent-panel-accept-all");
    expect(f().getAttribute("src")).toBe("about:blank#youtube-embed");
  });
});

describe("Google Consent Mode v2 (AC#2)", () => {
  const calls = () => (w.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));

  it("with consent-mode: default=denied first, then an update with the choice", () => {
    page();
    const el = mount({ "consent-mode": "" });
    expect(calls()[0]).toStrictEqual(["consent", "default", {
      analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", wait_for_update: 500,
    }]);
    click(el, "consent-customize");
    click(el, "consent-toggle-analytics");
    click(el, "consent-save");
    expect(calls().at(-1)).toStrictEqual(["consent", "update", {
      analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    }]);
  });

  it("without consent-mode, gtag is never touched", () => {
    page();
    const el = mount();
    click(el, "consent-accept-all");
    expect(w.dataLayer).toBeUndefined();
    expect(w.gtag).toBeUndefined();
  });
});

describe("withdrawing after a script ran (AC#3)", () => {
  it("reloads the page, and says so on the link first", () => {
    page();
    const el = mount();
    const reload = vi.fn();
    el.reload = reload;
    click(el, "consent-accept-all");
    click(el, "consent-reopen");
    expect(el.shadowRoot!.querySelector('[data-testid="consent-withdraw"]')!.textContent).toBe("Træk samtykke tilbage (siden genindlæses)");
    click(el, "consent-withdraw");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(mem.get("broberg-consent")).toBeUndefined();
  });

  it("negative control: nothing ran → no reload, ordinary text", () => {
    document.body.innerHTML = "";
    const el = mount();
    const reload = vi.fn();
    el.reload = reload;
    click(el, "consent-reject-all");
    click(el, "consent-reopen");
    expect(el.shadowRoot!.querySelector('[data-testid="consent-withdraw"]')!.textContent).toBe("Træk samtykke tilbage");
    click(el, "consent-withdraw");
    expect(reload).not.toHaveBeenCalled();
  });
});
