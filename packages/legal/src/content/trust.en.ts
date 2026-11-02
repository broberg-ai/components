import type { DocumentSource } from "../types.js";

// F110.4 — translation of TRUST_DA. Ids and order mirror the Danish master exactly; Danish prevails.
export const TRUST_EN: DocumentSource = {
  doc: "trust",
  locale: "en",
  title: "Trust and security",
  version: "2026-11-02",
  effectiveFrom: "2026-11-02",
  material: false,
  draft: false,
  translationOf: { version: "2026-11-02", sourceHash: "5f8763449ddd0b969a35c5b2a2e3af2165d2514935fbcbaaaba67100e03a54e4" },
  sections: [
    {
      id: "kort",
      heading: "In short",
      blocks: [
        { id: "kort.p1", type: "p", text: "This page explains where your data is stored, which vendors process data for us, and how we protect it. We only say that something is in place when it is true today." },
      ],
    },
    {
      id: "hvor",
      heading: "Where your data is stored",
      blocks: [{ id: "hvor.facts", type: "facts", fact: "hosting" }],
    },
    {
      id: "sikkerhed",
      heading: "Security",
      blocks: [
        {
          id: "sikkerhed.table",
          type: "table",
          head: ["Control", "What it means"],
          rows: [
            ["Encryption", "All traffic is encrypted (HTTPS/TLS), and data is encrypted where it is stored."],
            ["Login", "Single sign-on with passkeys and two-factor authentication."],
            ["Security incidents", "If we process data for you, you hear from us within 24 hours. The Danish Data Protection Agency is notified within 72 hours when we are the controller."],
            ["Backups", "Daily backups, kept for 30 days."],
            ["Access", "Only named employees have access to raw data, and access is logged."],
          ],
        },
      ],
    },
    {
      id: "leverandoerer",
      heading: "Vendors that process data for us",
      blocks: [
        { id: "leverandoerer.facts", type: "facts", fact: "subprocessors" },
        { id: "leverandoerer.p1", type: "p", text: "New vendors are added to the list when we start using them. Customers with a data processing agreement are notified at least 14 days in advance." },
      ],
    },
    {
      id: "kontakt",
      heading: "Found a security problem?",
      blocks: [
        { id: "kontakt.p1", type: "p", text: "Write to security@broberg.ai. We reply within one working day." },
      ],
    },
  ],
};
