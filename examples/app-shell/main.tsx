// F092.15 — the user menu at the bottom of the sidebar (Scout's KAI shell):
// subtitle, radio groups, an item with a shortcut hint, zoom. Invented data.
// Run: pnpm --filter app-shell-example dev  →  http://127.0.0.1:5195
import "@broberg/theme/css/palettes.css";
import "@broberg/app-shell/css/app-shell.css";
import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { initPalette, initTheme } from "@broberg/theme";
import { AppShell, ItemActionsMenu } from "@broberg/app-shell/preact";
// F014.21 — the cookie banner on @broberg/theme's palette, as appkit composes it.
import "@broberg/consent-cookie/element";

const FIELD = new URLSearchParams(location.search).has("field");

initTheme();
initPalette();

// F092.31 — a composer «+» opening ABOVE itself, left-aligned (placement "up-start").
function PlusMenu() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "fixed", bottom: "24px", left: "260px" }}>
      <button ref={anchor} type="button" data-testid="plus-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>+</button>
      {open && anchor.current ? (
        <ItemActionsMenu
          actions={[{ id: "file", label: "Vedhæft fil" }, { id: "photo", label: "Tag billede" }]}
          anchor={anchor.current}
          lang="da"
          label="Tilføj"
          placement="up-start"
          testidPrefix="plus"
          onAction={(a) => { document.body.dataset.lastAction = `plus:${a}`; }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

// F092.29 — a title «⌄» opening THE SAME menu as the row «…», plus two extra items.
function TitleMenu() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: "12px" }}>
      <button ref={anchor} type="button" data-testid="title-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Mødereferat ⌄
      </button>
      {open && anchor.current ? (
        <ItemActionsMenu
          actions={[
            { id: "pin", label: "Fastgør", kbd: "P" },
            { id: "rename", label: "Omdøb", kbd: "R", input: { value: "Mødereferat" } },
            { id: "move", label: "Flyt til", value: "Projekt A", submenu: [{ id: "move-a", label: "Projekt A" }, { id: "move-b", label: "Projekt B" }] },
            { id: "delete", label: "Slet", kbd: "D", danger: true, confirm: { label: "Tryk igen for at slette" } },
            { id: "share", label: "Del chat", separator: true },
            { id: "copy", label: "Kopiér link" },
            { id: "sort", label: "Sortér efter", value: "Seneste aktivitet", separator: true, submenu: [{ id: "sort-recent", label: "Seneste aktivitet" }] },
            { id: "scope", label: "Projekt", value: "Leverandøranalyse for næste kvartal", submenu: [{ id: "scope-all", label: "Alle" }] },
          ]}
          anchor={anchor.current}
          lang="da"
          label="Mødereferat"
          placement="down"
          testidPrefix="title"
          onAction={(a, v) => { document.body.dataset.lastAction = ["title", a, v].filter((x) => x !== undefined).join(":"); }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function App() {
  const [org, setOrg] = useState("acme");
  const [unit, setUnit] = useState("nord");
  const [area, setArea] = useState("chat");
  const [zoom, setZoom] = useState(100);
  const sections = [
    { id: "org", label: "Organisation", items: [{ id: "acme", label: "Acme A/S" }, { id: "beta", label: "Beta ApS" }].map((i) => ({ ...i, checked: i.id === org })) },
    { id: "unit", label: "Enhed", items: [{ id: "nord", label: "Enhed Nord" }, { id: "syd", label: "Enhed Syd" }].map((i) => ({ ...i, checked: i.id === unit })) },
    { id: "area", label: "Scout", items: [{ id: "chat", label: "Scout Chat" }, { id: "admin", label: "Scout Admin" }, { id: "platform", label: "Scout Platform" }].map((i) => ({ ...i, checked: i.id === area })) },
  ];
  return (
    <div style={{ zoom: zoom / 100 }}>
      <AppShell
        // F092.24 — ?scale=1.2 = the app's default text size; ?v7 = scout's mockup v7 row tokens.
        fontScale={new URLSearchParams(location.search).has("scale") ? Number(new URLSearchParams(location.search).get("scale")) : undefined}
        lang="da"
        brand={<strong>Scout</strong>}
        groups={[{ label: "Samtaler", items: [
          { id: "new", label: "Ny samtale", href: "/", icon: <span>N</span> },
          // F092.36 — ?field: a long label with a short tab label for the phone.
          { id: "jobs", label: FIELD ? "Jobs og leverandøraftaler" : "Jobs", ...(FIELD ? { shortLabel: "Jobs" } : {}), href: "/jobs", icon: <span>J</span> },
          // F092.16 — children open in a flyout when the sidebar is folded to the icon rail.
          { id: "reports", label: "Rapporter", href: "/reports", icon: <span>R</span>, children: [
            { id: "reports-revenue", label: "Omsætning", href: "/reports/revenue" },
            { id: "reports-orders", label: "Ordrer", href: "/reports/orders" },
          ] },
        ] },
        // F092.23 — a group with no heading row (scout's first group in mockup v7).
        { label: "Seneste", hideLabel: true, items: [{ id: "s-1", label: "Ny samtale", href: "/c/new", marker: "idle" }] },
        // F092.20 — a chat history: plain group, a pinned item, day sub-headings, a running marker.
        { label: "Historik", variant: "plain", collapsible: !new URLSearchParams(location.search).has("v7"),
          // F092.28 — an icon button at the right of the heading; the app opens its own menu.
          action: { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" /></svg>, label: "Filtrér og sortér", onClick: (a) => { document.body.dataset.filterAnchor = a.dataset.testid ?? ""; } }, items: [
          { id: "h-pin", label: "Budget for næste kvartal — gennemgang af alle afdelingers tal", href: "/c/pin", pinned: true },
        ], sections: [
          { label: "I dag", items: [
            { id: "h-run", label: "Leverandøranalyse kører", href: "/c/run", marker: "working" },
            // F092.21 — row actions: «…» → menu, shortcuts, a submenu and a rename field.
            { id: "h-1", label: "Mødereferat", href: "/c/1", marker: "idle", actions: [
              { id: "pin", label: "Fastgør", kbd: "P" },
              { id: "rename", label: "Omdøb", kbd: "R", input: { value: "Mødereferat" } },
              { id: "move", label: "Flyt til", value: "Projekt A", submenu: [{ id: "move-a", label: "Projekt A" }, { id: "move-b", label: "Projekt B" }] },
              { id: "delete", label: "Slet", kbd: "D", danger: true, confirm: { label: "Tryk igen for at slette" } },
            ] },
          ] },
          { label: "I går", items: [{ id: "h-2", label: "Kontraktudkast", href: "/c/2", marker: "idle" }] },
        ] }]}
        onItemAction={(item, action, value) => {
          document.body.dataset.lastAction = [item, action, value].filter((x) => x !== undefined).join(":");
        }}
        collapse="icon"
        // F092.35 — ?field = Field's approved overview: bottom tab bar on a phone, only
        // Light/Dark/System, the theme block before «Konto», and the app's own wording.
        {...(FIELD ? { mobile: "bottom-nav" as const, mobileNavTestId: "overview-mobilenav", strings: { da: { collapse: "Skift sidemenu", light: "Lyst", dark: "Mørkt" } } } : {})}
        homeHref="/"
        homeLabel="Scout"
        currentPath="/"
        user={{ name: "Example User", email: "user@example.com", org: "broberg.ai", subtitle: `Administrator · ${unit === "nord" ? "Enhed Nord" : "Enhed Syd"}` }}
        userMenuPlacement={new URLSearchParams(location.search).get("placement") === "topbar" ? "topbar" : "sidebar-footer"}
        userMenu={{
          accountHref: "#",
          onSignOut: () => {},
          items: [{ id: "search", label: "Søg", hint: "⌘K", onSelect: () => {} }],
          sections,
          onSectionSelect: (s, i) => (s === "org" ? setOrg(i) : s === "unit" ? setUnit(i) : setArea(i)),
          zoom: { value: zoom, onChange: setZoom },
          ...(FIELD ? { appearance: { palette: false, surfaces: false }, appearancePosition: "top" as const } : {}),
        }}
        title="Ny samtale"
      >
        <div style={{ padding: "16px 24px" }}>
          Indhold
          <TitleMenu />
          <PlusMenu />
        </div>
      </AppShell>
    </div>
  );
}

// F092.24 — an app hits its approved mockup by setting the row tokens on its OWN selector.
if (new URLSearchParams(location.search).has("v7")) {
  const v7 = document.createElement("style");
  v7.textContent = `.scout-v7 .bas-sidebar { --bas-item-font-size: 18px; --bas-item-padding: 9px 12px; --bas-item-gap: 10px; --bas-item-radius: .5rem; --bas-item-icon-color: var(--fg-muted); --bas-item-active-bg: var(--accent-soft); --bas-item-active-weight: 600; --bas-group-label-font-size: 15px; --bas-group-label-color: var(--fg-muted); --bas-group-label-padding: 14px 10px 6px; --bas-section-label-font-size: 13.5px; --bas-section-label-color: var(--fg-muted); }`;
  document.head.appendChild(v7);
  document.body.classList.add("scout-v7");
}
// F092.25 — «same spacing as Claude Desktop» (scout #2720): 40px rows.
if (new URLSearchParams(location.search).has("desktop")) {
  const d = document.createElement("style");
  d.textContent = `.scout-desktop .bas-sidebar { --bas-item-font-size: 17px; --bas-item-line-height: 24px; --bas-item-padding: 8px 12px; --bas-item-gap: 14px; }`;
  document.head.appendChild(d);
  document.body.classList.add("scout-desktop");
}
// F092.27 — token values must be real values: ?inherit shows the trap, ?sans the fix.
const q = new URLSearchParams(location.search);
if (q.has("inherit") || q.has("sans")) {
  const st = document.createElement("style");
  st.textContent = `.bas-sidebar { --bas-group-label-font-family: ${q.has("inherit") ? "inherit" : "system-ui, sans-serif"}; }`;
  document.head.appendChild(st);
}
render(<App />, document.getElementById("app")!);
const consent = document.createElement("broberg-consent");
consent.setAttribute("policy-version", "example-1");
// The user menu sits at the bottom of the sidebar here, exactly where the banner
// would land: move the banner past the 240px sidebar on desktop (F014.17's variable).
consent.style.setProperty("--broberg-consent-banner-left", "264px");
document.body.appendChild(consent);
