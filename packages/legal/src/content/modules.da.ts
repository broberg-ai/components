import type { DocumentSource } from "../types.js";

// F110.17 — Christian 5/11 2026: «Ja, byg vilkårene og nej de skal ikke til advokat».
// Not lawyer-reviewed by the owner's choice (the five other documents were, 2/11).
// No number is typed into the prose: every figure lives in the product's own facts
// and appears only in the «Tal og frister» table (D-2898e7).
export const MODULES_DA: DocumentSource = {
  doc: "modules",
  locale: "da",
  title: "Vilkår for modulejere og udviklere",
  version: "2026-11-05",
  effectiveFrom: "2026-11-05",
  material: true,
  draft: false,
  sections: [
    {
      id: "hvem",
      heading: "Hvem vilkårene gælder for",
      blocks: [
        { id: "hvem.p1", type: "p", text: "Vilkårene gælder for dig, der som klinik eller udvikler udgiver et modul på platformen («modulejer»). De gælder sammen med platformens almindelige vilkår. Hvor de to er forskellige, går disse vilkår forud i alt, der handler om moduler." },
      ],
    },
    {
      id: "ansvar",
      heading: "Platformens og dit ansvar",
      blocks: [
        { id: "ansvar.p1", type: "p", text: "Platformen har ansvaret for, at platformen er stabil og sikker for alle klinikker og deres patienter. Derfor har vi ret til at gribe ind over for et modul, der bryder vilkårene eller retningslinjerne, som beskrevet nedenfor." },
        { id: "ansvar.p2", type: "p", text: "Du har ansvaret for dit modul: at det virker som beskrevet, at det overholder retningslinjerne og gældende lov, og at du retter fejl i det." },
      ],
    },
    {
      id: "retningslinjer",
      heading: "Retningslinjer",
      blocks: [
        { id: "retningslinjer.p1", type: "p", text: "Retningslinjerne for moduler er offentlige og gælder ens for alle moduler, også platformens egne. Adressen står i tabellen under «Tal og frister»." },
        { id: "retningslinjer.p2", type: "p", text: "Vi ændrer kun retningslinjerne med det varsel, der står i tabellen. En ændring, som loven kræver, eller som retter et akut sikkerhedsproblem, kan gælde med det samme." },
      ],
    },
    {
      id: "trappe",
      heading: "Når et modul bryder retningslinjerne",
      blocks: [
        { id: "trappe.p1", type: "p", text: "Vi følger som udgangspunkt fire trin og går kun videre til næste trin, hvis problemet ikke bliver løst:" },
        {
          id: "trappe.list",
          type: "list",
          items: [
            "Besked: vi gør dig opmærksom på problemet.",
            "Advarsel: vi beskriver, hvad der skal rettes, og giver dig fristen i tabellen.",
            "Pause: modulet sættes på pause, indtil problemet er løst.",
            "Fjernelse: modulet fjernes fra platformen.",
          ],
        },
        { id: "trappe.p2", type: "p", text: "Vi fortæller dig altid, hvilket trin vi er på, og hvorfor." },
      ],
    },
    {
      id: "alvorligt",
      heading: "Pause med det samme i alvorlige tilfælde",
      blocks: [
        { id: "alvorligt.p1", type: "p", text: "I alvorlige tilfælde kan vi sætte et modul på pause med det samme, uden de forudgående trin. Det gælder, når modulet:" },
        {
          id: "alvorligt.list",
          type: "list",
          items: [
            "bringer patienters eller klinikkers data i fare,",
            "har et sikkerhedshul,",
            "gør platformen eller andre moduler ustabile, eller",
            "indeholder eller formidler ulovligt indhold.",
          ],
        },
        { id: "alvorligt.p2", type: "p", text: "Et menneske hos os vurderer altid sagen, før et modul sættes på pause. Vi kontakter dig straks og fortæller dig hvorfor." },
      ],
    },
    {
      id: "pause",
      heading: "Mens et modul er på pause",
      blocks: [
        {
          id: "pause.list",
          type: "list",
          items: [
            "De data, modulet har gemt, bevares og kan eksporteres.",
            "Klinikkerne betaler ikke for modulet, mens det er på pause.",
            "Vi giver de klinikker, der bruger modulet, besked om pausen.",
          ],
        },
      ],
    },
    {
      id: "genoptag",
      heading: "Genoptagelse",
      blocks: [
        { id: "genoptag.p1", type: "p", text: "Når årsagen er rettet, og vi har kontrolleret det, genoptager vi modulet og giver dig og klinikkerne besked." },
      ],
    },
    {
      id: "fjern",
      heading: "Fjernelse",
      blocks: [
        { id: "fjern.p1", type: "p", text: "Fjerner vi et modul, kan data fra modulet eksporteres inden for fristen i tabellen. Derefter slettes de." },
      ],
    },
    {
      id: "klage",
      heading: "Klage",
      blocks: [
        { id: "klage.p1", type: "p", text: "Er du uenig i en beslutning om dit modul, kan du klage via kanalen i tabellen. Vi svarer inden for den svarfrist, der står der." },
      ],
    },
    {
      id: "log",
      heading: "Alt bliver registreret",
      blocks: [
        { id: "log.p1", type: "p", text: "Hvert trin, både besked, advarsel, pause, genoptagelse og fjernelse, registreres med tidspunkt, begrundelse og hvem der traf beslutningen. Du kan få udleveret registreringerne for dit modul." },
      ],
    },
    {
      id: "penge",
      heading: "Betaling og fordeling",
      blocks: [
        { id: "penge.p1", type: "p", text: "Når en klinik betaler for dit modul, fordeles beløbet som i tabellen. Betalingen gennemføres af betalingsudbyderen i tabellen, og din andel udbetales med den rytme, der står der." },
      ],
    },
    {
      id: "tal",
      heading: "Tal og frister",
      blocks: [{ id: "tal.facts", type: "facts", fact: "moduleTerms" }],
    },
    {
      id: "aendring",
      heading: "Ændringer af vilkårene",
      blocks: [
        { id: "aendring.p1", type: "p", text: "Ændrer vi vilkårene væsentligt, beder vi dig acceptere dem igen, før de gælder for dig. Din accept registreres på din BID-konto." },
      ],
    },
    {
      id: "lov",
      heading: "Lovvalg og sprog",
      blocks: [
        { id: "lov.p1", type: "p", text: "Vilkårene er underlagt dansk ret, og tvister afgøres ved de danske domstole. Er der forskel på den danske og en oversat udgave, gælder den danske." },
      ],
    },
  ],
};
