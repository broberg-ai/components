# F104 — `@broberg/voice`: infrastruktur-specifikation

> **Ordre:** Christian 21/10 2026, ordret: «b) byg begge og giv mig en infrastruktur spec på voice».
> **Status:** GODKENDT af ejeren 21/10 2026, ordret: «Én fælles server til en start det er kun Jam der skal bruge det initialt, voice.broberg.ai, budget OK GO». Svar på de åbne spørgsmål står nederst. `@broberg/voice` 0.1.0 er udgivet (F104.3) før serveren, på ejerens ord samme aften («gør den anden pakke klar så begge kommer ud»).
> **Konfidens:** priser, Fly-UDP-detaljer og kapacitetstal er `[Likely]` — læst, ikke målt. De måles i F104.2's prøve, før noget går i drift.

## 1. Hvad der skal kunne lade sig gøre

Et stemmeopkald pr. «rum» (i Jam: pr. Jam) med **2–10 deltagere**, som Slack Huddle:

- virker i browser på Mac/PC, **iPhone (Safari og PWA)** og **Android**, på **mobilnet** og **bag firmanet** der blokerer UDP;
- **overlever at appen udrulles** midt i et opkald;
- mute, slå lyd fra, vælg mikrofon/højttaler, styrke pr. deltager, «hvem taler»;
- støjfjernelse, ekko-fjernelse, automatisk styrke;
- appen bestemmer selv, hvem der må komme ind (rum-id = jam-id).

**Ikke i scope:** video, skærmdeling, optagelse, transskription, opkald til telefonnumre. (Kan bygges oven på samme server senere.)

## 2. Hvad vi har lært — cardmems udgave, 7.–8. juli

cardmem byggede rå peer-to-peer (hver deltager sender direkte til hver anden), signalering over WebSocket med rum i hukommelsen, kun Googles STUN og ingen TURN. Målt udfald (kun testet på én Mac):

| Udfald | Årsag | Hvad denne spec gør anderledes |
|---|---|---|
| Mac'en frøs | ubegrænset 1080p video, to software-encodes | **kun lyd** (Opus ~32 kbit/s); hver klient sender ÉN strøm |
| «Zombie»-deltagere | ingen oprydning efter hårde afbrud | serveren ejer rummet og smider døde forbindelser ud |
| Rum stod åbne efter genstart | rum i app'ens hukommelse | rum bor i mediaserveren, ikke i appen |
| Opkald døde ved udrulning | signalering i app-processen | appen udsteder kun en billet; lyden går app'en udenom |
| Virker ikke på mobil/firmanet | ingen TURN | indbygget TURN, også over TLS på port 443 |
| Ingen genopkobling | ingen ICE-restart | serverens SDK genopretter selv (ICE-restart + genoptagelse) |

## 3. Arkitekturen (anbefalet)

```
  browser (Jam)  ── 1. beder Jam om en billet ──►  Jam-serveren
       │                                              │  udsteder en kortlivet,
       │                                              │  rum-bundet billet (JWT)
       │ ◄──────────────── billet ───────────────────┘
       │
       └── 2. lyd (WebRTC) ──►  voice.broberg.ai  (LiveKit SFU, Fly arn)
                                  • videresender lyd mellem deltagerne
                                  • indbygget TURN (UDP + TLS:443)
                                  • 3. kalder Jam tilbage (webhook) ved join/leave
```

**SFU** («selective forwarding unit»): hver deltager sender sin lyd ÉN gang til serveren, som sender den videre til de andre. Ingen omkodning på serveren, så den er let. Med 10 deltagere modtager hver klient 9 lydstrømme (~0,3–0,5 Mbit/s) og sender 1. `[Likely]`

**Softwaren: LiveKit, selv-hostet** (open source, Apache 2.0, Go). Den bringer det, cardmem måtte bygge selv og ikke nåede: TURN, ICE-restart, genoptagelse, aktive talere, lydniveauer, webhooks, adgangsbilletter (JWT), klient-SDK til browser/iOS/Android.

### Hvor den kører

