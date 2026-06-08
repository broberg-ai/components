# F028 — Podcast Manager / Maker

> L3 Domain · scaffold · effort **L** · impact **medium** · owner `cms` (implements F05 first; ai-sdk owns the AI half). Status: Backlog.
> Graduate-candidate: YES — should get its own repo + cardmem project (recommendation, confirm with Christian).

## Motivation
A scaffold covering the full podcast lifecycle: episode data model (title, audioFile, duration, date, tags, transcript, chapters, guests, show metadata), a read-only public listener UI (episode list + detail + custom audio player + transcript), an RSS feed generator compatible with Apple Podcasts + Spotify (itunes:* + enclosure tags), and an AI generation path (manuscript turns + ElevenLabs Text-to-Dialogue via @broberg/ai-sdk ai.podcast() → finished multi-voice MP3). The two halves — public listener surface + AI maker pipeline — are separable: a site can adopt just the listener UI, or use only the generation pipeline.

## Solution
**scaffold.** The listener UI is a whole-app surface wired to Next routing + @webhouse/cms collection config + Tailwind — not a small widget. The RSS generator is framework-agnostic TS but only CMS F05 owns/evolves it. The AI generation path already lives in @broberg/ai-sdk (ai.podcast/ai.tts/elevenlabsAdapter, shipped). None of the three sub-surfaces are identical across 3+ repos today, and the stack only makes sense composed as a starting point → scaffold (copy-owned per repo, each owns its evolution).

## Scope

### In scope
- Source design: `webhouse/cms` `docs/features/F05-podcast-engine.md`.
- Headless core (types + generatePodcastRss + formatDuration) + Stack A listener UI + RSS route + AI generation wiring + Whisper transcription.

### Out of scope
- Per-brand listener styling (scaffold, copy-owned).
- Reimplementing the AI half (lives in @broberg/ai-sdk).

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `docs/features/F05-podcast-engine.md`: the only full end-to-end design — show + episode CollectionConfig (episodeNumber, season, chapters, guests, explicit, episodeType), generatePodcastRss (Apple/Spotify XML with itunes:* + enclosure), PodcastAgent (Whisper transcription + summary + chapter extraction), admin page, audio upload API extension. Canonical design (not yet shipped).

### Other implementations seen
- `cbroberg/sproutlake-site` `src/app/podcasts/{page,[slug]/page}.tsx` + `cms.config.ts` — only LIVE deployed listener UI; confirms the real field set; native <audio controls> + transcript via renderMarkdown + tag chips; no RSS/upload/management. (sproutlake + sproutlake-site identical here.)
- `broberg/ai-sdk` `src/providers/elevenlabs.ts` + `schema/inputs.ts` + `client.ts` + `capabilities/transcribe.ts` — shipped AI half: elevenlabsAdapter (dialogue+tts+listVoices, ELEVENLABS_DANISH_VOICES), podcastInputSchema, ai.podcast()/ai.tts(), Whisper transcribe. The headless engine the scaffold CALLS, not reimplements.
- `broberg/trail` `packages/pipelines/src/audio/pipeline.ts` — Whisper transcription pipeline (accepts()/handle(), cost model) — the ingest side.

### Headless core vs. adapters
- **Core (no React/next):** types.ts (PodcastShow + PodcastEpisode with episodeNumber/season/chapters/guests/episodeType/publishedAt); rss.ts (generatePodcastRss(show, episodes, baseUrl) → Apple/Spotify RSS with itunes:* namespace + channel/item enclosure + itunes:duration/episode/season/episodeType); format.ts (formatDuration HH:MM:SS / human, parseDuration).
- **Stack A (Next/React/shadcn):** podcasts/page.tsx (list RSC), [slug]/page.tsx (detail + custom player + transcript), feed.xml/route.ts (calls generatePodcastRss), podcast-player.tsx (custom player, no native <audio controls>), lib/podcasts.ts (getEpisodes over @webhouse/cms); generateStaticParams ISR + Metadata SEO.
- **Stack B (Bun/Hono/Preact):** Hono GET /podcasts + /:slug + /feed.xml (generatePodcastRss, application/rss+xml); Preact islands EpisodeList/Detail/PodcastPlayer (signals); storage adapter injected (bun:sqlite/Drizzle or filesystem JSON), not @webhouse/cms.

### Public API
```ts
export type { PodcastShow, PodcastEpisode, PodcastChapter };
export { generatePodcastRss } from './rss'; export { formatDuration, parseDuration } from './format';
// Stack A adapter copied into consumer (not runtime import). AI generation = import { createAI } from '@broberg/ai-sdk'; const ep = await ai.podcast({ script, voices });
```

