// F092.15 — the user menu at the bottom of the sidebar (Scout's KAI shell):
// subtitle, radio groups, an item with a shortcut hint, zoom. Invented data.
// Run: pnpm --filter app-shell-example dev  →  http://127.0.0.1:5195
import "@broberg/theme/css/palettes.css";
import "@broberg/app-shell/css/app-shell.css";
import { render } from "preact";
import { useState } from "preact/hooks";
import { initPalette, initTheme } from "@broberg/theme";
import { AppShell } from "@broberg/app-shell/preact";
// F014.21 — the cookie banner on @broberg/theme's palette, as appkit composes it.
import "@broberg/consent-cookie/element";

initTheme();
initPalette();

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
          { id: "jobs", label: "Jobs", href: "/jobs", icon: <span>J</span> },
          // F092.16 — children open in a flyout when the sidebar is folded to the icon rail.
          { id: "reports", label: "Rapporter", href: "/reports", icon: <span>R</span>, children: [
            { id: "reports-revenue", label: "Omsætning", href: "/reports/revenue" },
            { id: "reports-orders", label: "Ordrer", href: "/reports/orders" },
          ] },
        ] },
        // F092.23 — a group with no heading row (scout's first group in mockup v7).
        { label: "Seneste", hideLabel: true, items: [{ id: "s-1", label: "Ny samtale", href: "/c/new", marker: "idle" }] },
        // F092.20 — a chat history: plain group, a pinned item, day sub-headings, a running marker.
        { label: "Historik", variant: "plain", collapsible: !new URLSearchParams(location.search).has("v7"), items: [
          { id: "h-pin", label: "Budget for næste kvartal — gennemgang af alle afdelingers tal", href: "/c/pin", pinned: true },
        ], sections: [
          { label: "I dag", items: [
            { id: "h-run", label: "Leverandøranalyse kører", href: "/c/run", marker: "working" },
            // F092.21 — row actions: «…» → menu, shortcuts, a submenu and a rename field.
            { id: "h-1", label: "Mødereferat", href: "/c/1", marker: "idle", actions: [
              { id: "pin", label: "Fastgør", kbd: "P" },
              { id: "rename", label: "Omdøb", kbd: "R", input: { value: "Mødereferat" } },
              { id: "move", label: "Flyt til", submenu: [{ id: "move-a", label: "Projekt A" }, { id: "move-b", label: "Projekt B" }] },
              { id: "delete", label: "Slet", kbd: "D", danger: true, confirm: { label: "Tryk igen for at slette" } },
            ] },
          ] },
          { label: "I går", items: [{ id: "h-2", label: "Kontraktudkast", href: "/c/2", marker: "idle" }] },
        ] }]}
        onItemAction={(item, action, value) => {
          document.body.dataset.lastAction = [item, action, value].filter((x) => x !== undefined).join(":");
        }}
        collapse="icon"
        homeHref="/"
        homeLabel="Scout"
        currentPath="/"
        user={{ name: "Example User", email: "user@example.com", subtitle: `Administrator · ${unit === "nord" ? "Enhed Nord" : "Enhed Syd"}` }}
        userMenuPlacement={new URLSearchParams(location.search).get("placement") === "topbar" ? "topbar" : "sidebar-footer"}
        userMenu={{
          accountHref: "#",
          onSignOut: () => {},
          items: [{ id: "search", label: "Søg", hint: "⌘K", onSelect: () => {} }],
          sections,
          onSectionSelect: (s, i) => (s === "org" ? setOrg(i) : s === "unit" ? setUnit(i) : setArea(i)),
          zoom: { value: zoom, onChange: setZoom },
        }}
        title="Ny samtale"
      >
        <div style={{ padding: "16px 24px" }}>Indhold</div>
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
render(<App />, document.getElementById("app")!);
const consent = document.createElement("broberg-consent");
consent.setAttribute("policy-version", "example-1");
// The user menu sits at the bottom of the sidebar here, exactly where the banner
// would land: move the banner past the 240px sidebar on desktop (F014.17's variable).
consent.style.setProperty("--broberg-consent-banner-left", "264px");
document.body.appendChild(consent);
