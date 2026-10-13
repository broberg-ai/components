# F101 — @broberg/editor (TipTap)

## Motivation
Ejeren 13/10: «byg en @broberg/editor som alle kan anvende baseret på TipTap». Første forbruger er vn-leker (#3227): B2B-butikkens admin skal selv skrive nyheder — overskrift, brødtekst (fed/kursiv/links/lister), billeder fra R2 og et vare-element — én tekst pr. sprog (NO/DK/SE), renderet på serveren. Discovery har ingen editor (tjekket 13/10). cardmem har en håndrullet contentEditable-editor (Preact, markdown) uden billeder; håndrullede editorer bryder typisk sammen ved markør omkring billeder/indlejrede blokke, kopiér/indsæt og fortryd. Derfor TipTap/ProseMirror som motor.

## Scope
1. **Kerne (framework-fri)** `@broberg/editor`: `createEditor({ element, content, onChange, uploadImage, placeholder })` på `@tiptap/core` + StarterKit (overskrifter, fed, kursiv, lister, citat, kode, link, fortryd) + Image. Hovedløs værktøjslinje-tilstand: `toolbarState(editor)` + `run(editor, action)`.
2. **Dokumentformat: MARKDOWN** er det der gemmes (ændret 13/10 efter vn-leker #3229 og cms #3230: «vælg ét format og hold det»; cardmem gemmer også markdown). `fromMarkdown`/`toMarkdown` til JSON når nogen har brug for træet. Konsekvens: hver egen blok (F101.2) SKAL have en markdown-serializer, ellers forsvinder den tavst ved gem — det testes.
3. **Server-rendering** `@broberg/editor/server`: `renderHTML(markdown, { extensions })` uden browser (Node/Bun), sikker output bygget fra dokument-træet (kun skemaets elementer, escapet tekst, http(s)/mailto/relative adresser, links får rel=noopener).
4. **Billeder**: `uploadImage(file) => Promise<{ src, alt? }>` er forbrugerens (R2 via @broberg/media osv.). Indsæt via kommando, indsæt/træk-slip af fil. Aldrig en blob:-URL i dokumentet; en fejlet upload efterlader det uændret.
5. **Egne blokke** `defineBlock({ name, attrs, renderHTML, label })`: et atomart element med attributter (fx `product { sku }`) — forbrugeren bestemmer hvordan det ser ud i editoren og på serveren, og blokken har sin egen markdown-form. Generelt, ikke vn-leker-specifikt.
6. **Adaptere**: `/react` (`useEditor` med immediatelyRender:false til SSR, `<EditorContent>`) og `/preact` (samme API). Reference-værktøjslinje (valgfri) på `@broberg/theme`-tokens med data-testid og custom link-popover.
7. **Eksempel-app** `examples/editor` (Lens-drevet) + udgivelse v0.1.0 + Discovery-række + release-rapport til vn-leker og cardmem.

## cms' drifts-fælder (#3230) — hver er en test
1. immediatelyRender:false i React/SSR. 2. Værktøjslinje via editor-state-selector, ikke re-render pr. tastetryk. 3. Ingen falsk «ændret» ved load (også når TipTap selv tilføjer et tomt afsnit efter et billede). 4. Remount pr. dokument. 5. Word/Google Docs-paste renses. 6. Markdown-serializer pr. egen node. 7. Ingen blob:-URL i det gemte.

## Non-goals
- Samarbejde i realtid (kan senere kobles på @broberg/livesync via TipTaps Yjs-udvidelse).
- TipTap Pro/Cloud-udvidelser (betalt, hostet).
- Sprog-håndtering i pakken: ét dokument pr. sprog er forbrugerens model.
- AI-funktioner (vn-leker har valgt AI fra).
- Flytning af cardmems editor (cardmems egen beslutning bagefter).

## Arkitektur-skitse
```
@broberg/editor          createEditor, editorOptions, toolbarState, run, setLink, insertImage, setMarkdown, getMarkdown, fromMarkdown/toMarkdown
@broberg/editor/server   renderHTML(markdown) — eget træ-baseret renderer (hvidliste, escaping, sikre URL'er), ingen DOM
@broberg/editor/react    useEditor + EditorContent + Toolbar (reference)
@broberg/editor/preact   samme API for Preact
```
TipTap-pakker som dependencies (eksakt pinnet til samme version, 3.32.0 målt 13/10), React/Preact som valgfri peers.

## Afhængigheder
- `@broberg/theme` (tokens) for reference-UI.
- 0.0.1-pladsholder udgivet 13/10 (Christians OTP) og Trusted Publisher sat op samme dag — 0.1.0 udgives via publish.yml (tag editor-v0.1.0).

## Reuse
Discovery/roster tjekket 13/10 for editor, rich-text, wysiwyg, tiptap, prosemirror: intet. cardmems `rich-text.tsx` er ikke en pakke og har ingen billeder — dens testtilfælde (caret, lister, iOS-zoom) er inspiration. Valgt at bygge på TipTap (ejerens beslutning) frem for at løfte cardmems motor.

## Rollout
1. Kerne + server (F101.1, committet 13f359d, 16 tests) → egne blokke (F101.2).
2. Adaptere + eksempel-app + Lens-flow (skriv, formater, link via popover, billede via upload-hook, vare-blok, gem → genindlæs → samme indhold).
3. v0.1.0 via publish.yml, Discovery-række, release-rapport til vn-leker og cardmem.
