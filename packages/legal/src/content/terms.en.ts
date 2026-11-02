import type { DocumentSource } from "../types.js";

// F110.4 — translation of TERMS_DA. Ids and order mirror the Danish master exactly; Danish prevails.
export const TERMS_EN: DocumentSource = {
  doc: "terms",
  locale: "en",
  title: "Terms of use",
  version: "2026-11-02",
  effectiveFrom: "2026-11-02",
  material: true,
  draft: false,
  translationOf: { version: "2026-11-02", sourceHash: "87b108cb2fad683f4586e3ad7e09560c049c6a8d929a328de7b2b8a4461643f7" },
  sections: [
    {
      id: "hvem",
      heading: "Who provides the service",
      blocks: [
        { id: "hvem.p1", type: "p", text: "The service is provided by WEB HOUSE ApS, Riberhusvej 9, 9492 Blokhus, Denmark, CVR 21221198 (broberg.ai). Questions about these terms: legal@broberg.ai." },
      ],
    },
    {
      id: "accept",
      heading: "Accepting the terms",
      blocks: [
        { id: "accept.p1", type: "p", text: "By creating an account or using the service, you accept these terms." },
        { id: "accept.p2", type: "p", text: "When you sign up, we ask you to actively confirm that you accept the terms — the box is not ticked in advance. We record which version of the terms you accepted, and when." },
        { id: "accept.p3", type: "p", text: "Our privacy policy is not part of what you accept. It explains how we process your information, and on which legal basis." },
      ],
    },
    {
      id: "brug",
      heading: "Use the service responsibly",
      blocks: [
        { id: "brug.p1", type: "p", text: "You may only put content into the service that you have the right to use, and you may not use the service for unlawful, infringing or harmful content. We may close an account that is misused." },
      ],
    },
    {
      id: "indhold",
      heading: "Your content",
      blocks: [
        { id: "indhold.p1", type: "p", text: "You own the content you put into the service. We use it to provide the service to you and to the people you share with, and as described in the privacy policy." },
      ],
    },
    {
      id: "ai",
      heading: "AI in the service",
      blocks: [
        { id: "ai.p1", type: "p", text: "Answers and suggestions from AI may be wrong. The AI suggests — you decide. Do not use AI answers as the only basis for important decisions." },
      ],
    },
    {
      id: "ansvar",
      heading: "Liability",
      blocks: [
        { id: "ansvar.p1", type: "p", text: "We provide the service with care, but cannot guarantee that it is always available or free of errors. We are not liable for indirect loss. This limitation of liability does not apply where mandatory law provides otherwise." },
      ],
    },
    {
      id: "aendringer",
      heading: "Changes to the terms",
      blocks: [
        { id: "aendringer.p1", type: "p", text: "If we make material changes, we ask you to accept the terms again. We announce minor changes in the service, and continued use after the announcement means that you accept them. The date and version at the top show the version in force." },
      ],
    },
    {
      id: "lov",
      heading: "Governing law and language",
      blocks: [
        { id: "lov.p1", type: "p", text: "These terms are governed by Danish law, and disputes are settled by the Danish courts. If the Danish version and a translated version differ, the Danish version prevails." },
      ],
    },
  ],
};
