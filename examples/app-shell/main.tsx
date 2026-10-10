// F092.15 — the user menu at the bottom of the sidebar (Scout's KAI shell):
// subtitle, radio groups, an item with a shortcut hint, zoom. Invented data.
// Run: pnpm --filter app-shell-example dev  →  http://127.0.0.1:5195
import "@broberg/theme/css/palettes.css";
import "@broberg/app-shell/css/app-shell.css";
import { render } from "preact";
import { useState } from "preact/hooks";
import { initPalette, initTheme } from "@broberg/theme";
import { AppShell } from "@broberg/app-shell/preact";

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
        ] }]}
        collapse="icon"
        homeHref="/"
        homeLabel="Scout"
        currentPath="/"
        user={{ name: "Example User", email: "user@example.com", subtitle: `Administrator · ${unit === "nord" ? "Enhed Nord" : "Enhed Syd"}` }}
        userMenuPlacement="sidebar-footer"
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

render(<App />, document.getElementById("app")!);
