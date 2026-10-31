# @broberg/speech-dictionary

Fleet STT vocabulary + correction primitive — a shared dictionary any Whisper-family transcription feature can pull in, instead of every repo hand-rolling its own term list that drifts.

```bash
npm i @broberg/speech-dictionary
```

**Two real consumers today:** Trail's on-device WhisperKit ambient-STT (F201.6) and cardmem's interview module (F185) both mishear the same fleet proper nouns and dev-jargon — this package is seeded from the fleet's real, previously-loose `ordbog.txt` mishear list plus cardmem's authored proper-noun set.

## Two datasets, two jobs

```ts
import { terms, corrections, toInitialPrompt, applyCorrections } from "@broberg/speech-dictionary";

// PRE-transcription: bias WhisperKit's initialPrompt toward fleet proper nouns
toInitialPrompt({ groups: ["product", "tech"], maxTerms: 20 });
// → "cardmem, buddy, Trail, ..., WhisperKit, Fly.io, ..."

// POST-transcription: fix known dev-jargon mishears in the raw transcript
applyCorrections("jeg lavede en kommitte og fixede en bog i søveren");
// → "jeg lavede en committe og fixede en bog i serveren"
```

- **`terms()` / `toInitialPrompt()`** — 40 fleet proper nouns (products, people, brands, tech), grouped so a caller can bias toward just what's relevant (`groups: ["product"]`) and cap the list to fit a model's prompt budget (`maxTerms`).
- **`corrections()` / `applyCorrections()`** — 55 real Danish/English dev-jargon mishears ("kommitte" → "committe", "søver" → "server"), parsed verbatim from the fleet's own `ordbog.txt`.

## Cross-stack: raw JSON, not just a JS API

`data/terms.json` and `data/corrections.json` ship as **raw files in the npm tarball** (not just bundled into `dist/`), so a non-JS consumer — e.g. a Swift build step bundling WhisperKit resources on-device — can read them directly from `node_modules/@broberg/speech-dictionary/data/*.json` with no Node/JS runtime involved. The TS/JS wrapper in this README is for JS/TS consumers (cardmem, Trail's Bun engine); Swift consumers read the JSON directly.

## Unicode-aware correction (why this mattered)

`applyCorrections` does **not** use JavaScript's default `\b` word-boundary — `\b` only treats `[A-Za-z0-9_]` as word characters, so `\bsøver\b` silently never matches "søver" in real Danish text (æ/ø/å fall outside `\b`'s definition of a word character). This package uses a Unicode-letter-aware boundary instead, so Danish terms correct properly. Longest-wrong-term-first ordering avoids one correction partially clobbering another (e.g. "komitte" and "kommitte" both resolve correctly to "committe").

## Six mishearings are also real Danish words (0.2.0, F044.2)

`ruter` → `router` is right in «min ruter er nede» and wrong in «API-ruter», which is the plural
of *rute*. Six entries are like that — `ruter`, `mærke`, `passe`, `bogen`, `kloster`, `dansen` —
and they carry `alsoDanishWord: true`: they **do not fire inside a hyphenated compound**, while a
bare occurrence is still corrected. Every other entry behaves exactly as before.

Every entry in `data/corrections.json` answers the question explicitly (`true`/`false`), and a
test refuses one that does not — so a new mishearing cannot be added without someone asking
«is this also a word?». In your own `extend()` entries the field is optional and absent means
`false` (the old behaviour). `correctionsApplier(list)` applies a list of your own on its own.

**What the decision rests on, and what it does not.** cms measured 628,013 characters of
WRITTEN Danish (four sites, 15 collections): `API-ruter` twice, the other five zero. This package
corrects TRANSCRIPT output, so that corpus says which compounds exist in Danish tech writing and
nothing about what a transcriber emits — and zero in a software corpus is not zero in Danish
(`varemærke-`, `regnskabs-bogen`, `kirke-kloster` would all have fired). The six are flagged
because each is both readings at once, not because the corpus found them.

## Extending with your own vocabulary

```ts
import { extend } from "@broberg/speech-dictionary";

const mine = extend({
  terms: [{ term: "fd-sundhed", group: "product" }],
  corrections: [{ wrong: "fysjo", right: "fysio" }],
});

mine.applyCorrections("fysjo klinik"); // → "fysio klinik"
```

`extend()` returns a fresh bound API layered on top of the fleet base — it never mutates shared state, so concurrent callers with different custom vocabularies don't interfere with each other.
