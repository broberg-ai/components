# @broberg/ui-controls-core

The **headless logic** behind the estate's native-control replacements — the
custom `<select>`, the date picker, the modal, the toast — that Christian's
"never native dialogs or form controls" rule mandates. Pure TypeScript, zero
JSX, zero deps. The React (`@broberg/ui-controls-react`) and Preact
(`@broberg/ui-controls-preact`) adapters render on top; this owns the parts that
must behave identically across both.

```bash
npm i @broberg/ui-controls-core
```

## Calendar

```ts
import { buildMonthGrid, ymd, parseYmd, isInRange, monthLabel, normalizeYmd } from "@broberg/ui-controls-core";

buildMonthGrid(2026, 7);          // 42 Monday-first cells, padded → [{date,day,inMonth}, …]
monthLabel(2026, 7, "da-DK");     // "juli 2026"  (locale-delegated, no baked-in names)
isInRange("2026-07-04", "2026-07-01", "2026-07-31");   // true

// Typed-input normalisation — disambiguates strictly by the 4-digit year:
normalizeYmd("03-04-2025");       // "2025-04-03"  (3 April, never April-03)
normalizeYmd("2025-04-03");       // "2025-04-03"
normalizeYmd("3.4.2025");         // "2025-04-03"
```

## Select keyboard reducer

```ts
import { selectKeyReducer } from "@broberg/ui-controls-core";

let state = { open: false, highlighted: -1 };
const { state: next, intent } = selectKeyReducer(state, event.key, options.length);
// intent: "open" | "close" | { type: "select", index } | "none"
// ArrowDown/Up wrap; Enter/Space select the highlight (or open); Escape closes.
```

## Outside-click / scroll / resize

```ts
import { makeOutsideClickHandler } from "@broberg/ui-controls-core";

const handle = makeOutsideClickHandler(() => [triggerEl, menuEl], () => setOpen(false));
handle.attach();   // closes on a pointerdown outside all els, or on ancestor scroll / resize
handle.detach();   // (a fixed-position portal would otherwise drift from its trigger)
```

## Toast queue

```ts
import { ToastQueue } from "@broberg/ui-controls-core";

const toasts = new ToastQueue({ maxVisible: 4, defaultDuration: 4000 });
const id = toasts.push({ message: "Saved", kind: "success" });   // auto-dismisses; 0 = sticky
toasts.dismiss(id);
toasts.subscribe((items) => render(items));   // items: { id, message, kind, duration }[]
```

Deterministic (monotonic ids, no `Math.random`/`Date.now`) so it's trivially
testable and SSR-safe. Caps at `maxVisible`, dropping the oldest.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
