# F103 — `@broberg/realtime`: live kanaler til chat og realtid

> **Ordre:** Christian 21/10 2026: «b) byg begge», «chat skal altså være SOTA», «og 100% live / Realtids fornemmelse...».
> **Første forbruger:** jam F026.1 (chat pr. Jam).

## Hvad «100% live» betyder, som noget der kan måles

| Krav | Hvordan pakken leverer det | Målt hvordan |
|---|---|---|
| **Min egen besked vises øjeblikkeligt** | optimistisk udbakke: beskeden vises som «sendes» før serveren svarer, med et klient-id | test: tilstanden er `pending` synkront efter `send()` |
| **Den vises aldrig to gange** | serverens hændelse bærer samme klient-id → udbakken afstemmer i stedet for at tilføje | test: én besked efter afstemning |
| **De andre ser den med det samme** | SSE-strøm pr. kanal, intet polling | test: publish → hændelse hos lytter, p95 < 50 ms i processen; netværkstid måles hos jam i drift |
| **Intet går tabt** | `Last-Event-ID`-genoptagelse: det man missede sendes først, derefter det nye, uden hul og uden dublet | test med en langsom genoptagelse og en publish midt i den |
| **Mobilen i lommen** | klienten genåbner, når siden bliver synlig, kommer online, eller strømmen har været tavs for længe | test med falsk EventSource + synlighed |
| **«Skriver …» og hvem der er her** | flygtige hændelser (ingen id, ingen genoptagelse) + tilstedeværelse med udløb | test |
| **Flere maskiner** | fælles bus: Postgres `LISTEN/NOTIFY` (eller hukommelse på én maskine) | test med to hubs på samme bus |
| **Forbindelsen holder gennem proxyer** | hjerteslag-kommentar hvert 15. sekund, `X-Accel-Buffering: no` | test med falske timere |

## Hvorfor SSE og ikke WebSocket

Server → klient er det eneste, der skal være en åben strøm; afsendelse er en almindelig POST. SSE er ren HTTP: går gennem Fly's proxy og firmanet uden opsætning, browseren genforbinder selv og sender selv `Last-Event-ID`. Latens er den samme som WebSocket for denne trafik. WebSocket bliver relevant ved meget hyppig tovejs-trafik (fx et fælles lærred) — det dækker `@broberg/livesync` (F100).

## Frø: xrt81 F074 (commit 718575d)

`chatBus.ts` (fan-out pr. kanal, opsigelse der rydder op) og `/:channel/stream` (genoptagelse før live, hjerteslag, `stream.onAbort`). Dens dokumenterede grænse — «fan-out sker i PROCESSEN … med to maskiner ser den ene maskines lyttere ikke den andens beskeder» — er præcis hvad bussen her løser.

## Arkitektur

**Server** (`@broberg/realtime/server`, Web-standard `Response`/`ReadableStream`, virker i Hono, Bun, Node 18+, Next route handlers):

- `createRealtime({ bus?, replay?, heartbeatMs?, presenceTtlMs? })`
- `publish(channel, { type, data, id? })` — med `id` er hændelsen **varig** (kan genoptages via værtens `replay`); uden er den **flygtig** (skriver, tilstedeværelse).
- `stream(channel, { lastEventId, signal })` → SSE-`Response`. Rækkefølge: tilmeld live → buffer → genoptag (`replay(channel, lastEventId)`) → send buffer uden de id'er der allerede er sendt → live.
- `presence.touch(channel, member)` / `presence.leave(...)` / `presence.list(channel)` — join/leave udsendes som flygtige hændelser; udløb efter `presenceTtlMs`.
- **Én vej:** `publish` går altid gennem bussen, også lokalt, så en maskine aldrig leverer sin egen hændelse to gange.
- Bussen: `memoryBus()` (standard) og `postgresBus({ listen, notify })` med postgres.js' `sql.listen`/`sql.notify` (fx `@broberg/db-sdk`'s `client.raw`). NOTIFY-lofter er 8000 bytes: større hændelser afvises med en navngiven fejl — send id'et, ikke beskeden.

**Klient** (`@broberg/realtime/client`, browser-sikker):

- `connect(url, { onEvent, onState })` — EventSource, husker sidste id, genåbner ved synlighed/online/tavshed med `?lastEventId=`, sorterer dubletter fra på id.
- `createOutbox({ post })` — optimistisk afsendelse med klient-id, afstemning, genforsøg og synlig `failed`-tilstand.
- `typingThrottle(send, { intervalMs })` — højst én «skriver»-hændelse pr. interval.

## Non-goals

- Lagring af beskeder, adgangstjek, UI — værtens (appen ved, hvem der må se kanalen).
- Redis-bus (bygges når en forbruger uden Postgres beder om den).
- Læst-kvitteringer — en varig hændelse appen selv publicerer.

## Reuse

Discovery-kataloget har ingen realtime/SSE/presence-pakke. `@broberg/chat` er AI-chat (Aidan); dens SSE strømmer ét svar, ikke kanaler. `@broberg/livesync` er Yjs-dokumenter. Postgres-bussen tager postgres.js-funktionerne ind, så `@broberg/db-sdk`'s `client.raw` kan bruges uden ny driver.

## Stories

- **F103.1** — pakken 0.1.0 (server, bus, tilstedeværelse, klient, udbakke) med målte live-krav.
- **F103.2** — jam F026.1 bruger den i drift; latens og genoptagelse målt på en rigtig telefon.
