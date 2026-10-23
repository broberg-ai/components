// F018.4 — the Preact command palette with invented items. Run: pnpm --filter cmdk-example dev (:5197)
import "@broberg/theme/css/palettes.css";
import "@broberg/cmdk/css/cmdk.css";
import { render } from "preact";
import { useState } from "preact/hooks";
import { initPalette, initTheme } from "@broberg/theme";
import { CommandPaletteProvider, useCommandPalette, type PaletteItem } from "@broberg/cmdk/preact";

initTheme();
initPalette();

function App() {
  const [last, setLast] = useState("—");
  const items: PaletteItem[] = [
    { id: "inbox", label: "Indbakke", group: "Navigation", keywords: ["mail"], action: () => setLast("Indbakke") },
    { id: "settings", label: "Indstillinger", group: "Navigation", action: () => setLast("Indstillinger") },
    { id: "new-mail", label: "Ny mail", group: "Handlinger", sublabel: "⌘N", action: () => setLast("Ny mail") },
    { id: "export", label: "Eksportér som CSV", group: "Handlinger", action: () => setLast("Eksportér som CSV") },
    { id: "docs", label: "Dokumentation", group: "Links", href: "#docs" },
  ];
  return (
    <CommandPaletteProvider
      items={items}
      placeholder="Søg efter handlinger…"
      emptyText="Ingen resultater"
      closeLabel="Luk"
      title="Kommandopalet"
      onNavigate={(href) => { location.hash = href; setLast(href); }}
    >
      <Page last={last} />
    </CommandPaletteProvider>
  );
}

function Page({ last }: { last: string }) {
  const palette = useCommandPalette();
  return (
    <main class="ex-page">
      <h1>Kommandopalet</h1>
      <p>Tryk ⌘K / Ctrl+K, eller brug knappen.</p>
      <button type="button" data-testid="cmdk-example-open" onClick={() => palette.open()}>Åbn palet</button>
      <p>Sidst valgt: <strong data-testid="cmdk-example-last">{last}</strong></p>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