| | Valg | Hvorfor |
|---|---|---|
| Region | **Fly `arn` (Stockholm)** | husets regel; EU |
| Maskine | én `shared-cpu-2x`, 2 GB, én instans | lyd-SFU uden omkodning er let; én instans fordi LiveKit uden Redis er én node `[Likely]` |
| Netværk | **dedikeret IPv4** + UDP-port til medier (single-port mux, fx 7882), TCP-fallback (7881), TURN/TLS på 443 | Fly kræver dedikeret IPv4 og binding til `fly-global-services` for UDP `[Likely — måles i F104.2]` |
| Domæne | `voice.broberg.ai` | oprettes gennem buddy (DNS-reglen) |
| Hemmeligheder | `LIVEKIT_API_KEY`/`_SECRET` pr. app i cardmem-vaulten og som Fly-secret | appen signerer billetter med sin egen nøgle |

**Plan B, hvis Fly's UDP viser sig utilstrækkelig i prøven:** samme LiveKit på en EU-VM med fri UDP (UpCloud Stockholm eller Hetzner Helsinki), samme domæne. Appen og pakken mærker ingen forskel.

## 4. Fravalgte veje

| Vej | Hvorfor ikke |
|---|---|
| Peer-to-peer mesh (cardmems) | målt udfald, se afsnit 2; ved 10 deltagere sender hver klient 9 strømme |
| LiveKit Cloud / Daily / Twilio / Agora | amerikanske firmaer og forbrugs-afregning; i strid med «ikke flere US-tjenester end nødvendigt» og med EU-reglen |
| mediasoup / Janus selvbygget | samme serverrolle, men vi skulle selv bygge TURN-integration, genopkobling, webhooks og billetter — det cardmem ikke nåede |
| Separat coturn + egen signalering | to systemer at drive i stedet for ét |

## 5. Sikkerhed og privatliv

- **Billetter:** appens server udsteder en JWT pr. deltager, bundet til ÉT rum (`<app>:<rum-id>`), kun lyd (`canPublish`, `canPublishSources: [microphone]`), kort gyldighed for at komme ind (10 min). Klienten får aldrig API-nøglen.
- **TURN-adgang** udstedes af LiveKit pr. forbindelse og er kortlivet — ingen faste TURN-kodeord.
- **Webhooks** til appen ved join/leave er signerede; pakken verificerer signaturen.
- **Ingen optagelse.** Lyden passerer vores server i EU og gemmes ikke. Intet sendes til tredjepart.
- **Isolation mellem apps** `[Åbent spørgsmål 1]`: én fælles server med en nøgle pr. app og rum-navne med app-præfiks. LiveKit binder ikke en nøgle til et præfiks, så en app med sin nøgle kunne i princippet udstede en billet til en anden apps rum. Alternativ: én server pr. app (dyrere, fuld isolation).

## 6. Kapacitet og pris `[Likely — priser læst, ikke målt]`

| | Estimat |
|---|---|
| Lyd pr. deltager | Opus ~32–50 kbit/s |
| Server-trafik, 10 personer i 1 time | ~10×9×40 kbit/s ≈ 3,6 Mbit/s ≈ 1,6 GB |
| Fly-maskine `shared-cpu-2x`/2 GB | ~10–15 USD/md |
| Dedikeret IPv4 | ~2 USD/md |
| Trafik (Fly EU) | ~0,02 USD/GB → ~0,03 USD for det 10-personers time-lange opkald |
| Samlet ved let brug | **~15–20 USD/md** |

En maskine bør kunne bære mange samtidige lyd-rum; det reelle loft måles i prøven.

## 7. Drift

- **Udrulning af appen** (Jam): opkald fortsætter — lyden går ikke gennem appen.
- **Udrulning af mediaserveren** afbryder opkald (én node). Den udrulles sjældent og uden for arbejdstid; klienten genopretter selv efter få sekunder.
- **Overvågning:** LiveKit's `/` og webhook-heartbeat + Upmetrics-probe; fejl fra klienten via `@upmetrics/sdk`.
- **Ingen database** på mediaserveren. Hvem der er i hvilket rum, bor i LiveKit, mens opkaldet varer, og i appen via webhooks.

## 8. Testplan (FØR drift — cardmem testede kun på én Mac)

| Prøve | Hvad den beviser |
|---|---|
| iPhone Safari + iPhone PWA + Android Chrome | mobil-browsere, mikrofon-tilladelse, baggrund/forgrund |
| 4G uden wifi | mobilnet / bag operatørens NAT |
| Et net der blokerer UDP | TURN over TLS:443 |
| 10 deltagere i 30 min | CPU på en Mac og på serveren, ingen frys |
| Udrul Jam midt i opkaldet | opkaldet fortsætter |
| Træk netkablet / flytilstand i 10 s | genopkobling, ingen zombie |
| Genstart mediaserveren | klienter kommer tilbage af sig selv |

