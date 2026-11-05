import type { ProductFacts } from "../types.js";

/**
 * F110.14 — an EXAMPLE of the facts a product fills in itself. components keeps
 * no registry of the fleet's products (owner 1/11 2026: «du skal IKKE lave en
 * udgave til hver consumer det skal de selv gøre»). Each product passes its OWN
 * ProductFacts to getDocument / resolveTemplate. Facts are data, never prose:
 * they become text only through the fixed per-locale templates.
 */
export const EXAMPLE_FACTS: ProductFacts =
{
  id: "example",
  name: "Eksempel-produktet",
  hosting: [{ what: "Vores egne tjenester", where: "Stockholm, Sverige (EU)" }],
  dataCategories: ["Navn", "E-mailadresse", "Indhold du selv indtaster", "Tekniske oplysninger (fx IP-adresse og tidspunkt)"],
  subprocessors: [
    { name: "Fly.io", purpose: "Hosting af vores tjenester", location: "Stockholm, Sverige", transfer: "EU-US Data Privacy Framework" },
    { name: "Mistral AI", purpose: "AI-sprogmodeller", location: "Frankrig", transfer: "Inden for EU" },
    { name: "Resend", purpose: "Afsendelse af e-mail", location: "Irland", transfer: "Data Privacy Framework + standardkontrakt" },
  ],
  conversationAnalysis: true,
  healthData: false,
  // F110.17 — only a platform with third-party modules sets this. EXAMPLE numbers, not anyone's real terms.
  modules: {
    revenueShare: [{ party: "platformen", percent: 30 }, { party: "modulejeren", percent: 70 }],
    operationsFee: "Et fast månedligt beløb pr. modul pr. klinik",
    paymentProvider: "Eksempel-betalingsudbyderen",
    payoutCadence: "månedligt",
    guidelinesNoticeDays: 30,
    warningDeadlineDays: 14,
    guidelinesUrl: "https://example.test/retningslinjer",
    complaints: "klage@example.test",
    complaintsResponse: "3 hverdage",
    exportDays: 30,
  },
};
