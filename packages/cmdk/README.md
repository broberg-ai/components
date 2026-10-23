# @broberg/cmdk

The **headless core** for a Cmd+K command palette — the fuzzy filter, the
wrap-around keyboard navigation, the recents store — extracted once from the six
repos that each hand-rolled it. **Items are always consumer-defined** (they churn
too fast to bake in); this owns the interaction logic, framework-free. The
React / Preact overlay shells build on top.

```bash
npm i @broberg/cmdk
```

## Usage

```ts
import { createPaletteController, createRecentsStore } from "@broberg/cmdk";

const controller = createPaletteController({
  items: [
    { id: "new-doc", label: "New document", keywords: ["create", "page"], action: () => router.push("/new") },
    { id: "settings", label: "Open settings", group: "Navigation", action: () => router.push("/settings") },
  ],
  recentsStore: createRecentsStore("acme-cmdk-recents", 5),
});

controller.open();
controller.setQuery("set");        // → results filtered + ranked, activeIndex reset
controller.moveDown();             // wrap-around keyboard nav
controller.selectActive();         // runs the item's action(), records a recent, closes

const off = controller.subscribe((state) => render(state));  // { open, query, results, activeIndex }
```

## Pieces

- **`fuzzyFilter(items, query, { limit? })`** — ranked subsequence match over
  `label` + `keywords` (contiguous-run, prefix and word-boundary bonuses). Empty
  query returns everything in original order. Pure, no side effects.
- **`createPaletteController({ items, recentsStore?, limit? })`** — the state
  machine: `open/close/toggle`, `setQuery`, `moveUp/moveDown` (wrap at both ends),
  `setActiveIndex(i)`, `selectActive` / `select(item)` (runs `action()`, records a recent, closes),
  `setItems`, `recents()`, `subscribe`, `getState`.
- **`createRecentsStore(key, max?, storage?)`** — most-recent-first list of item
  ids in localStorage: deduped, capped, and **quota-safe** (a throwing `setItem`
  is swallowed). Falls back to memory when there's no usable storage.

## Preact shell — `@broberg/cmdk/preact` (0.2.0)

```tsx
import "@broberg/theme/css/palettes.css";
import "@broberg/cmdk/css/cmdk.css";
import { CommandPaletteProvider, useCommandPalette } from "@broberg/cmdk/preact";

<CommandPaletteProvider
  items={items}                              // PaletteItem[] — yours, always
  placeholder="Søg…" emptyText="Ingen resultater" closeLabel="Luk" title="Kommandopalet"
  onNavigate={(href) => route(href)}         // for items with href; default location.assign
>
  <App />
</CommandPaletteProvider>

const palette = useCommandPalette(); palette.open();   // open from a button
```

- **Cmd+K and Ctrl+K** toggle (browser default suppressed); `shortcut={false}` turns it off.
- **Controlled** with `open` / `onOpenChange`, or let it own its state.
- Already have a controller? `<CommandPalette controller={c} />` + `useCommandPaletteShortcut(c)`.
- Rows are **grouped by `item.group`** (first appearance), arrows walk the
  visual order and wrap, Enter activates, Escape / backdrop / × close and focus
  returns to the opener. Focus lands in the input last (after the opener's own
  focus handling); the page scroll is locked while open.
- `item.action()` runs first; `item.href` goes to `onNavigate`. `item.icon`
  (string or VNode) or `renderIcon(item)`; `item.sublabel` shows on the right.
- **a11y:** input is `role=combobox` with `aria-activedescendant`; list is
  `role=listbox`, rows `role=option`.
- **testids:** `command-palette-root`, `-backdrop`, `-search-input`, `-close`,
  `-empty`, `-item-<id>`.
- **Styling:** classes `bcmdk-*` on @broberg/theme tokens; restyle by
  overriding `--bcmdk-width`, `--bcmdk-top`, `--bcmdk-radius`,
  `--bcmdk-backdrop`, `--bcmdk-shadow` or the classes. No horizontal scroll at 393 px.
- Imports only `preact` + `preact/hooks` (no router). Demo: `examples/cmdk` (:5197).

## Why items stay yours

Every consumer's items differ wildly (permission-gated nav, entity search,
context switches) and change constantly. `item.action()` is the router-agnostic
escape hatch, so this core never dictates navigation or bakes a fixed command
set. The `@broberg/cmdk/react` and `@broberg/cmdk/preact` shells (with the
backdrop, input, grouped rows and `data-testid` anchors) render whatever items
you pass.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