## 9. Pakken `@broberg/voice` (F104.3, efter GO)

- **Server:** `createRoomToken({ apiKey, apiSecret, room, identity, name, ttl })` (kun lyd), `verifyWebhook(body, authHeader)`.
- **Klient (browser):** `joinVoice({ url, token })` → `{ mute(), unmute(), setOutputMuted(), setInputDevice(), setOutputDevice(), setVolume(participant, v), onSpeaking(cb), onParticipants(cb), leave() }`, bygget på `livekit-client`. Mikrofonen åbnes med `noiseSuppression`, `echoCancellation` og `autoGainControl` slået til.
- **data-testid** på alt interaktivt i et eventuelt UI-skelet.

## 10. Hvad der kræver ejerens GO, i rækkefølge

1. **GO til denne spec** (og svar på åbne spørgsmål nedenfor).
2. Oprette Fly-appen `broberg-voice` i `arn` + dedikeret IPv4 (~17 USD/md).
3. DNS `voice.broberg.ai` via buddy.
4. Hemmeligheder i vault + Fly.

Derefter: F104.2-prøven (afsnit 8), og først når den er grøn, pakken og Jam.

## Åbne spørgsmål til ejeren — BESVARET 21/10

**Svar:** (1) én fælles server — kun jam bruger den i starten; isolation pr. app genovervejes når app nr. 2 kommer. (2) `voice.broberg.ai`. (3) budget OK.


1. **Én fælles mediaserver for alle apps, eller én pr. app?** Fælles er billigst og nok i starten; pr. app giver fuld isolation (afsnit 5).
2. **Domæne:** `voice.broberg.ai`?
3. **Budget:** ~15–20 USD/md ved let brug — OK?

## Fly-opsætningen (målt af andre, gentages i F104.2)

Fly bærer UDP kun på en **dedikeret IPv4**, og appen skal lytte på den særlige `fly-global-services`-adresse — lytter den på alle adresser (`0.0.0.0`), forsvinder svarene lydløst. For LiveKit er der to steder: `rtc.ips.includes` (opkaldstrafikken) og `turn.bind_addresses` (TURN). Adressen er forskellig pr. maskine, så den læses fra `/etc/hosts` ved opstart. Kilde: community.fly.io «Running LiveKit … fly-global-services UDP bind requirement» — der blev et rigtigt opkald gennemført efter rettelsen. `[Likely — ikke målt af os endnu]`

Porte: 443 (signalering, TLS hos Fly) · 7881/tcp (opkald over TCP) · 7882/udp (opkald) · 3478/udp (TURN) · 5349/tcp (TURN over TLS, TLS hos Fly). **Kendt begrænsning:** TURN-over-TLS ligger på 5349, ikke 443, fordi 443 bruges af signaleringen og Fly ikke kan fordele samme port efter domænenavn. Et firmanet der KUN tillader 443, kan derfor ikke ringe endnu — det måles i testplanen, og løsningen (en anden IP eller en EU-VM med Caddy-SNI) vælges først hvis det viser sig at ramme.

## Video og optagelse — senere, samme server

Ejeren spurgte 21/10. **Video:** samme LiveKit; billetten får lov til `camera` (og evt. `screen_share`), pakken får `enableCamera()`, og simulcast holder klienterne nede. Trafikken stiger ~10–30×. **Optagelse:** LiveKit Egress som egen tjeneste (headless Chrome + Redis), filer til et EU-lager (Tigris arn), ~+15–30 USD/md `[Likely]`. Persondata: synlig optage-indikator, hvem må starte, opbevaringstid — ejerens beslutninger når det bestilles.

## Reuse

Discovery-kataloget (`scripts/inventory-data.mjs`) har ingen voice-, webrtc- eller realtime-pakke. `@broberg/sso` (billetter) bruges ikke til LiveKit-billetten, fordi LiveKit kræver sit eget JWT-format; appens adgangstjek før billetten udstedes er appens eget. Overvågning via Upmetrics. Ingen ny tredjepart ud over LiveKit (selv-hostet, open source).
