// F094.4 — shadcn dashboard-01's table, rebuilt on @broberg/data-table inside
// @broberg/app-shell, with invented data. Run: pnpm --filter data-table-example dev
import "@broberg/theme/css/palettes.css";
import "@broberg/app-shell/css/app-shell.css";
import "@broberg/data-table/css/data-table.css";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { initPalette, initTheme } from "@broberg/theme";
import { AppShell, PageTabs } from "@broberg/app-shell/preact";
import { DataTable, type Column } from "@broberg/data-table/preact";

initTheme();
initPalette();

interface Section {
  id: string;
  header: string;
  type: string;
  status: "Done" | "In Process" | "Not Started";
  target: number;
  limit: number;
  reviewer: string;
  tab: "outline" | "performance" | "personnel" | "focus";
}

const TYPES = ["Cover page", "Table of contents", "Narrative", "Technical content", "Plain language", "Legal", "Visual", "Financial", "Research", "Planning"];
const HEADERS = [
  "Cover page", "Table of contents", "Executive summary", "Technical approach", "Design", "Capabilities",
  "Integration with existing systems", "Innovation and advantages", "Overview of EMR's innovative solutions",
  "Advanced algorithms and machine learning", "Adaptive communication protocols", "Advantages over current technologies",
  "Past performance", "Customer feedback and satisfaction levels", "Implementation challenges and solutions",
  "Security measures and data protection policies", "Scalability and future-proofing", "Cost-benefit analysis",
  "User training and onboarding experience", "Future development roadmap", "System architecture overview",
  "Risk management plan", "Compliance documentation", "Project timeline", "Team structure and roles",
];
const STATUSES: Section["status"][] = ["Done", "In Process", "Not Started"];
const REVIEWERS = [
  { value: "eddie", label: "Eddie Lake" },
  { value: "jamik", label: "Jamik Tashpulatov" },
  { value: "emily", label: "Emily Whalen" },
  { value: "", label: "Assign reviewer" },
];
const TABS: Section["tab"][] = ["outline", "outline", "performance", "personnel", "outline", "focus"];

const initial: Section[] = HEADERS.map((header, i) => ({
  id: String(i + 1),
  header,
  type: TYPES[i % TYPES.length],
  status: STATUSES[i % 3],
  target: 10 + ((i * 7) % 30),
  limit: 5 + ((i * 11) % 25),
  reviewer: REVIEWERS[i % REVIEWERS.length].value,
  tab: TABS[i % TABS.length],
}));

const columns: Column<Section>[] = [
  { id: "header", header: "Header", sortable: true, hideable: false },
  { id: "type", header: "Section type", cell: "badge" },
  { id: "status", header: "Status", cell: "status", statusTone: (v) => (v === "Done" ? "done" : v === "In Process" ? "progress" : "pending") },
  { id: "target", header: "Target", cell: "number", sortable: true },
  { id: "limit", header: "Limit", cell: "number", sortable: true },
  { id: "reviewer", header: "Reviewer", cell: "select", options: REVIEWERS },
];

function App() {
  const [url, setUrl] = useState(location.pathname + location.search);
  const [rows, setRows] = useState(initial);
  useEffect(() => {
    const onPop = () => setUrl(location.pathname + location.search);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const navigate = (href: string) => {
    history.pushState(null, "", href);
    setUrl(href);
  };
  const tab = (new URLSearchParams(url.split("?")[1] ?? "").get("tab") ?? "outline") as Section["tab"];
  const count = (t: Section["tab"]) => rows.filter((r) => r.tab === t).length;
  const label = (text: string, t: Section["tab"]) => (t === "outline" ? text : <>{text} <span class="ex-count">{count(t)}</span></>);

  return (
    <AppShell
      brand={<strong>Acme Inc.</strong>}
      groups={[{ label: "Home", items: [{ id: "dashboard", label: "Dashboard", href: "/" }] }]}
      currentPath="/"
      onNavigate={navigate}
      user={{ name: "Example User", email: "user@example.com" }}
      userMenu={{ accountHref: "#", onSignOut: () => {} }}
      title="Documents"
      lang="da"
    >
      <PageTabs
        currentUrl={url}
        onNavigate={navigate}
        tabs={[
          { id: "outline", label: label("Outline", "outline") },
          { id: "performance", label: label("Past Performance", "performance") },
          { id: "personnel", label: label("Key Personnel", "personnel") },
          { id: "focus", label: label("Focus Documents", "focus") },
        ]}
      />
      <div class="ex-page">
      <DataTable
        key={tab}
        columns={columns}
        rows={rows.filter((r) => r.tab === tab)}
        getRowId={(r) => r.id}
        selectable
        onCellChange={(rowId, columnId, value) =>
          setRows((all) => all.map((r) => (r.id === rowId ? { ...r, [columnId]: value } : r)))
        }
        rowActions={[
          { label: "Edit", onSelect: () => {} },
          { label: "Make a copy", onSelect: (r) => setRows((all) => [...all, { ...r, id: String(all.length + 1) }]) },
          "separator",
          { label: "Delete", onSelect: (r) => setRows((all) => all.filter((x) => x.id !== r.id)), destructive: true },
        ]}
        onReorder={(ids) =>
          setRows((all) => {
            // The table reorders this tab's rows; the other tabs keep their places.
            const byId = new Map(all.map((r) => [r.id, r]));
            const moved = ids.map((id) => byId.get(id)!);
            let i = 0;
            return all.map((r) => (r.tab === tab ? moved[i++] : r));
          })
        }
        columnStorageKey="example-data-table-columns"
      />
      </div>
    </AppShell>
  );
}

render(<App />, document.getElementById("app")!);