## Stories
- **F028.1** — Headless podcast types + RSS generator — _AC:_ types.ts (PodcastShow/Episode all F05 fields incl. episodeNumber/season/chapters/episodeType); generatePodcastRss(show, episodes, baseUrl) passes W3C RSS 2.0 validation + includes itunes:* + enclosure type+length + itunes:duration/episode/season/episodeType; formatDuration(180)='00:03:00'; zero framework imports; tests green.
- **F028.2** — Stack A listener UI: list + detail pages — _AC:_ podcasts/page.tsx lists published episodes from @webhouse/cms getCollection('podcasts') (title/description/duration/date/tag chips); [slug]/page.tsx detail + custom PodcastPlayer (play/pause :active/:hover, seek, speed, loading — no native <audio controls>); generateStaticParams pre-renders slugs; data-testid on all controls; Lens smoke.
- **F028.3** — RSS feed route — _AC:_ GET /podcasts/feed.xml → application/rss+xml + valid RSS 2.0 with all published episodes; Apple Podcasts Connect feed validator accepts it; calls generatePodcastRss; base URL from NEXT_PUBLIC_SITE_URL (no hardcode).
- **F028.4** — AI episode generation wiring — _AC:_ a server action accepts a manuscript [{speaker,text}] + voices map, calls ai.podcast() from @broberg/ai-sdk, stores audio bytes to the CMS storage adapter, creates a draft PodcastEpisode with audio URL; admin 'Generate Episode' form with speaker-turn editor + voice picker (ELEVENLABS_DANISH_VOICES); draft appears in the list; requires ELEVENLABS_API_KEY.
- **F028.5** — Whisper transcription on upload — _AC:_ uploading .mp3/.m4a/.wav triggers ai.transcribe() (Whisper via @broberg/ai-sdk); transcript saved to the episode; duration from verbose_json fills durationSeconds; cost logged via ai-sdk costSink; graceful no-crash fallback when OPENAI_API_KEY absent.
- **F028.6** — Scaffold extraction into @broberg/components — _AC:_ components/src/podcast/ with headless core (types/rss/format) + adapters/next/ scaffold templates; a generate script (or documented copy) produces a working Stack A podcast section in <10 min; sproutlake-site migrates its pages to the scaffold output + all episodes render; Lens baseline green.

## Acceptance criteria
1. @broberg/podcast builds + typechecks clean; headless core imports no framework packages.
2. Each story (F028.1–F028.6) meets its own AC.
3. Piloted in cms (after F05 ships) + sproutlake-site, adopted back with no regression (Lens / runtime-verified).
4. A second consumer (sproutlake-site) migrates onto the scaffold output with identical behaviour.

## Dependencies
- External: @broberg/ai-sdk (ai.podcast/ai.tts/ai.transcribe), @webhouse/cms (getCollection, Stack A), Zod. Blocked-by: CMS F05 shipping first (interim: filesystem getCollection from sproutlake-site).

## Rollout
Strangler: 1) CMS implements F05 (collection templates + RSS + admin); 2) sproutlake-site pilot migrates its hand-rolled pages onto F05 collection config + the RSS route; 3) extract headless core (types/rss/format) into components/src/podcast/; 4) extract Stack A adapter pages/components as scaffold templates; 5) adopt back in sproutlake-site; 6) future sites scaffold from components. Then GRADUATE to its own repo+project.

Graduate-candidate: YES — should get its own repo + cardmem project (recommendation, confirm with Christian).

## Open Questions
- Podcast player a shared @broberg/components/ui component or scaffold-only (copied per repo)? A shared one needs framework-agnostic or two variants.
- Listener-only variant (no ElevenLabs/admin) vs full stack? (sproutlake-site is listener-only; cms needs full.)
- Episode fileSize (bytes) for RSS enclosure length — how does the storage adapter expose size after upload? Needs an explicit contract.
- chapters as structured {time,title}[] or markdown? F05 defines an array; RSS needs <podcast:chapters> JSON ref — decide before rss.ts.

## Effort estimate
**L** — owner session: `cms` (F05 first; ai-sdk owns the AI half). Reuse model: scaffold.

## Risks
RSS compliance: Apple Podcasts Connect validation is strict (itunes:image 3000x3000, accurate enclosure length, stable feed URL) — use Apple's Feed Validator in the RSS story AC. Audio storage: WAV/MP3 are large — sproutlake stores under /public/audio/ (ships into the Next bundle, wrong for prod); the scaffold MUST default to external storage (R2/Tigris/CMS adapter), never git repo or Next public/. ElevenLabs eleven_v3 (ai.podcast) needs a paid plan tier — starter keys 402; test with a real key + document the tier. CMS F05 dependency: the full scaffold needs F05 first; if delayed, build Stack A on the sproutlake filesystem getCollection as an interim data layer.