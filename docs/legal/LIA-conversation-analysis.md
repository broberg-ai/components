# Interesseafvejning (LIA) — analyse af samtaler og brug for at forbedre vores produkter

**Dataansvarlig:** WEB HOUSE ApS, Riberhusvej 9, 9492 Blokhus, CVR 21221198 (broberg.ai).
**Gælder:** alle produkter, platforme, apps, værktøjer og agenter (components F110).
**Retsgrundlag der vurderes:** GDPR art. 6, stk. 1, litra f (legitim interesse).
**Skrevet:** 31. oktober 2026 — **udkast til advokatens gennemlæsning.** Ikke juridisk rådgivning.
**Kilder:** EDPB Guidelines 1/2024 om art. 6(1)(f); EDPB Guidelines 01/2025 om pseudonymisering;
`docs/legal/pseudonymisation-standards.md`; ejerens beslutninger på kort F110.1.

## 1. Formålstesten — er interessen legitim?

**Interessen:** at forstå hvordan vores produkter faktisk bruges, så vi kan rette fejl, forbedre
brugervenligheden, forbedre kvaliteten af de automatiske svar (AI) og vælge hvad der skal udvikles —
og at kunne gennemgå (revidere) produkterne bagefter.

- Lovlig, konkret og reel: produktudvikling og kvalitetssikring er anerkendte legitime interesser
  (EDPB 1/2024).
- **Ikke** formålet: markedsføringsprofiler, målrettede annoncer, salg af data, træning af eksterne
  sprogmodeller. Det står eksplicit i privatlivspolitikken.

## 2. Nødvendighedstesten — er behandlingen nødvendig, og findes der en mindre indgribende vej?

| Del (ejerens firedelte model) | Nødvendig fordi | Mindre indgribende alternativ — valgt |
|---|---|---|
| 1. Brug (skærme, fejl, tid) | Kan ikke forbedres uden at vide hvor brugerne går i stå | Ingen indholdsdata; pseudonymt id |
| 2. Struktur (emne/hensigt) | AI-svarenes kvalitet kan kun måles på hvad der blev spurgt om | Indholdet fjernes; kun strukturen bliver |
| 3. Anonyme opgørelser | Prioritering kræver tal | Kun grupper ≥ 10 — uden for GDPR |
| 4. Fuldt indhold | Dybere analyse af misforståelser | **Kun med samtykke** — ikke en del af denne afvejning |

Dataminimering: kun nødvendige felter; direkte identifikatorer erstattes med nøglebaserede pseudonymer
(nøglen opbevares adskilt), CPR fjernes, navne i fri tekst erstattes, tid gøres grovere
(pseudonymiseringsstandarden).

## 3. Afvejningstesten — går brugerens interesser forud?

**Brugernes rimelige forventninger:** det er almindeligt kendt at digitale tjenester analyserer brug for at
forbedre sig, når det oplyses tydeligt. Vi oplyser det i privatlivspolitikken, i vilkårene og — hvor det
er relevant — ved samtaler med AI.

**Konsekvenser for brugeren:** lav — data er pseudonymiseret, adgangen er begrænset og logget, der træffes
ingen afgørelser om den enkelte, og intet bruges til markedsføring.

**Sårbare grupper og særlige kategorier:**
- **Helbredsoplysninger (art. 9) kan ikke bæres af art. 6(1)(f).** De fjernes før analysen, medmindre
  udtrykkeligt samtykke (del 4).
- Børn under 15 år: kun del 1–3. [Antaget — advokaten bekræfter alderen]

**Garantier:**
- Pseudonymisering før analysen; nøglen i Secrets Vault, adskilt fra data.
- **Opbevaring:** analysekopien højst **6 måneder**; produktdata (konto, indhold) så længe kontoen findes;
  anonyme opgørelser uden tidsgrænse; sletning på anmodning inden 90 dage, backups inden yderligere 90.
- Ingen overførsel uden for EU uden overførselsgrundlag; AI-analyse i EU (Mistral, Paris) som standard.
- Adgang til rå samtaler kun for navngivne medarbejdere; alle opslag logges.
- **Ret til indsigelse (art. 21)** oplyses tydeligt og kan udøves ved én henvendelse; en indsigelse
  respekteres for fremtiden.

**Hvor vi er databehandler** (kundeplatforme): standarden er at analyse er tilladt, medmindre kunden
modsætter sig i databehandleraftalen (ejerens beslutning). Det kræver at **kunden** har grundlag for at
lade os bruge oplysningerne og oplyser sine egne brugere — afsnittet til kundens privatlivspolitik
leveres i `dpa`. For analysen bliver vi selvstændigt dataansvarlige.

## 4. Konklusion (til advokatens vurdering)

Med de anførte garantier vurderes analysen af del 1–3 at kunne ske på legitim interesse; del 4 og alle
helbredsoplysninger kræver udtrykkeligt samtykke. Vurderingen genbesøges ved væsentlige ændringer i formål,
datakategorier eller metode, og mindst én gang om året.

**Åbne punkter til advokaten:**
1. Er 6 måneder tilstrækkeligt begrundet for analysekopien?
2. Børnealderen (15 år) for del 4.
3. Selvstændigt dataansvar for analysen på kundeplatforme — formulering i `dpa`.
4. Om en konsekvensanalyse (DPIA) er påkrævet for helbreds-platforme.
