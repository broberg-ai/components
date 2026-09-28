/**
 * <broberg-consent> — the drop-in cookie banner (F014, mockup approved 28/9 2026).
 *
 * ONE implementation for every stack. A custom element runs the same way in a
 * Next page, a Vite+Preact app and a plain HTML site, so no site copies or
 * maintains its own banner. The consent LOGIC stays in the headless core
 * (`createConsentManager`); this file is only the UI on top of it.
 *
 *   <script type="module">import "@broberg/consent-cookie/element";</script>
 *   <broberg-consent policy-version="2026-09" privacy-href="/privatliv"></broberg-consent>
 *   <a href="#" data-broberg-consent-open>Cookie-indstillinger</a>
 *
 * The round «Cookies» handle floats bottom-left and WILL cover whatever the site
 * has there (Lens measured it covering a footer link, 28/9). Move it with
 * reopen-position="bottom-right" | "top-left" | "top-right" and
 * --broberg-consent-reopen-x / -y, or drop it with
 * hide-reopen when the site already has a [data-broberg-consent-open] link.
 *
 * Styling reads the page's @broberg/theme tokens (--primary, --radius, …)
 * through the shadow boundary, each with a neutral fallback, so a site without
 * the theme still gets a correct banner.
 *
 * What is deliberately NOT negotiable here, because it is the law and not taste:
 *   · "Afvis alle" and "Accepter alle" share one style and one size.
 *   · No optional category starts switched on.
 *   · A way back (the round handle, or any [data-broberg-consent-open]) exists
 *     after every decision, and withdrawing clears the record.
 */
import {
  createConsentManager,
  createCookieConsentStorage,
  type ConsentCategory,
  type ConsentManager,
  type ConsentRecord,
} from "./index.js";

export interface ConsentTexts {
  title: string;
  titleUpdated: string;
  body: string;
  readMore: string;
  rejectAll: string;
  acceptAll: string;
  customize: string;
  panelTitle: string;
  panelBody: string;
  alwaysOn: string;
  save: string;
  withdraw: string;
  withdrawReload: string;
  reopen: string;
  noChoice: string;
  saved: string;
  categories: Record<string, { label: string; description: string }>;
}

export const TEXTS: Record<"da" | "en", ConsentTexts> = {
  da: {
    title: "Vi bruger cookies",
    titleUpdated: "Vores cookie-politik er opdateret",
    body:
      "Nødvendige cookies får siden til at virke. Med dit samtykke bruger vi også cookies til statistik og marketing. " +
      "Du kan altid ændre dit valg under «Cookie-indstillinger».",
    readMore: "Læs mere",
    rejectAll: "Afvis alle",
    acceptAll: "Accepter alle",
    customize: "Tilpas",
    panelTitle: "Cookie-indstillinger",
    panelBody: "Vælg hvilke cookies vi må bruge. Dit valg gælder på dette site og kan ændres når som helst.",
    alwaysOn: "Altid til",
    save: "Gem valg",
    withdraw: "Træk samtykke tilbage",
    withdrawReload: "Træk samtykke tilbage (siden genindlæses)",
    reopen: "Cookies",
    noChoice: "Intet valg endnu",
    saved: "Gemt",
    categories: {
      essential: { label: "Nødvendige", description: "Får siden til at virke: login, sikkerhed og dit cookie-valg. Kan ikke slås fra." },
      analytics: { label: "Statistik", description: "Hjælper os med at forstå, hvordan siden bruges, så vi kan forbedre den." },
      marketing: { label: "Marketing", description: "Bruges til at vise relevante annoncer og måle kampagner, også på andre sites." },
    },
  },
  en: {
    title: "We use cookies",
    titleUpdated: "Our cookie policy has been updated",
    body:
      "Necessary cookies make the site work. With your consent we also use cookies for statistics and marketing. " +
      "You can change your choice at any time under “Cookie settings”.",
    readMore: "Read more",
    rejectAll: "Reject all",
    acceptAll: "Accept all",
    customize: "Customize",
    panelTitle: "Cookie settings",
    panelBody: "Choose which cookies we may use. Your choice applies to this site and can be changed at any time.",
    alwaysOn: "Always on",
    save: "Save choice",
    withdraw: "Withdraw consent",
    withdrawReload: "Withdraw consent (the page reloads)",
    reopen: "Cookies",
    noChoice: "No choice yet",
    saved: "Saved",
    categories: {
      essential: { label: "Necessary", description: "Make the site work: login, security and your cookie choice. Cannot be turned off." },
      analytics: { label: "Statistics", description: "Help us understand how the site is used so we can improve it." },
      marketing: { label: "Marketing", description: "Used to show relevant ads and measure campaigns, also on other sites." },
    },
  },
};

