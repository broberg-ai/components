import type { DocumentSource } from "../types.js";

export const SUPPORT_DA: DocumentSource = {
  doc: "support",
  locale: "da",
  title: "Supportaftale",
  version: "2026-11-02",
  effectiveFrom: "2026-11-02",
  material: true,
  draft: false,
  sections: [
    {
      id: "parter",
      heading: "Parter",
      blocks: [
        { id: "parter.p1", type: "p", text: "Kunden: {customer.name}, CVR {customer.cvr}, {customer.address}." },
        { id: "parter.p2", type: "p", text: "Leverandøren: {provider.name}, CVR {provider.cvr}, {provider.address}." },
        { id: "parter.p3", type: "p", text: "Aftalen gælder fra {contract.startDate} og hører til aftalen «{contract.title}»." },
      ],
    },
    {
      id: "formaal",
      heading: "§ 1 Formål",
      blocks: [
        { id: "formaal.p1", type: "p", text: "Aftalen fastlægger, hvilken support leverandøren yder på de løsninger, kunden har købt, og hvor hurtigt leverandøren reagerer." },
      ],
    },
    {
      id: "omfang",
      heading: "§ 2 Hvad supporten dækker",
      blocks: [
        {
          id: "omfang.list",
          type: "list",
          items: [
            "Fejlretning i de leverede løsninger.",
            "Drift, overvågning og sikkerhedsopdateringer.",
            "Spørgsmål om brug af løsningerne.",
          ],
        },
        { id: "omfang.p1", type: "p", text: "Nyudvikling og ændringer, der ikke er fejlretning, er ikke omfattet og aftales særskilt." },
      ],
    },
    {
      id: "responstid",
      heading: "§ 3 Responstider",
      blocks: [
        {
          id: "responstid.table",
          type: "table",
          head: ["Alvor", "Eksempel", "Reaktion inden for"],
          rows: [
            ["Kritisk", "Løsningen er nede eller data er i fare", "2 timer på hverdage"],
            ["Høj", "En vigtig funktion virker ikke", "1 arbejdsdag"],
            ["Normal", "Øvrige fejl og spørgsmål", "3 arbejdsdage"],
          ],
        },
        { id: "responstid.note", type: "note", text: "Responstiderne kan aftales anderledes i aftalens bilag. Bilaget går forud for tabellen." },
      ],
    },
    {
      id: "pris",
      heading: "§ 4 Pris og betaling",
      blocks: [
        { id: "pris.p1", type: "p", text: "Prisen for supporten og timepris for arbejde uden for supporten fremgår af aftalens prisbilag." },
      ],
    },
    {
      id: "varighed",
      heading: "§ 5 Varighed og opsigelse",
      blocks: [
        { id: "varighed.p1", type: "p", text: "Aftalen løber, indtil den opsiges. Hver part kan opsige aftalen med 3 måneders varsel til udgangen af en måned, medmindre andet fremgår af aftalens bilag." },
      ],
    },
    {
      id: "ansvar",
      heading: "§ 6 Ansvar",
      blocks: [
        { id: "ansvar.p1", type: "p", text: "Leverandøren er ikke ansvarlig for indirekte tab, herunder driftstab og tabt fortjeneste. Leverandørens samlede ansvar er begrænset til det beløb, kunden har betalt for supporten i de seneste 12 måneder." },
      ],
    },
    {
      id: "data",
      heading: "§ 7 Personoplysninger",
      blocks: [
        { id: "data.p1", type: "p", text: "Behandler leverandøren personoplysninger for kunden, gælder parternes databehandleraftale." },
      ],
    },
    {
      id: "lov",
      heading: "§ 8 Lovvalg og tvister",
      blocks: [
        { id: "lov.p1", type: "p", text: "Aftalen er underlagt dansk ret. Tvister søges løst ved forhandling og afgøres ellers ved de danske domstole. Den danske udgave gælder ved forskel til en oversættelse." },
      ],
    },
  ],
};
