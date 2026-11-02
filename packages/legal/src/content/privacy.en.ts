import type { DocumentSource } from "../types.js";

// F110.4 — translation of PRIVACY_DA. Ids and order mirror the Danish master exactly; Danish prevails.
export const PRIVACY_EN: DocumentSource = {
  doc: "privacy",
  locale: "en",
  title: "Privacy policy",
  version: "2026-11-02",
  effectiveFrom: "2026-11-02",
  material: false,
  draft: false,
  translationOf: { version: "2026-11-02", sourceHash: "28f73420bd8c7fa77d22b17063746e4b71c03e4395be78fdb69100bc6282c4fe" },
  sections: [
    {
      id: "dataansvarlig",
      heading: "Controller",
      blocks: [
        { id: "dataansvarlig.p1", type: "p", text: "WEB HOUSE ApS, Riberhusvej 9, 9492 Blokhus, Denmark, CVR 21221198. Contact: legal@broberg.ai." },
        { id: "dataansvarlig.p2", type: "p", text: "This policy explains which information we store, why, and for how long. It is information for you — it is not something you have to accept." },
      ],
    },
    {
      id: "oplysninger",
      heading: "Which information we process",
      blocks: [{ id: "oplysninger.facts", type: "facts", fact: "dataCategories" }],
    },
    {
      id: "formaal",
      heading: "Why we process it",
      blocks: [
        {
          id: "formaal.table",
          type: "table",
          head: ["Purpose", "Legal basis"],
          rows: [
            ["To provide the service to you", "Performance of a contract (GDPR art. 6(1)(b))"],
            ["To answer enquiries and keep the service secure", "Legitimate interest (art. 6(1)(f))"],
            ["Analysis to improve our products (see below)", "Legitimate interest (art. 6(1)(f)) after a documented balancing of interests"],
            ["Bookkeeping", "Legal obligation (art. 6(1)(c))"],
            ["Analysis of your own content, if you have said yes", "Explicit consent (art. 6(1)(a) and art. 9(2)(a))"],
          ],
        },
      ],
    },
    {
      id: "analyse",
      heading: "Analysis of conversations to improve our products",
      blocks: [
        { id: "analyse.p1", type: "p", text: "We analyse how our products are used — including conversations with our AI assistants — to fix errors, make the products easier to use, improve the quality of the automatic answers and be able to review the products afterwards." },
        {
          id: "analyse.list",
          type: "list",
          items: [
            "Usage: which screens and steps are used, where people get stuck, errors and time spent.",
            "Structure: what an enquiry is about (e.g. «asked about an exercise programme») — the content itself is removed.",
            "Anonymous figures: statistics that are only shown for groups of at least 10 people, so that no one can be singled out.",
            "Full content: your own descriptions and records — only if you have explicitly said yes, and you can always withdraw it.",
          ],
        },
        { id: "analyse.p2", type: "p", text: "Before the analysis, the information is pseudonymised: name, e-mail, phone and other direct identifiers are replaced with codes, CPR numbers are removed, and names in free text are replaced. Pseudonymised information is still personal data, and all your rights apply." },
        { id: "analyse.p3", type: "p", text: "Health information is only included in the analysis if you have given explicit consent. Otherwise it is removed before the analysis takes place." },
        { id: "analyse.p4", type: "p", text: "We do not use the analysis for marketing profiles or targeted advertising, we do not sell data, and we do not use your information to train external AI models." },
        { id: "analyse.facts", type: "facts", fact: "conversationAnalysis" },
      ],
    },
    {
      id: "opbevaring",
      heading: "How long we keep the information",
      blocks: [
        {
          id: "opbevaring.table",
          type: "table",
          head: ["Information", "How long"],
          rows: [
            ["Your account and your content", "For as long as you have the account"],
            ["The pseudonymised copy for analysis", "At most 6 months"],
            ["Anonymous statistics", "Without a time limit — they cannot be traced back to you"],
            ["Information we must keep for bookkeeping", "5 years, as the Danish Bookkeeping Act requires"],
          ],
        },
        { id: "opbevaring.p1", type: "p", text: "If you ask us to delete your information, it is done within 90 days, and from backups within a further 90 days." },
      ],
    },
    {
      id: "hvor",
      heading: "Where your information is stored",
      blocks: [{ id: "hvor.facts", type: "facts", fact: "hosting" }],
    },
    {
      id: "deling",
      heading: "Who we share information with",
      blocks: [
        { id: "deling.p1", type: "p", text: "We never sell data. We use these processors, which may only process the information on our instructions:" },
        { id: "deling.facts", type: "facts", fact: "subprocessors" },
        { id: "deling.p2", type: "p", text: "Transfers outside the EU only take place with a valid transfer mechanism, e.g. the European Commission's standard contractual clauses or the EU-US Data Privacy Framework." },
      ],
    },
    {
      id: "rettigheder",
      heading: "Your rights",
      blocks: [
        { id: "rettigheder.p1", type: "p", text: "You have the right of access, rectification, erasure, restriction of processing and data portability." },
        { id: "rettigheder.p2", type: "p", text: "You have the right to object to processing based on legitimate interest, including the analysis to improve our products (GDPR art. 21). Write to legal@broberg.ai." },
        { id: "rettigheder.p3", type: "p", text: "If you have given consent, you can always withdraw it — as easily as you gave it." },
        { id: "rettigheder.p4", type: "p", text: "You can complain to the Danish Data Protection Agency (Datatilsynet, datatilsynet.dk)." },
      ],
    },
    {
      id: "cookies",
      heading: "Cookies",
      blocks: [
        { id: "cookies.p1", type: "p", text: "We set no cookies for tracking or advertising. Your choice in the cookie box is stored in one necessary cookie, broberg-consent, for up to 12 months. If you log in, a technical cookie is set that only keeps you logged in." },
      ],
    },
    {
      id: "aendringer",
      heading: "Changes",
      blocks: [
        { id: "aendringer.p1", type: "p", text: "If we change the policy, the date and version at the top are updated. The Danish version prevails if it differs from a translation." },
      ],
    },
  ],
};
