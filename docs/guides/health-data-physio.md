# Helbredsdata i fysioterapi-apps — hvad vi må analysere, og hvordan brugeren giver samtykke

**Status:** fleet-retningslinje, besluttet af ejeren 31. oktober 2026 (components F110).
**Gælder:** alle apps og platforme med patient- eller helbredsdata — først FysioDanmark Aalborg (FDAA / fd-sundhed).
**Teksterne** (vilkår, privatlivspolitik, samtykketekst) hentes fra `legal.broberg.ai` / `@broberg/legal`, så snart
de er juridisk gennemlæst. Indtil da er denne side reglerne, og en mockup må bruge pladsholder-tekst.

> Ikke juridisk rådgivning. Reglerne er ejerens beslutning på et forsigtigt grundlag; ordlyden gennemlæses af en jurist,
> før den går live.

## Den firedelte model (ejeren: «Yes til four-part model»)

| Del | Hvad vi må | Kræver samtykke? |
|---|---|---|
| **1. Brug** | Hvilke skærme, hvilke trin der droppes, fejl, tidsforbrug — ingen helbredsindhold | Nej — standard for alle |
| **2. Struktur** | «spurgte om øvelsesprogram», «markerede et smerteområde» — helbredsindholdet fjernes automatisk (pseudonymisering, F110.8) | Nej |
| **3. Anonyme tal** | «312 markerede knæet denne måned» — kun grupper på mindst 10, så ingen kan udpeges | Nej — ægte anonyme tal er uden for GDPR |
| **4. Fuldt indhold** | Patientens egen tekst og registreringer, til dybere analyse | **Ja** — aktivt, separat, kan trækkes tilbage |

Helbredsoplysninger er en særlig kategori (GDPR art. 9). Legitim interesse rækker ikke; del 4 kræver **udtrykkeligt
samtykke** (art. 9, stk. 2, litra a). Del 1–3 indeholder ikke helbredsoplysninger om en identificerbar person.

## Hvordan brugeren afkræves accept — to forskellige ting

### A. Vilkårene (alle brugere, ved oprettelse)

- Et **ikke-afkrydset** felt: «Jeg accepterer vilkårene for brug» med link til vilkårene.
- Privatlivspolitikken **linkes og vises**, men accepteres ALDRIG — den er information, ikke en aftale.
- Gem accepten: `{ subject, product, doc: "terms", version, contentHash, at }` (F110.6). Ved en væsentlig ændring
  spørges igen; ellers vises en meddelelse.

### B. Samtykke til del 4 (kun hvis produktet vil bruge fuldt indhold)

Reglerne for skærmen — det er dem en mockup skal vise:

1. **Separat fra vilkårene.** Aldrig samme afkrydsning, aldrig en betingelse for at bruge appen. Siger patienten nej,
   virker alt præcis som før.
2. **Ikke forudafkrydset og ikke et mørkt mønster.** «Ja» og «Nej tak» er lige store og lige synlige; ingen
   «senere»-knap der i virkeligheden er et ja.
3. **Specifikt og forståeligt** — på én skærm, i almindeligt dansk: HVAD (dine beskrivelser og registreringer),
   HVORFOR (at gøre appen bedre for patienter og fysioterapeuter), HVORDAN (navn og kontaktoplysninger fjernes først),
   HVOR LÆNGE (højst 6 måneder), HVEM (WebHouse ApS og klinikken), og at det **kan trækkes tilbage når som helst**.
4. **På et naturligt tidspunkt** — ikke midt i oprettelsen. Fx efter første afsluttede forløb eller i indstillinger.
5. **Lige så let at trække tilbage som at give** — én kontakt i «Indstillinger → Data og privatliv». En tilbagetrækning
   gælder fremad: nye data indgår ikke, og tidligere data i analysekopien slettes.
6. **Gem beviset:** `{ subject, purpose: "health-content-analysis", version, contentHash, givenAt, withdrawnAt? }` —
   samme form som vilkårs-accepten. Uden bevis = intet samtykke.
7. **Børn:** under 15 år spørges ikke; deres indhold indgår kun i del 1–3. [Antaget — bekræftes ved den juridiske
   gennemlæsning.]

### Hvem spørger — klinikken eller os?

På klinik-platforme (fx FDAA) er **klinikken dataansvarlig** for patienternes oplysninger, og vi er databehandler.
Derfor:

- Samtykket indhentes **i klinikkens app**, med klinikkens navn som afsender og vores tekst fra `legal.broberg.ai`.
- Klinikkens privatlivspolitik får et fast afsnit om produktanalyse (leveres i samme API — `dpa` indeholder det).
- Databehandleraftalen (Contract Manager, F110.9) siger: analyse af del 1–3 er standard, kunden kan modsætte sig;
  del 4 kun med patientens samtykke som ovenfor.

## Tjekliste til mockuppen (FDAA)

- [ ] Oprettelse: ikke-afkrydset «Jeg accepterer vilkårene», link til privatlivspolitikken (læses, accepteres ikke).
- [ ] Separat samtykkeskærm til del 4 med de 6 punkter fra regel 3 — «Ja» og «Nej tak» lige store.
- [ ] Indstillinger → Data og privatliv: status (givet/ikke givet, dato), én kontakt til at trække tilbage.
- [ ] Tom tilstand, indlæsning, fejl ved gemning og offline-tilstand for samtykkeskærmen (fleetens mockup-regel).
- [ ] Teksterne er pladsholdere mærket «hentes fra legal.broberg.ai», indtil F110.3 er gennemlæst.

## Kilder

- GDPR art. 6, 7, 9 og 21 (EUR-Lex, forordning 2016/679).
- EDPB Guidelines 05/2020 om samtykke og 01/2024 om legitim interesse.
- components F110 plan: `docs/features/F110-legal-documents.md`.
