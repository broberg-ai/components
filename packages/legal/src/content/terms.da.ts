import type { DocumentSource } from "../types.js";

export const TERMS_DA: DocumentSource = {
  doc: "terms",
  locale: "da",
  title: "Vilkår for brug",
  version: "2026-11-01",
  effectiveFrom: "2026-11-01",
  material: true,
  draft: true,
  sections: [
    {
      id: "hvem",
      heading: "Hvem leverer tjenesten",
      blocks: [
        { id: "hvem.p1", type: "p", text: "Tjenesten leveres af WEB HOUSE ApS, Riberhusvej 9, 9492 Blokhus, CVR 21221198 (broberg.ai). Spørgsmål til vilkårene: legal@broberg.ai." },
      ],
    },
    {
      id: "accept",
      heading: "Accept af vilkårene",
      blocks: [
        { id: "accept.p1", type: "p", text: "Når du opretter en konto eller bruger tjenesten, accepterer du disse vilkår." },
        { id: "accept.p2", type: "p", text: "Ved oprettelse beder vi dig aktivt bekræfte, at du accepterer vilkårene — feltet er ikke afkrydset på forhånd. Vi gemmer, hvilken version af vilkårene du har accepteret, og hvornår." },
        { id: "accept.p3", type: "p", text: "Vores privatlivspolitik er ikke en del af det, du accepterer. Den fortæller, hvordan vi behandler dine oplysninger, og på hvilket retsgrundlag." },
      ],
    },
    {
      id: "brug",
      heading: "Brug tjenesten ordentligt",
      blocks: [
        { id: "brug.p1", type: "p", text: "Du må kun lægge indhold i tjenesten, som du har ret til at bruge, og du må ikke bruge tjenesten til ulovligt, krænkende eller skadeligt indhold. Vi kan lukke en konto, der misbruges." },
      ],
    },
    {
      id: "indhold",
      heading: "Dit indhold",
      blocks: [
        { id: "indhold.p1", type: "p", text: "Du ejer det indhold, du lægger i tjenesten. Vi bruger det til at levere tjenesten til dig og dem, du deler med, og som beskrevet i privatlivspolitikken, herunder pseudonymiseret analyse for at forbedre vores produkter." },
      ],
    },
    {
      id: "ai",
      heading: "AI i tjenesten",
      blocks: [
        { id: "ai.p1", type: "p", text: "Svar og forslag fra AI kan være forkerte. AI'en foreslår — du beslutter. Brug ikke AI-svar som eneste grundlag for vigtige beslutninger." },
      ],
    },
    {
      id: "ansvar",
      heading: "Ansvar",
      blocks: [
        { id: "ansvar.p1", type: "p", text: "Vi leverer tjenesten med omhu, men kan ikke garantere, at den altid er tilgængelig eller fejlfri. Vi er ikke ansvarlige for indirekte tab. Ansvarsbegrænsningen gælder ikke, hvor ufravigelig lovgivning siger andet." },
      ],
    },
    {
      id: "aendringer",
      heading: "Ændringer af vilkårene",
      blocks: [
        { id: "aendringer.p1", type: "p", text: "Ved væsentlige ændringer beder vi dig acceptere vilkårene igen. Mindre ændringer meddeler vi i tjenesten, og fortsat brug efter meddelelsen betyder, at du accepterer dem. Datoen og versionen øverst viser den gældende udgave." },
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
