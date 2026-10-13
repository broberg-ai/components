# F101 — @broberg/editor (TipTap)

## Motivation
Ejeren 13/10: «byg en @broberg/editor som alle kan anvende baseret på TipTap». Første forbruger er vn-leker (#3227): B2B-butikkens admin skal selv skrive nyheder — overskrift, brødtekst (fed/kursiv/links/lister), billeder fra R2 og et vare-element — én tekst pr. sprog (NO/DK/SE), renderet på serveren. Discovery har ingen editor (tjekket 13/10). cardmem har en håndrullet contentEditable-editor (Preact, markdown) uden billeder; håndrullede editorer bryder typisk sammen ved markør omkring billeder/indlejrede blokke, kopiér/indsæt og fortryd. Derfor TipTap/ProseMirror som motor.

## Scope
1. **Kerne (framework-fri)** `@broberg/editor`: `createEditor({ element, content, onChange, uploadImage, blocks, placeholder })` på `@tiptap/core` + StarterKit (overskrifter, fed, kursiv, lister, citat, kode, fortryd) + Link + Image. Hovedløs værktøjslinje-tilstand: `toolbarState(editor)` (hvad er aktivt / muligt) + kommandoer.
2. **Dokumentformat**: TipTap-JSON er det der gemmes (tabsfrit, også for egne blokke). `toMarkdown(doc)` / `fromMarkdown(md)` til dem der vil have markdown (cardmem). Markdown kan ikke bære egne blokke uden tab — står i README.
3. **Server-rendering** `@broberg/editor/server`: `renderHTML(doc, { blocks })` uden browser (Node/Bun), sikker output (kun skemaets elementer, links får rel=noopener).
4. **Billeder**: `uploadImage(file) => Promise<{ src, alt? }>` er forbrugerens (R2 osv.). Indsæt via kommando, indsæt/træk-slip af fil.
5. **Egne blokke** `defineBlock({ name, attrs, renderHTML, label })`: et atomart element med attributter (fx `product { sku }`) — forbrugeren bestemmer hvordan det ser ud i editoren og på serveren. Generelt, ikke vn-leker-specifikt.
6. **Adaptere**: `/react` (`useEditor`, `<EditorContent>`) og `/preact` (samme API). Reference-værktøjslinje (valgfri) på `@broberg/theme`-tokens med data-testid og custom link-popover.
7. **Eksempel-app** `examples/editor` (Lens-drevet) + udgivelse v0.1.0 + Discovery-række + release-rapport til vn-leker og cardmem.

## Non-goals
- Samarbejde i realtid (kan senere kobles på @broberg/livesync via TipTaps Yjs-udvidelse).
- TipTap Pro/Cloud-udvidelser (betalt, hostet).
- Sprog-håndtering i pakken: ét dokument pr. sprog er forbrugerens model.
- Flytning af cardmems editor (cardmems egen beslutning bagefter).

## Arkitektur-skitse
```
@broberg/editor          createEditor, toolbarState, defineBlock, toMarkdown/fromMarkdown, schema-udvidelser
@broberg/editor/server   renderHTML(doc) — @tiptap/html (generateHTML) med samme udvidelser, ingen DOM
@broberg/editor/react    useEditor + EditorContent + Toolbar (reference)
@broberg/editor/preact   samme API for Preact
@broberg/editor/css      basis-typografi på theme-tokens (valgfri)
```
TipTap-pakker som dependencies (eksakt pinnet til samme version, 3.32.0 målt 13/10), React/Preact som valgfri peers.

## Afhængigheder
- `@broberg/theme` (tokens) for reference-UI.
- Første npm-udgivelse kræver lokal bootstrap med Christians OTP (CLAUDE.md «npm publish — bootstrap»), derefter Trusted Publisher.

## Reuse
Discovery/roster tjekket 13/10 for editor, rich-text, wysiwyg, tiptap, prosemirror: intet. cardmems `rich-text.tsx` er ikke en pakke og har ingen billeder — dens markdown-konvertering er inspiration, ikke genbrug. Valgt at bygge på TipTap (ejerens beslutning) frem for at løfte cardmems motor.

## Rollout
1. Kerne + server + egne blokke med tests (uden browser hvor muligt; happy-dom for editor-tests).
2. Adaptere + eksempel-app + Lens-flow (skriv, formater, link via popover, billede via upload-hook, vare-blok, gem → genindlæs → samme indhold).
3. v0.1.0 bootstrap-udgivelse (OTP), Discovery-række, release-rapport til vn-leker og cardmem.
