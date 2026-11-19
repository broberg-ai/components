# F114 — Mail-pakkerne (fra mailworker, til Mail)

## ÅBNE SPØRGSMÅL (før kode)
1. **Ordre:** ikke bestilt. Mail (broberg-ai/mail) starter epic C når deres Build Contract er signeret. components bygger når der er en ordre (Build Contract / ejerens ord).
2. **Interface først:** Mail skriver en interface-spec for `MailProvider` (deres F002.2) til godkendelse, før kode flyttes. components venter på den.
3. **mailworkers samtykke:** koden ejes af mailworker; udtrækningen sker sammen med dem, og mailworker skal selv skifte til pakkerne (ingen nøgen cutover).
4. **Navne:** se nedenfor — `@broberg/mail` findes allerede og SENDER; læsesiden må ikke kunne forveksles med den.

## Hvorfor
Mail (ny 19/11) skal læse, forbinde til, filtrere og vurdere mail — det mailworker allerede gør og har målt i drift. D-d3c8c9 forbyder kopi; flere apps → fælles pakker (reuse > re-roll).

## Foreslået opdeling (stories, i rækkefølge)
1. **`@broberg/mail-connect`** — OAuth-forbindelse til Google + Microsoft (PKCE, forseglede tokens via `@broberg/seal`), lager som interface. Fra mailworker F010.
2. **`@broberg/mailbox`** (Mails forslag: `mail-provider`) — `MailProvider`-interface + adaptere gmail / graph / imap til at LÆSE og mærke mail. Navnet adskiller læsning fra `@broberg/mail` (afsendelse; har allerede `gmailTransport` til at sende som brugeren i tråden, F005.20).
3. **`@broberg/mail-filters`** — de 4 støjfiltre (F001).
4. **`@broberg/tone`** — tone-profil, score, generator (F003–F005) — AI-kald via `@broberg/ai-sdk`.
5. **`@broberg/mail-triage`** — kompetence-vurdering + beslutningsfunktion (F009).
6. **Kalender** (Mails epic G, senere) — ingen fælles pakke findes; cardmems kalender (F318) er intern. Planlægges som egen story når Mail når dertil.

## Krav til alle
Rene biblioteker: ingen server, ingen /data-sti, lager og hemmeligheder gives ind som interfaces. Persondata (mail) → kun EU-ruter i AI-kald. Hver pakke: tests + mutation, release-rapport (D-b7eb14).

## Afhængigheder
`@broberg/seal`, `@broberg/ai-sdk`, `@broberg/mail` (afsendelse). Mails F002.1/F002.2.

## Reuse
Udtræk af målt kode fra mailworker til fælles pakker; ingen ny dublet.
