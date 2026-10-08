# @broberg/data-table

The fleet's data table for Stack B (Vite + Preact + Tailwind + `@broberg/theme`, no shadcn — D-7598d1). Built after shadcn's dashboard table, which Christian asked for as the standard way to show tables in Stack B apps.

**0.3.0 adds drag handles (F094.2).** Pass `onReorder` and every row gets a handle (`data-testid="row-drag-<id>"`) in its own first column, or in the card's top on a phone. Drag with a mouse or a finger, or from the keyboard: Space/Enter lifts, ↑/↓ moves, Space/Enter drops, Escape puts it back, and a live region says each step aloud. `onReorder(ids)` gets **all** row ids in the new order — the table keeps nothing; you save it and pass the rows back. The handles are switched off while the table is sorted or searched (the order on screen is then not the stored one), and say so. Without `onReorder` nothing changes: no column, no handle, same output as 0.2.0. No drag-and-drop library.

**0.2.0 adds the phone layout (F094.3).** Below 768px every row is a card: the first visible column is the card's title, the other visible columns are stacked as label + value, and the checkbox and ⋮ menu sit in the card's top. Search, select-all, «Tilpas kolonner» and the pager work the same over cards. Nothing scrolls sideways. **This changes what a phone renders** compared with 0.1.x (a table before, cards now). Each card has `data-testid="row-card-<id>"`. Sorting has no control on a phone yet (the headers are gone).

```ts
import { DataTable, type Column } from "@broberg/data-table/preact";
import "@broberg/theme/css/palettes.css";
import "@broberg/data-table/css/data-table.css";

const columns: Column<Doc>[] = [
  { id: "title", header: "Titel", sortable: true, hideable: false },
  { id: "type", header: "Type", cell: "badge" },
  { id: "status", header: "Status", cell: "status", statusTone: (v) => (v === "Done" ? "done" : "pending") },
  { id: "target", header: "Mål", cell: "number", sortable: true },
  { id: "reviewer", header: "Ansvarlig", cell: "select", options: [{ value: "eddie", label: "Eddie Lake" }] },
];

<DataTable
  columns={columns}
  rows={docs}
  getRowId={(d) => d.id}
  selectable
  onSelectionChange={(ids) => …}
  onCellChange={(rowId, columnId, value) => save(rowId, columnId, value)}
  rowActions={[{ label: "Rediger", onSelect: edit }, "separator", { label: "Slet", onSelect: remove, destructive: true }]}
  columnStorageKey="docs-table-columns"
/>
```

**See it running:** `examples/data-table` rebuilds shadcn dashboard-01's table (tabs with counts via app-shell `PageTabs`, every cell type, the ⋮ menu) with invented data — `pnpm --filter data-table-example dev`, then open http://localhost:5194 (`PORT` to change). The example supplies the page padding and font itself: in an app those belong to the app, not the table.

## What it does

| | |
|---|---|
| Sort | Click a sortable header: ascending → descending → unsorted. `aria-sort` on the header. Danish text order (Æ Ø Å last), numbers numerically, empty values last in both directions. |
| Search | One box, case-insensitive, across every visible text-like column. A select cell is searched by its **label**, not its stored value. |
| Pages | Rows per page (custom dropdown, default 10/20/30/40/50), «Side x af y», first/previous/next/last disabled at the edges. A search always lands on page 1. |
| Selection | Checkbox per row; select-all in the header selects **the current page** and shows the indeterminate state when some are selected. «x af y rækker valgt» counts the filtered rows. `onSelectionChange(ids)`. |
| Columns | «Tilpas kolonner» toggles columns (stays open for several toggles). With `columnStorageKey` the choice is remembered in localStorage; without it nothing is written. `hideable: false` keeps a column out of the menu. |
| Reorder | `onReorder(ids)` adds a drag handle per row: pointer (mouse + touch) and keyboard, live-region announcements, off while sorted or searched. `moveRow(items, from, to)` is the pure core. |
| Row menu | ⋮ per row with your actions, `"separator"` and `destructive: true` (red). The action receives the row. |
| Cells | `text` (default), `badge`, `status` (icon by `statusTone`: done / progress / pending / error), `number` (right-aligned, tabular figures, Danish formatting), `select` (custom dropdown with a tick on the current value → `onCellChange`, only when the value actually changes), or a function returning your own markup. |

**The app owns the data.** The table never writes anything back; it calls `onCellChange`, `onSelectionChange` and your row actions, and renders the rows you pass.

## Rules it follows

- **No native `select`, `dialog` or `option`** (D-4cd764). Every dropdown is a button plus a menu/listbox: arrows move, Enter or Space chooses, Escape closes, a click outside closes.
- **Every interactive element has a `data-testid`** under one prefix (`testId`, default `data-table`): `-search`, `-columns`, `-columns-<col>`, `-sort-<col>`, `-header-<col>`, `-select-all`, `-select-<row>`, `-row-<row>`, `-cell-<row>-<col>` (select trigger), `-cell-<row>-<col>-option-<value>`, `-actions-<row>`, `-actions-<row>-<n>`, `-live` (reorder announcements), `row-drag-<row>` (unprefixed, like `row-card-<row>`), `-page-size`, `-page-size-<n>`, `-page-first|prev|next|last`, `-page-label`, `-selected-label`, `-empty`.
- **Colours are theme tokens only**; the CSS contains no colour literal (a test enforces it).
- **Labels are Danish by default**; pass `labels` to override any of them.

## The core, without Preact

`@broberg/data-table` exports the operations as pure functions: `nextSort`, `sortRows`, `compareValues`, `filterRows`, `paginate`, `selectionState`, `toggleAll`, `toggleOne`, `moveRow`, `loadHiddenColumns`, `saveHiddenColumns`. A storage that throws (private window, blocked site data) reads as «nothing saved» and never crashes the table.