const STYLE = `
:host{all:initial;font:14px/1.5 var(--font-sans,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);
  --bc-bg:var(--card,#fff);--bc-fg:var(--card-foreground,#1f1f1f);--bc-muted:var(--muted-foreground,#6b6b6b);
  --bc-border:var(--border,#e5e5e5);--bc-primary:var(--primary,#1f1f1f);--bc-on-primary:var(--primary-foreground,#fafafa);
  --bc-secondary:var(--secondary,#f2f2f2);--bc-ring:var(--ring,#a3a3a3);--bc-radius:var(--radius,0.5rem)}
*{box-sizing:border-box}
[hidden]{display:none!important}
.banner{position:fixed;z-index:2147483000;left:24px;bottom:24px;width:440px;max-width:calc(100vw - 24px);background:var(--bc-bg);color:var(--bc-fg);
  border:1px solid var(--bc-border);border-radius:calc(var(--bc-radius) + 4px);box-shadow:0 12px 32px rgba(0,0,0,.18);padding:20px}
@media (max-width:520px){.banner{left:12px;right:12px;bottom:12px;width:auto;padding:16px}}
h2{margin:0 0 6px;font-size:16px;font-weight:600}
.banner p{margin:0 0 16px;font-size:13px;color:var(--bc-muted)}
a{color:var(--bc-fg)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
button{font:inherit}
.btn{appearance:none;border:1px solid transparent;border-radius:var(--bc-radius);padding:10px 14px;font-weight:600;font-size:14px;cursor:pointer;transition:filter .12s,transform .06s}
.btn:hover{filter:brightness(1.08)}
.btn:active{transform:translateY(1px)}
.banner:focus,.panel:focus{outline:none}
.btn:focus-visible,.switch:focus-visible,.reopen:focus-visible,a:focus-visible{outline:2px solid var(--bc-ring);outline-offset:2px}
.main{background:var(--bc-primary);color:var(--bc-on-primary)}
.ghost{background:transparent;color:var(--bc-fg);border-color:var(--bc-border);font-weight:500}
.wide{margin-top:10px;display:block;width:100%}
.scrim{position:fixed;z-index:2147483001;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.panel{width:520px;max-width:100%;max-height:100%;overflow:auto;background:var(--bc-bg);color:var(--bc-fg);border:1px solid var(--bc-border);
  border-radius:calc(var(--bc-radius) + 4px);padding:22px}
.panel>p{margin:0 0 14px;font-size:13px;color:var(--bc-muted)}
.cat{display:flex;gap:14px;align-items:flex-start;justify-content:space-between;padding:14px 0;border-top:1px solid var(--bc-border)}
.cat h3{margin:0 0 2px;font-size:14px;font-weight:600}
.cat p{margin:0;font-size:12.5px;color:var(--bc-muted)}
.tag{font-size:11px;color:var(--bc-muted);white-space:nowrap;padding-top:3px}
.switch{flex:none;width:42px;height:24px;border-radius:999px;border:0;background:var(--bc-secondary);position:relative;cursor:pointer;margin-top:2px;padding:0}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:var(--bc-bg);box-shadow:0 1px 2px rgba(0,0,0,.3);transition:left .15s}
.switch[aria-checked="true"]{background:var(--bc-primary)}
.switch[aria-checked="true"]::after{left:21px;background:var(--bc-on-primary)}
.foot{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding-top:16px;border-top:1px solid var(--bc-border)}
@media (max-width:520px){.foot{grid-template-columns:1fr}}
.meta{margin-top:12px;font-size:11.5px;color:var(--bc-muted)}
.linkbtn{background:none;border:0;padding:0;color:var(--bc-fg);text-decoration:underline;cursor:pointer;font-size:inherit}
.reopen{position:fixed;z-index:2147483000;left:var(--broberg-consent-reopen-x,16px);bottom:var(--broberg-consent-reopen-y,16px);display:flex;align-items:center;gap:6px;background:var(--bc-bg);color:var(--bc-fg);
  border:1px solid var(--bc-border);border-radius:999px;padding:7px 12px 7px 10px;font-size:12.5px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.12)}
.reopen.right{left:auto;right:var(--broberg-consent-reopen-x,16px)}
.reopen.top{bottom:auto;top:var(--broberg-consent-reopen-y,16px)}
.reopen svg{width:16px;height:16px}
`;

