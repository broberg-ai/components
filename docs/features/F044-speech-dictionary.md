# F044 — @broberg/speech-dictionary: fleet STT vocabulary + correction primitive

**Status:** in progress — v0.1.0 built + tested this turn; publish is bootstrap-gated on Christian's npm login+OTP (same recipe as F013/F024/F023.1).
**Owner:** `components` (publishes the npm + curates the canonical term list).
**Lifted from:** `/Users/cb/Apps/cbroberg/openai-whisper-docker/ordbog.txt` — a loose, 70-entry Danish/English dev-jargon correction list used only by whisper-docker's own proofreading scripts today (55 real corrections once identity rows are dropped).
**Requested by:** trail (#15400, relaying cardmem #15399/#15392); design refined by cardmem (#15401/#15403) as the second real consumer, after cardmem discovered it had started building an equivalent in a stray local folder and redirected the work here instead.
**End-state (Christian):** one shared, versioned vocabulary + correction table any STT/voice feature in the fleet can pull in — for WhisperKit-style prompt-biasing *before* transcription and for text fixup *after* transcription — instead of every repo hand-rolling its own term list that drifts.

## Motivation
Whisper-family STT mishears fleet-specific proper nouns and Danish/English dev-jargon in predictable, recurring ways ("WhisperKit" → "vise på kit", "kommitte" → "committe", "kloster" → "cluster", "søver" → "server"). Two real, independent consumers need the exact same fix at the same time:

1. **Trail's ambient-STT engine (F201.6)** — on-device WhisperKit transcription in the Bun/TS engine, corrected before distill. Its Swift app doesn't import the npm directly — correction happens in the Bun/TS engine layer, but WhisperKit's own on-device model wants the raw vocabulary data bundleable without a JS runtime in the loop.
2. **cardmem's interview module (F185)** — also Whisper-based transcription, JS/TS-side consumer.

Two real consumers hitting the same problem simultaneously is exactly the fleet's established "right time to extract" bar (same reasoning as `@broberg/forms-turnstile` and `@broberg/mail-core` earlier this cycle).

## Scope (in)
1. **Two separate seed datasets, not one blended list** (revised from the original single-`ENTRIES` design after cardmem's input — proper nouns and dev-jargon mishears are conceptually different and grouped differently):
   - **`data/corrections.json`** — parsed verbatim from ordbog.txt (`wrong -> right (note)`), identity rows dropped → **55 entries**, each `{wrong, right, note?, category?}`. Pure dev-jargon; ordbog.txt contains no proper nouns.
   - **`data/terms.json`** — **40 fleet proper nouns**, authored by cardmem, grouped `product | person | brand | tech` (e.g. cardmem/buddy/Trail under `product`, Christian Broberg under `person`, broberg.ai/WebHouse under `brand`, WhisperKit/Fly.io/Hono under `tech`). Used for prompt-biasing, not correction.
2. **Cross-stack shipping (revised — Swift DOES need direct access, per cardmem):** both JSON files ship as **raw files** in the npm tarball (`files: ["data", ...]`) so a non-JS consumer (a Swift build step bundling WhisperKit resources) can read `node_modules/@broberg/speech-dictionary/data/*.json` directly with no TS/JS runtime involved, alongside a typed TS/JS wrapper for JS consumers (cardmem F185, Trail's Bun engine).
3. **Public API** (see below) — `terms()` with group filtering, `corrections()`, `toInitialPrompt()` with group filter + `maxTerms` cap (WhisperKit's initialPrompt has a practical token budget — cardmem's requirement) + optional preamble, and `applyCorrections()`.
4. **Unicode-aware whole-word matching (load-bearing fix, not cosmetic).** JS's default `\b` only treats `[A-Za-z0-9_]` as word characters, so `\bsøver\b` silently never matches "søver" in running Danish text — a real correctness bug caught while building this, not a hypothetical. Fixed via `(?<![\p{L}\p{N}_])term(?![\p{L}\p{N}_])` (Unicode letter/number lookaround) instead of `\b`. Longest-wrong-term-first ordering avoids partial-substring corruption (e.g. "komitte" vs "kommitte").
5. **`extend({terms?, corrections?})`** — merge caller-supplied entries at call time, returning a fresh bound `{terms, corrections, toInitialPrompt, applyCorrections}` without mutating the shared base. Hook for a per-repo custom vocabulary (e.g. fd-sundhed's own clinic terms) without forking the base list or waiting on a PR.
6. Ship ESM + CJS + d.ts (tsup), vitest regression tests, single `.` export — mirrors every other small `@broberg/*` package's build in this repo.
7. **Publish v0.1.0 to npm** (bootstrap, Christian's login+OTP).

## Scope (out / follow-ups)
- **No Swift/SwiftPM package.** Raw JSON files are shipped in the npm tarball specifically so a Swift build step can read them without one — a real SwiftPM distribution (mirroring `upmetrics-swift`) is unwarranted until a consumer needs it with zero npm/Node anywhere in its toolchain.
- **No fuzzy/phonetic matching.** `applyCorrections` does exact whole-word (case-insensitive, Unicode-aware) substitution only. Whisper's mishears are consistent enough per-term that a static map is sufficient; a phonetic-distance matcher is unjustified complexity for zero current demand.
- **No self-service edit UI / auto-publish pipeline in v0.1.0.** Christian asked for one (edit the dictionary → save → new npm version, or alternatively a live API instead of npm) — that is real, separate scope (an admin surface + a publish-automation script, or an architecture change), tracked as a follow-up story once the approach is confirmed. See open question below.
- **OIDC trusted-publishing** — set up post-bootstrap by Christian, same as every other package this cycle.

## Open question (2026-07-02, Christian)
Christian asked for an easy edit interface where saving either (a) auto-publishes a new npm version, or (b) the package becomes a thin client to a live API always returning the latest edited dictionary. Recommendation given: **keep npm-as-source-of-truth (option a), not a live API** — the primary use case (Trail's on-device WhisperKit correction) needs the dictionary bundled locally with zero network dependency and no per-transcription latency; a live API would defeat exactly the offline/embeddable requirement cardmem's raw-JSON-files ask was for. The lever for "easy" is automating the *publish*, not eliminating it: since Trusted Publisher already removes the OTP tax, a small edit surface can bump the version, commit, tag-push, and let existing CI publish automatically. Awaiting Christian's confirmation before scoping this as F044.2 with its own plan-doc.

## Architecture
- **Pure, dependency-free, deterministic** — same posture as `@broberg/secret-scan`: regex + string only, no I/O, trivially unit-testable in a Bun engine, a Node script, or a browser bundle alike.
- **Terms and corrections are two independent datasets, not derived from one shared array** — proper nouns (for pre-transcription biasing) and mishears (for post-transcription fixup) don't need to be the same list; conflating them was the v0-draft's design (superseded before publish).
- **`extend()` returns a fresh bound object rather than mutating shared module state** — two consumers calling `extend()` with different custom vocabularies in the same process never interfere with each other.

## Public API
```ts
type TermGroup = "product" | "person" | "brand" | "tech";

interface TermEntry { term: string; group: TermGroup; }
interface CorrectionEntry { wrong: string; right: string; note?: string; category?: string; }

const TERMS: TermEntry[];             // 40 fleet proper nouns, grouped
const CORRECTIONS: CorrectionEntry[]; // 55 dev-jargon mishears, from ordbog.txt

function terms(opts?: { groups?: TermGroup[] }): string[];
function corrections(): CorrectionEntry[];
function toInitialPrompt(opts?: { groups?: TermGroup[]; maxTerms?: number; preamble?: string }): string;
function applyCorrections(text: string): string; // unicode-aware, whole-word, longest-match-first

function extend(opts: { terms?: TermEntry[]; corrections?: CorrectionEntry[] }): {
  terms: (o?: { groups?: TermGroup[] }) => string[];
  corrections: () => CorrectionEntry[];
  toInitialPrompt: (o?: { groups?: TermGroup[]; maxTerms?: number; preamble?: string }) => string;
  applyCorrections: (text: string) => string;
};
```
