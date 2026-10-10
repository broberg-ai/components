# @broberg/settings

The fleet's settings surface for **Stack B (Preact)**: one Save button that knows
whether anything is unsaved, and the Card / Field / Input / Toggle primitives every
settings page already draws by hand. Styled on `@broberg/theme` tokens. The tabs
come from `@broberg/app-shell` (`PageTabs`), not from here.

```bash
npm i @broberg/settings @broberg/theme preact
```

```ts
import "@broberg/theme/css/palettes.css";
import "@broberg/settings/css/settings.css";
import { SettingsCard, SettingsField, SettingsInput, SettingsToggle, SettingsSaveButton, useSaveHandler } from "@broberg/settings/preact";
import { PageHeader, PageTabs } from "@broberg/app-shell/preact";

function General({ initial }) {
  const [name, setName] = useState(initial.name);
  const [maintenance, setMaintenance] = useState(initial.maintenance);
  // Your part of Save. Throw (or a rejected fetch) fails the save: the form stays unsaved.
  useSaveHandler(async () => {
    const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify({ name, maintenance }) });
    if (!res.ok) throw new Error(`save failed: ${res.status}`);
  });
  return (
    <SettingsCard title="Generelt" testid="settings-panel-general">
      <SettingsField label="Appnavn" htmlFor="app-name">
        <SettingsInput id="app-name" testid="settings-app-name" value={name} onValue={setName} />
      </SettingsField>
      <SettingsField label="Vedligehold">
        <SettingsToggle checked={maintenance} onToggle={setMaintenance} label="Vedligehold" testid="settings-maintenance" />
      </SettingsField>
    </SettingsCard>
  );
}

// The page: one Save button in the header, tabs as addresses (?tab=, survive a reload).
<PageHeader title="Indstillinger" actions={<SettingsSaveButton />} />
<PageTabs tabs={[{ id: "general", label: "Generelt" }, { id: "team", label: "Team" }]} currentUrl={url} onNavigate={navigate} />
```

A full working page — tabs, two panels, a server that really stores — is in
[`examples/settings`](../../examples/settings) (`pnpm --filter settings-example dev`).

## What the Save button says

| state | label (da / en) | button |
|---|---|---|
| nothing changed | Gem / Save | dimmed, disabled |
| something changed | Ikke gemt · Gem / Unsaved · Save | active |
| saving | Gemmer… / Saving… | spinner, disabled |
| every panel saved | Gemt / Saved (2 s) | disabled |
| a panel failed | Kunne ikke gemme · Gem / Could not save · Save | active — the form is still unsaved |

**"Gemt" is only said when every panel actually saved.** Save runs every panel's
handler and waits for all of them; one that throws or rejects keeps the form
unsaved and shows the failure. (cms's version reset its button after a fixed 5 s,
saved or not.) The button carries `data-status` (`clean|dirty|saving|saved|failed`)
for Lens and tests.

## The pieces

| from `@broberg/settings/preact` | what |
|---|---|
| `SettingsCard` | a card; `title` + `description` render a `SectionHeading` |
| `SectionHeading` | a section title and description |
| `SettingsField` | one row: 180px label column beside the control, stacked under 640px |
| `SettingsInput` | text / email / url / password / number field; marks the form unsaved on every edit; `copy` adds a copy button (`<testid>-copy`) |
| `SettingsToggle` | an on/off switch — a `<button role="switch">`, never a native checkbox |
| `SettingsSaveButton` | the one Save button (`lang="da" \| "en"`) |
| `useSaveHandler(fn)` | a panel's part of Save |
| `useDirtyBus()` | `{ dirty, saving, error }`, re-rendering on change |
| `useStored(key, fallback)` | a per-user display preference in localStorage; silent fallback when storage is blocked. Not for settings that belong on the server |

Every interactive element takes a `testid` (F086).

From `@broberg/settings` (no framework, loads in Node/Bun/workers):
`markDirty`, `markSaved`, `requestSave`, `onDirtyBus`, `createDirtyBus` (a second,
independent form on the same page), `generateSecret(bytes = 32)` → hex,
`copyToClipboard(text, { onReset, resetMs = 1500 })` → `true`/`false`, never throws.

## Tokens it reads

All from `@broberg/theme`'s `palettes.css`; no colour is written as a literal:
`--bg-card --bg-sunk --border --border-strong --fg --fg-muted --hover --active
--accent --olive-btn --paper --danger --success --radius`.

## Not here (yet)

- **React / Next (Stack A)** — F017.2.
- **Tabs** — use `@broberg/app-shell`'s `PageTabs` (F017.5).

MIT · part of the [`@broberg/*`](https://github.com/broberg-ai/components) shared-library family.