const COOKIE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 4 4 0 0 1-5-5 4 4 0 0 1-4-4Z"/><circle cx="8.5" cy="11" r="1"/><circle cx="12" cy="16" r="1"/></svg>';

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FOCUSABLE = 'button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

/**
 * reopen-position → classes. bottom-left (default), bottom-right, top-left,
 * top-right; the 0.2.0 values left/right still mean the bottom corners.
 */
const reopenCorner = (pos: string | null): string =>
  ({ right: " right", "bottom-right": " right", "top-left": " top", "top-right": " top right" })[pos ?? ""] ?? "";

/** Every open-trigger on the page ([data-broberg-consent-open]) reaches the last connected element. */
let active: BrobergConsentElement | null = null;
let triggerListening = false;
function listenForTriggers(): void {
  if (triggerListening || typeof document === "undefined") return;
  triggerListening = true;
  document.addEventListener("click", (e) => {
    const t = (e.target as Element | null)?.closest?.("[data-broberg-consent-open]");
    if (!t || !active) return;
    e.preventDefault();
    active.open();
  });
}

// ── F014.9: nothing marked runs before consent ─────────────────────────────
//
// OPT-IN BY MARKING, never a blanket blocker. Only elements the site itself
// marks are held back:
//   <script type="text/plain" data-consent="analytics" src="…"></script>
//   <iframe data-consent="marketing" data-consent-src="https://youtube…"></iframe>
// Everything unmarked (app code, login, payments, session cookies) runs exactly
// as before. Intercepting every script would be the thing that breaks logins.

const ACTIVATED = "data-consent-activated";

/** Activate every marked script/iframe whose category is now granted. Returns how many ran. */
export function activateGranted(has: (category: string) => boolean, root: ParentNode = document): number {
  let n = 0;
  root.querySelectorAll<HTMLScriptElement>(`script[type="text/plain"][data-consent]:not([${ACTIVATED}])`).forEach((old) => {
    if (!has(old.dataset.consent!)) return;
    const s = document.createElement("script");
    for (const a of Array.from(old.attributes)) {
      if (a.name === "type" || a.name === "data-consent") continue;
      s.setAttribute(a.name, a.value);
    }
    // data-type restores a module/other type; default is a classic script.
    const t = old.getAttribute("data-type");
    if (t) s.setAttribute("type", t);
    s.removeAttribute("data-type");
    s.setAttribute("data-consent", old.dataset.consent!);
    s.setAttribute(ACTIVATED, "");
    // A script created from JS is async by default; keep document order unless the site asked for async.
    if (!old.hasAttribute("async")) s.async = false;
    s.text = old.text;
    old.setAttribute(ACTIVATED, "");
    old.replaceWith(s);
    n++;
  });
  root.querySelectorAll<HTMLIFrameElement>(`iframe[data-consent][data-consent-src]:not([${ACTIVATED}])`).forEach((f) => {
    if (!has(f.dataset.consent!)) return;
    f.setAttribute("src", f.dataset.consentSrc!);
    f.setAttribute(ACTIVATED, "");
    n++;
  });
  return n;
}

type Gtag = (...args: unknown[]) => void;
/** Google Consent Mode v2 — only when the site asks for it (consent-mode attribute). */
function gtagOf(): Gtag {
  const w = globalThis as unknown as { dataLayer?: unknown[]; gtag?: Gtag };
  w.dataLayer = w.dataLayer || [];
  // The official gtag stub pushes the ARGUMENTS object, not an array.
  if (!w.gtag) w.gtag = function () { w.dataLayer!.push(arguments); };
  return w.gtag;
}
export function consentModeState(has: (c: string) => boolean): Record<string, "granted" | "denied"> {
  const g = (b: boolean) => (b ? "granted" : "denied");
  return {
    analytics_storage: g(has("analytics")),
    ad_storage: g(has("marketing")),
    ad_user_data: g(has("marketing")),
    ad_personalization: g(has("marketing")),
  };
}

const Base: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

export class BrobergConsentElement extends Base {
  static get observedAttributes(): string[] {
    return ["lang"];
  }

  /** The headless manager. Read consent with `el.manager.has("analytics")`. */
  manager!: ConsentManager;
  /** Override any text; merged over the built-in language. */
  texts: Partial<ConsentTexts> = {};

