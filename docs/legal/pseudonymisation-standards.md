# Pseudonymisering — de standarder vi bygger efter (components F110.8)

**Skrevet:** 31. oktober 2026, før koden, på ejerens ordre: *«vi skal i samme API have udviklet et
apperat/mekanisme til at pseudonymisere data (research og du finder gængse standarder for dette)».*
**Status:** grundlag til den juridiske gennemlæsning (F110.3). Ikke juridisk rådgivning.

## Begreberne — og hvorfor ordet «anonymiseret» ikke bruges om samtaler

- **Pseudonymisering** (GDPR art. 4, nr. 5): oplysningerne kan ikke længere knyttes til en bestemt
  person *uden yderligere oplysninger*, og de yderligere oplysninger (nøglen) opbevares adskilt og
  beskyttet. **Det er stadig personoplysninger** — alle regler gælder (formål, opbevaring, rettigheder).
- **Anonymisering** (betragtning 26): ingen kan med rimelige midler identificere personen igen.
  Så er det uden for GDPR. Fri tekst fra samtaler når sjældent dertil, fordi navne, steder og
  detaljer i selve teksten kan pege på en person — derfor lover vi kun pseudonymisering af samtaler,
  og bruger kun ordet anonym om **opgørelser** (tal for grupper på mindst 10).

## Standarderne vi har læst op imod

| Kilde | Hvad vi bruger fra den |
|---|---|
| **GDPR** art. 4(5), 25, 32, 89 + betragtning 26 og 28–29 | Definitionen; pseudonymisering som sikkerhedsforanstaltning og «databeskyttelse gennem design» |
| **EDPB Guidelines 01/2025 on Pseudonymisation** (vedtaget januar 2025) | «Pseudonymiseringsdomænet» (hvem må se data uden at kunne genkende personen), nøglen holdes adskilt, ingen hash uden hemmelig nøgle, risikovurdering af genidentifikation |
| **ENISA** — *Pseudonymisation techniques and best practices* (2019) og *Data Pseudonymisation: Advanced Techniques and Use Cases* (2021) | Teknikkerne og deres styrker: nøglebaseret hash (HMAC), kryptering, tabeller, og at et almindeligt hash af e-mail/telefon kan gættes igen |
| **ISO/IEC 20889:2018** | Fælles ord for teknikkerne: fjernelse, generalisering, maskering, pseudonymer |
| **ISO/IEC 27559:2022** | Rammen: vurdér konteksten (hvem modtager data, hvad kan de kombinere med) før teknikken vælges |
| **NIST SP 800-188** (2023) | Mål genidentifikations-risikoen, frem for at antage den væk; dokumentér hvad der ikke er fjernet |
| **EU-Domstolen C-413/23 P (EDPS mod SRB, 2025)** | En modtager uden adgang til nøglen kan i visse tilfælde ikke identificere personen — men for os, der har nøglen, er data stadig personoplysninger. [Sandsynligt — læses af juristen] |

## Hvad der gøres ved hver slags data

| Data | Teknik | Hvorfor |
|---|---|---|
| Konto-id, e-mail, telefon, IP-adresse | **HMAC-SHA256 med en hemmelig nøgle** (i Secrets Vault, aldrig sammen med data) → kort pseudonym | Samme person får samme pseudonym i analysekopien, så forløb kan følges; uden nøglen kan det ikke vendes. ENISA/EDPB: aldrig et hash uden nøgle — e-mails kan gættes |
| CPR-nummer | **Fjernes helt** (`[CPR]`), aldrig pseudonymiseret | Der er intet analyseformål med at kunne kende det igen |
| Navne og andre personhenførbare ord i fri tekst | **Findes og erstattes** konsekvent pr. samtale: «Mette Jensen» → `[PERSON-1]` | Først opslag af de navne systemet allerede kender (afsender, sagens parter — helpdesks metode), derefter et sprogmodel-trin i EU (Mistral via `@broberg/ai-sdk`). Det der ikke kan undersøges, står i resultatets `notExamined` |
| Adresse, fødselsdato | **Generaliseres**: postnummer → landsdel, dato → år | Holder analysen brugbar uden at pege på én person |
| Helbredsoplysninger (art. 9) | **Fjernes** (del 2: kun strukturen bliver), medmindre udtrykkeligt samtykke (del 4) | Ejerens firedelte model |
| Tidspunkter | **Grovere** (time eller dag) | Et præcist tidspunkt kan kombineres med andre data |
| Opgørelser | **Kun grupper ≥ 10** | Så ingen enkelt person kan udpeges (ejerens tal) |
| Adgangskoder, nøgler, tokens | **Fjernes** (`@broberg/secret-scan`) | Har aldrig noget i en analyse at gøre |

## Nøglen

- Én nøgle pr. **pseudonymiseringsdomæne** (fx «produktanalyse»), opbevaret i cardmems Secrets Vault,
  aldrig i samme database som analysekopien.
- **Rotation:** en ny nøgle gør gamle pseudonymer uforbundne med nye. Det er en bevidst
  sikkerhedsgevinst — og analyser på tværs af en rotation skal vide det.
- Sletter vi nøglen efter 6 måneder, kan selv vi ikke længere forbinde pseudonymerne med personer.

## Opbevaring og sletning (ejerens tal)

Hver post i analysekopien bærer datoen den må gemmes til — **højst 6 måneder** fra indsamling — og et
sletjob fjerner det der er udløbet. Sletning på anmodning inden 90 dage, fra backups inden yderligere 90.

## Det vi IKKE lover

- At fri tekst bliver anonym. Den bliver pseudonymiseret, og en målt fangstrate for navne på dansk
  tekst offentliggøres sammen med koden (F110.8, AC3).
- At pseudonymiserede data er uden for GDPR. Det er de ikke for os.

## Målt (2/11 2026, F110.8, `@broberg/legal/pseudonymise` 0.7.0)

- **Kendte navne** (afsender, sagens parter) på en dansk testkorpus på 16 sætninger — fuldt navn,
  fornavn alene, efternavn alene, ejefald («Mettes»), små bogstaver, «Efternavn, Fornavn»,
  bindestregsnavne, æ/ø/å: **16/16 fundet**. Korpusset står i `packages/legal/test/pseudonymise.test.ts`.
- **Ukendte navne:** findes IKKE uden et `findNames`-trin (sprogmodel i EU). Resultatet siger det selv
  (`notExamined: "names-not-known"`). Fangstraten for modeltrinnet er ikke målt endnu.
- **Helbred:** et dansk ordforråd fjerner hele sætningen. Hvad ordforrådet ikke kender, står i
  `notExamined: "health-beyond-keywords"`.
