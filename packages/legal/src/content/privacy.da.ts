import type { DocumentSource } from "../types.js";

export const PRIVACY_DA: DocumentSource = {
  doc: "privacy",
  locale: "da",
  title: "Privatlivspolitik",
  version: "2026-11-02",
  effectiveFrom: "2026-11-02",
  material: false,
  draft: false,
  sections: [
    {
      id: "dataansvarlig",
      heading: "Dataansvarlig",
      blocks: [
        { id: "dataansvarlig.p1", type: "p", text: "WEB HOUSE ApS, Riberhusvej 9, 9492 Blokhus, CVR 21221198. Kontakt: legal@broberg.ai." },
        { id: "dataansvarlig.p2", type: "p", text: "Denne politik fortæller, hvilke oplysninger vi gemmer, hvorfor, og hvor længe. Den er information til dig — den er ikke noget, du skal acceptere." },
      ],
    },
    {
      id: "oplysninger",
      heading: "Hvilke oplysninger vi behandler",
      blocks: [{ id: "oplysninger.facts", type: "facts", fact: "dataCategories" }],
    },
    {
      id: "formaal",
      heading: "Hvorfor vi behandler dem",
      blocks: [
        {
          id: "formaal.table",
          type: "table",
          head: ["Formål", "Retsgrundlag"],
          rows: [
            ["At levere tjenesten til dig", "Opfyldelse af aftale (GDPR art. 6, stk. 1, litra b)"],
            ["At besvare henvendelser og holde tjenesten sikker", "Legitim interesse (art. 6, stk. 1, litra f)"],
            ["Analyse for at forbedre vores produkter (se nedenfor)", "Legitim interesse (art. 6, stk. 1, litra f) efter en dokumenteret interesseafvejning"],
            ["Bogføring", "Retlig forpligtelse (art. 6, stk. 1, litra c)"],
            ["Analyse af dit eget indhold, hvis du har sagt ja", "Udtrykkeligt samtykke (art. 6, stk. 1, litra a, og art. 9, stk. 2, litra a)"],
          ],
        },
      ],
    },
    {
      id: "analyse",
      heading: "Analyse af samtaler for at forbedre vores produkter",
      blocks: [
        { id: "analyse.p1", type: "p", text: "Vi analyserer, hvordan vores produkter bruges — også samtaler med vores AI-assistenter — for at rette fejl, gøre produkterne lettere at bruge, forbedre kvaliteten af de automatiske svar og kunne gennemgå produkterne bagefter." },
        {
          id: "analyse.list",
          type: "list",
          items: [
            "Brug: hvilke skærme og trin der bruges, hvor man går i stå, fejl og tidsforbrug.",
            "Struktur: hvad en henvendelse handler om (fx «spurgte om et øvelsesprogram») — selve indholdet fjernes.",
            "Anonyme tal: opgørelser, der kun vises for grupper på mindst 10 personer, så ingen kan udpeges.",
            "Fuldt indhold: dine egne beskrivelser og registreringer — kun hvis du udtrykkeligt har sagt ja, og du kan altid trække det tilbage.",
          ],
        },
        { id: "analyse.p2", type: "p", text: "Før analysen pseudonymiseres oplysningerne: navn, e-mail, telefon og andre direkte kendetegn erstattes med koder, CPR-numre fjernes, og navne i fri tekst erstattes. Pseudonymiserede oplysninger er stadig personoplysninger, og alle dine rettigheder gælder." },
        { id: "analyse.p3", type: "p", text: "Helbredsoplysninger indgår kun i analysen, hvis du udtrykkeligt har givet samtykke. Ellers fjernes de, før analysen sker." },
        { id: "analyse.p4", type: "p", text: "Vi bruger ikke analysen til markedsføringsprofiler eller målrettede annoncer, vi sælger ikke data, og vi bruger ikke dine oplysninger til at træne eksterne AI-modeller." },
        { id: "analyse.facts", type: "facts", fact: "conversationAnalysis" },
      ],
    },
    {
      id: "opbevaring",
      heading: "Hvor længe vi gemmer oplysningerne",
      blocks: [
        {
          id: "opbevaring.table",
          type: "table",
          head: ["Oplysninger", "Hvor længe"],
          rows: [
            ["Din konto og dit indhold", "Så længe du har kontoen"],
            ["Den pseudonymiserede kopi til analyse", "Højst 6 måneder"],
            ["Anonyme opgørelser", "Uden tidsgrænse — de kan ikke føres tilbage til dig"],
            ["Bogføringspligtige oplysninger", "5 år, som bogføringsloven kræver"],
          ],
        },
        { id: "opbevaring.p1", type: "p", text: "Beder du os slette dine oplysninger, sker det inden for 90 dage, og fra sikkerhedskopier inden for yderligere 90 dage." },
      ],
    },
    {
      id: "hvor",
      heading: "Hvor dine oplysninger ligger",
      blocks: [{ id: "hvor.facts", type: "facts", fact: "hosting" }],
    },
    {
      id: "deling",
      heading: "Hvem vi deler oplysninger med",
      blocks: [
        { id: "deling.p1", type: "p", text: "Vi sælger aldrig data. Vi bruger disse databehandlere, som kun må behandle oplysningerne efter vores instruks:" },
        { id: "deling.facts", type: "facts", fact: "subprocessors" },
        { id: "deling.p2", type: "p", text: "Overførsel uden for EU sker kun med et gyldigt overførselsgrundlag, fx EU-Kommissionens standardkontraktbestemmelser eller EU-US Data Privacy Framework." },
      ],
    },
    {
      id: "rettigheder",
      heading: "Dine rettigheder",
      blocks: [
        { id: "rettigheder.p1", type: "p", text: "Du har ret til indsigt, berigtigelse, sletning, begrænsning af behandlingen og dataportabilitet." },
        { id: "rettigheder.p2", type: "p", text: "Du har ret til at gøre indsigelse mod behandling, der sker på grundlag af legitim interesse, herunder analysen for at forbedre vores produkter (GDPR art. 21). Skriv til legal@broberg.ai." },
        { id: "rettigheder.p3", type: "p", text: "Har du givet samtykke, kan du altid trække det tilbage — lige så let, som du gav det." },
        { id: "rettigheder.p4", type: "p", text: "Du kan klage til Datatilsynet (datatilsynet.dk)." },
      ],
    },
    {
      id: "cookies",
      heading: "Cookies",
      blocks: [
        { id: "cookies.p1", type: "p", text: "Vi sætter ingen cookies til sporing eller annoncering. Dit valg i cookie-boksen gemmes i én nødvendig cookie, broberg-consent, i op til 12 måneder. Logger du ind, sættes en teknisk cookie, der alene holder dig logget ind." },
      ],
    },
    {
      id: "aendringer",
      heading: "Ændringer",
      blocks: [
        { id: "aendringer.p1", type: "p", text: "Ændrer vi politikken, opdateres datoen og versionen øverst. Den danske udgave gælder, hvis der er forskel til en oversættelse." },
      ],
    },
  ],
};