  private root!: ShadowRoot;
  private view: "banner" | "panel" | "closed" = "closed";
  private draft: Record<string, boolean> = {};
  private lastFocus: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Overridable for tests. Withdrawing cannot stop a script that already ran, so the page reloads. */
  reload: () => void = () => location.reload();

  connectedCallback(): void {
    const policyVersion = this.getAttribute("policy-version");
    if (!policyVersion) {
      throw new Error('<broberg-consent>: the "policy-version" attribute is required (bump it when your cookie policy changes).');
    }
    if (!this.manager) {
      this.manager = createConsentManager({
        policyVersion,
        // F014.13: a first-party cookie the server can read, renewed yearly.
        storage: createCookieConsentStorage({
          name: this.getAttribute("storage-key") ?? undefined,
          domain: this.getAttribute("cookie-domain") ?? undefined,
        }),
      });
    }
    if (!this.root) this.root = this.attachShadow({ mode: "open" });
    const consentMode = this.hasAttribute("consent-mode");
    if (consentMode) {
      gtagOf()("consent", "default", { ...consentModeState(() => false), wait_for_update: 500 });
      if (!this.manager.needsBanner()) gtagOf()("consent", "update", consentModeState((c) => this.manager.has(c)));
    }
    this.unsubscribe = this.manager.subscribe((record) => {
      if (consentMode) gtagOf()("consent", "update", consentModeState((c) => this.manager.has(c)));
      if (record) activateGranted((c) => this.manager.has(c));
      this.dispatchEvent(new CustomEvent<ConsentRecord | null>("consent-change", { detail: record, bubbles: true, composed: true }));
    });
    // A returning visitor with a stored, current choice: run what they allowed.
    if (!this.manager.needsBanner()) activateGranted((c) => this.manager.has(c));
    active = this;
    (globalThis as { brobergConsent?: ConsentManager }).brobergConsent = this.manager;
    listenForTriggers();
    this.view = this.manager.needsBanner() ? "banner" : "closed";
    this.render();
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (active === this) active = null;
  }

  attributeChangedCallback(): void {
    if (this.root) this.render();
  }

  /** Open the settings panel (what the reopen handle and footer links do). */
  open(): void {
    this.lastFocus = (document.activeElement as HTMLElement | null) ?? null;
    const rec = this.manager.getRecord();
    this.draft = {};
    for (const c of this.manager.categories) this.draft[c.key] = c.essential ? true : rec?.categories[c.key] === true;
    this.view = "panel";
    this.render();
    // Focus the DIALOG, never a control inside it. Measured in Chromium via
    // Lens 28/9: moving focus onto a button during the activating click lets a
    // second activation (a held Enter, or an automation re-dispatch) land on
    // that button, which here would silently toggle a category.
    this.q<HTMLElement>('[data-testid="consent-panel"]')?.focus();
  }

  private close(): void {
    this.view = this.manager.needsBanner() ? "banner" : "closed";
    this.render();
    this.restoreFocus();
  }

  /** Back to where the user was, if that is outside us. Never onto one of our buttons. */
  private restoreFocus(): void {
    const f = this.lastFocus;
    this.lastFocus = null;
    if (f && f !== this && f.isConnected && typeof f.focus === "function") f.focus();
  }

  private get t(): ConsentTexts {
    const lang = (this.getAttribute("lang") ?? document.documentElement.lang ?? "da").toLowerCase().startsWith("en") ? "en" : "da";
    const base = TEXTS[lang];
    return { ...base, ...this.texts, categories: { ...base.categories, ...(this.texts.categories ?? {}) } };
  }

  private q<T extends Element>(sel: string): T | null {
    return this.root.querySelector<T>(sel);
  }

  private label(c: ConsentCategory): { label: string; description: string } {
    return this.t.categories[c.key] ?? { label: c.label, description: c.description };
  }

  private decide(kind: "accept" | "reject" | "save"): void {
    if (kind === "accept") this.manager.acceptAll();
    else if (kind === "reject") this.manager.rejectAll();
    else this.manager.setConsent(this.draft);
    this.view = "closed";
    this.render();
    // NOT the reopen handle: that is exactly the button a second activation
    // would hit, reopening the panel the user just closed (the Lens finding).
    this.restoreFocus();
  }

