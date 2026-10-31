import type { ProductFacts } from "../types.js";

/**
 * The product registry — the ONLY place product-specific facts live (F110).
 * Texts turn these into sentences through fixed templates; never type a vendor
 * name into prose. Only facts we know are listed; an unknown is left out, never
 * guessed.
 */
export const PRODUCTS: ProductFacts[] = [
  {
    id: "default",
    name: "broberg.ai",
    hosting: [{ what: "Vores egne tjenester", where: "Stockholm, Sverige (EU)" }],
    dataCategories: ["Navn", "E-mailadresse", "Indhold du selv indtaster", "Tekniske oplysninger (fx IP-adresse og tidspunkt)"],
    subprocessors: [
      { name: "Fly.io", purpose: "Hosting af vores tjenester", location: "Stockholm, Sverige", transfer: "EU-US Data Privacy Framework" },
      { name: "Mistral AI", purpose: "AI-sprogmodeller", location: "Frankrig", transfer: "Inden for EU" },
      { name: "Resend", purpose: "Afsendelse af e-mail", location: "Irland", transfer: "Data Privacy Framework + standardkontrakt" },
    ],
    conversationAnalysis: true,
    healthData: false,
  },
  {
    id: "broberg-ai",
    name: "broberg.ai",
    hosting: [
      { what: "Websitet", where: "Stockholm, Sverige (EU)" },
      { what: "AI-assistenten Aidan", where: "Paris, Frankrig (EU)" },
    ],
    dataCategories: [
      "Navn og kontaktoplysninger, du selv oplyser",
      "Indholdet af din henvendelse eller samtale med Aidan",
      "Tekniske oplysninger (IP-adresse, tidspunkt, hentet side)",
      "Anonym besøgsstatistik",
    ],
    subprocessors: [
      { name: "broberg.ai HelpDesk", purpose: "Supportsystem", location: "Stockholm, Sverige", transfer: "Samme virksomhed" },
      { name: "Mistral AI", purpose: "Sprogmodellen bag Aidan", location: "Frankrig", transfer: "Inden for EU" },
      { name: "Resend", purpose: "Afsendelse af e-mail", location: "Irland", transfer: "Data Privacy Framework + standardkontrakt" },
      { name: "Cloudflare", purpose: "Robotværn på kontaktformularen", location: "EU / globalt", transfer: "Data Privacy Framework + standardkontrakt" },
      { name: "Fly.io", purpose: "Hosting af websitet", location: "Stockholm, Sverige", transfer: "EU-US Data Privacy Framework" },
      { name: "Upmetrics", purpose: "Driftsovervågning og anonym besøgsstatistik", location: "Stockholm, Sverige", transfer: "Samme virksomhed" },
    ],
    conversationAnalysis: true,
    healthData: false,
  },
  {
    id: "jam",
    name: "Jam",
    hosting: [
      { what: "Appen", where: "Stockholm, Sverige (EU)" },
      { what: "Databasen", where: "Amsterdam, Holland (EU)" },
      { what: "Filer og billeder", where: "EU" },
      { what: "AI", where: "Paris, Frankrig (EU)" },
      { what: "Mail", where: "Irland (EU)" },
    ],
    dataCategories: [
      "Navn, e-mail og profilbillede fra login",
      "Dit indhold: Jams, samlinger, sedler og klip du selv vælger at gemme",
      "Medlemskaber og roller",
    ],
    subprocessors: [
      { name: "Fly.io", purpose: "Drift af app, database og stemmeserver", location: "Sverige og Holland", transfer: "Databehandleraftale med EU-standardkontrakter" },
      { name: "Cloudflare", purpose: "Filer og billeder (R2)", location: "EU", transfer: "Databehandleraftale med EU-standardkontrakter" },
      { name: "Mistral AI", purpose: "AI på tavlen", location: "Frankrig", transfer: "Inden for EU" },
      { name: "Resend", purpose: "Mail (invitationer, login-koder)", location: "Irland", transfer: "Databehandleraftale med EU-standardkontrakter" },
      { name: "Upmetrics", purpose: "Fejlovervågning", location: "Sverige", transfer: "Samme virksomhed" },
      { name: "BID", purpose: "Login", location: "Sverige", transfer: "Samme virksomhed" },
    ],
    conversationAnalysis: true,
    healthData: false,
  },
  {
    id: "fd-sundhed",
    name: "FysioDanmark Aalborg",
    hosting: [{ what: "Platformen", where: "Stockholm, Sverige (EU)" }],
    dataCategories: [
      "Navn og kontaktoplysninger",
      "Oplysninger om dit forløb, som du eller din behandler registrerer",
      "Helbredsoplysninger (særlig kategori — se afsnittet om analyse)",
    ],
    subprocessors: [
      { name: "Fly.io", purpose: "Hosting", location: "Stockholm, Sverige", transfer: "EU-US Data Privacy Framework" },
      { name: "Supabase", purpose: "Database og login", location: "Stockholm, Sverige", transfer: "EU's standardkontrakt" },
      { name: "Mistral AI", purpose: "AI-sprogmodeller", location: "Frankrig", transfer: "Inden for EU" },
      { name: "Resend", purpose: "Afsendelse af e-mail", location: "Irland", transfer: "Data Privacy Framework + standardkontrakt" },
      { name: "Upmetrics", purpose: "Fejlovervågning", location: "Stockholm, Sverige", transfer: "Samme virksomhed" },
    ],
    conversationAnalysis: true,
    healthData: true,
  },
];
