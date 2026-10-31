import type { DocumentSource } from "../types.js";

export const TRUST_DA: DocumentSource = {
  doc: "trust",
  locale: "da",
  title: "Tillid og sikkerhed",
  version: "2026-11-01",
  effectiveFrom: "2026-11-01",
  material: false,
  draft: true,
  sections: [
    {
      id: "kort",
      heading: "Kort fortalt",
      blocks: [
        { id: "kort.p1", type: "p", text: "Her står, hvor dine data ligger, hvilke leverandører der behandler data for os, og hvordan vi passer på dem. Vi skriver kun, at noget er på plads, når det er sandt i dag." },
      ],
    },
    {
      id: "hvor",
      heading: "Hvor dine data ligger",
      blocks: [{ id: "hvor.facts", type: "facts", fact: "hosting" }],
    },
    {
      id: "sikkerhed",
      heading: "Sikkerhed",
      blocks: [
        {
          id: "sikkerhed.table",
          type: "table",
          head: ["Kontrol", "Hvad det betyder"],
          rows: [
            ["Kryptering", "Al trafik er krypteret (HTTPS/TLS), og data er krypteret, hvor de opbevares."],
            ["Login", "Samlet login med passkeys og to-faktor."],
            ["Sikkerhedshændelser", "Behandler vi data for dig, hører du fra os inden for 24 timer. Datatilsynet får besked inden 72 timer, når vi er dataansvarlige."],
            ["Sikkerhedskopier", "Daglige kopier, som gemmes i 30 dage."],
            ["Adgang", "Kun navngivne medarbejdere har adgang til rå data, og adgangen logges."],
          ],
        },
      ],
    },
    {
      id: "leverandoerer",
      heading: "Leverandører der behandler data for os",
      blocks: [
        { id: "leverandoerer.facts", type: "facts", fact: "subprocessors" },
        { id: "leverandoerer.p1", type: "p", text: "Nye leverandører kommer på listen, når vi tager dem i brug. Kunder med databehandleraftale får besked mindst 14 dage før." },
      ],
    },
    {
      id: "kontakt",
      heading: "Fundet et sikkerhedsproblem?",
      blocks: [
        { id: "kontakt.p1", type: "p", text: "Skriv til security@broberg.ai. Vi svarer inden for én arbejdsdag." },
      ],
    },
  ],
};