  private render(): void {
    const t = this.t;
    const hideReopen = this.hasAttribute("hide-reopen");
    const privacy = this.getAttribute("privacy-href");
    const decided = !this.manager.needsBanner();
    const rec = this.manager.getRecord();
    const version = esc(this.getAttribute("policy-version") ?? "");

    const cats = this.manager.categories
      .map((c) => {
        const l = this.label(c);
        const control = c.essential
          ? `<span class="tag">${esc(t.alwaysOn)}</span>`
          : `<button class="switch" role="switch" aria-checked="${this.draft[c.key] === true}" aria-label="${esc(l.label)}" data-key="${esc(c.key)}" data-testid="consent-toggle-${esc(c.key)}"></button>`;
        return `<div class="cat"><div><h3>${esc(l.label)}</h3><p>${esc(l.description)}</p></div>${control}</div>`;
      })
      .join("");

    this.root.innerHTML = `<style>${STYLE}</style>
<div class="banner" tabindex="-1" role="region" aria-label="Cookies" data-testid="consent-banner" ${this.view === "banner" ? "" : "hidden"}>
  <h2>${esc(this.manager.isOutdated() ? t.titleUpdated : t.title)}</h2>
  <p>${esc(t.body)}${privacy ? ` <a href="${esc(privacy)}" data-testid="consent-read-more">${esc(t.readMore)}</a>` : ""}</p>
  <div class="row">
    <button class="btn main" data-act="reject" data-testid="consent-reject-all">${esc(t.rejectAll)}</button>
    <button class="btn main" data-act="accept" data-testid="consent-accept-all">${esc(t.acceptAll)}</button>
  </div>
  <button class="btn ghost wide" data-act="open" data-testid="consent-customize">${esc(t.customize)}</button>
</div>
<div class="scrim" ${this.view === "panel" ? "" : "hidden"}>
  <div class="panel" tabindex="-1" role="dialog" aria-modal="true" aria-label="${esc(t.panelTitle)}" data-testid="consent-panel">
    <h2>${esc(t.panelTitle)}</h2>
    <p>${esc(t.panelBody)}</p>
    ${cats}
    <div class="foot">
      <button class="btn main" data-act="reject" data-testid="consent-panel-reject-all">${esc(t.rejectAll)}</button>
      <button class="btn ghost" data-act="save" data-testid="consent-save">${esc(t.save)}</button>
      <button class="btn main" data-act="accept" data-testid="consent-panel-accept-all">${esc(t.acceptAll)}</button>
    </div>
    <div class="meta">${version}${rec ? "" : ` · ${esc(t.noChoice)}`}${
      rec ? ` · <button class="linkbtn" data-act="withdraw" data-testid="consent-withdraw">${esc(document.querySelector(`[${ACTIVATED}]`) ? t.withdrawReload : t.withdraw)}</button>` : ""
    }</div>
  </div>
</div>
<button class="reopen${reopenCorner(this.getAttribute("reopen-position"))}" data-act="open" data-testid="consent-reopen" aria-label="${esc(t.panelTitle)}" ${
      this.view === "closed" && decided && !hideReopen ? "" : "hidden"
    }>${COOKIE_SVG}${esc(t.reopen)}</button>`;

    this.root.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
      b.addEventListener("click", () => {
        const act = b.dataset.act;
        if (act === "accept" || act === "reject" || act === "save") this.decide(act);
        else if (act === "open") this.open();
        else if (act === "withdraw") {
          const ranSomething = document.querySelector(`[${ACTIVATED}]`) !== null;
          this.manager.withdraw();
          // A tracker that already ran cannot be un-run; only a fresh page is clean.
          if (ranSomething) { this.reload(); return; }
          this.view = "banner";
          this.render();
          // The banner region, not «Afvis alle»: a second activation must not
          // record a choice the user never made.
          this.q<HTMLElement>('[data-testid="consent-banner"]')?.focus();
        }
      });
    });
    this.root.querySelectorAll<HTMLElement>(".switch").forEach((s) => {
      s.addEventListener("click", () => {
        const key = s.dataset.key!;
        this.draft[key] = !this.draft[key];
        s.setAttribute("aria-checked", String(this.draft[key]));
      });
    });
    const panel = this.q<HTMLElement>('[data-testid="consent-panel"]');
    panel?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      const cur = this.root.activeElement;
      if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    });
  }
}

/** Register the element. Safe to call twice; a no-op without a DOM (SSR). */
export function defineBrobergConsent(tag = "broberg-consent"): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(tag)) customElements.define(tag, BrobergConsentElement);
}

defineBrobergConsent();
