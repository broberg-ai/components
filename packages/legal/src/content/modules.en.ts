import type { DocumentSource } from "../types.js";

// F110.17 — English translation of MODULES_DA, block for block. Danish prevails.
export const MODULES_EN: DocumentSource = {
  doc: "modules",
  locale: "en",
  title: "Terms for module owners and developers",
  version: "2026-11-05",
  effectiveFrom: "2026-11-05",
  material: true,
  draft: false,
  translationOf: { version: "2026-11-05", sourceHash: "87ccbe3b82cec2621b15e178980adb3f1da3c1be80511d5e2e9129f6704ffdad" },
  sections: [
    {
      id: "hvem",
      heading: "Who these terms apply to",
      blocks: [
        { id: "hvem.p1", type: "p", text: "These terms apply to you if you publish a module on the platform as a clinic or a developer (a «module owner»). They apply together with the platform's general terms. Where the two differ, these terms take precedence in everything that concerns modules." },
      ],
    },
    {
      id: "ansvar",
      heading: "The platform's responsibility and yours",
      blocks: [
        { id: "ansvar.p1", type: "p", text: "The platform is responsible for keeping the platform stable and secure for every clinic and its patients. That is why we may act on a module that breaks these terms or the guidelines, as described below." },
        { id: "ansvar.p2", type: "p", text: "You are responsible for your module: that it works as described, that it complies with the guidelines and the law, and that you fix its errors." },
      ],
    },
    {
      id: "retningslinjer",
      heading: "Guidelines",
      blocks: [
        { id: "retningslinjer.p1", type: "p", text: "The guidelines for modules are public and apply equally to every module, including the platform's own. Their address is in the table under «Figures and deadlines»." },
        { id: "retningslinjer.p2", type: "p", text: "We change the guidelines only with the notice stated in the table. A change required by law, or one that fixes an urgent security problem, may apply at once." },
      ],
    },
    {
      id: "trappe",
      heading: "When a module breaks the guidelines",
      blocks: [
        { id: "trappe.p1", type: "p", text: "As a rule we follow four steps, and we only move to the next step if the problem is not solved:" },
        {
          id: "trappe.list",
          type: "list",
          items: [
            "Notice: we tell you about the problem.",
            "Warning: we describe what must be fixed and give you the deadline in the table.",
            "Pause: the module is paused until the problem is solved.",
            "Removal: the module is removed from the platform.",
          ],
        },
        { id: "trappe.p2", type: "p", text: "We always tell you which step we are at, and why." },
      ],
    },
    {
      id: "alvorligt",
      heading: "Immediate pause in serious cases",
      blocks: [
        { id: "alvorligt.p1", type: "p", text: "In serious cases we may pause a module at once, without the earlier steps. This applies when the module:" },
        {
          id: "alvorligt.list",
          type: "list",
          items: [
            "puts patients' or clinics' data at risk,",
            "has a security hole,",
            "makes the platform or other modules unstable, or",
            "contains or spreads illegal content.",
          ],
        },
        { id: "alvorligt.p2", type: "p", text: "A person at our end always assesses the case before a module is paused. We contact you at once and tell you why." },
      ],
    },
    {
      id: "pause",
      heading: "While a module is paused",
      blocks: [
        {
          id: "pause.list",
          type: "list",
          items: [
            "The data the module has stored is kept and can be exported.",
            "Clinics do not pay for the module while it is paused.",
            "We tell the clinics that use the module about the pause.",
          ],
        },
      ],
    },
    {
      id: "genoptag",
      heading: "Resuming",
      blocks: [
        { id: "genoptag.p1", type: "p", text: "When the cause has been fixed and we have checked it, we resume the module and tell you and the clinics." },
      ],
    },
    {
      id: "fjern",
      heading: "Removal",
      blocks: [
        { id: "fjern.p1", type: "p", text: "If we remove a module, its data can be exported within the deadline in the table. After that it is deleted." },
      ],
    },
    {
      id: "klage",
      heading: "Complaints",
      blocks: [
        { id: "klage.p1", type: "p", text: "If you disagree with a decision about your module, you can complain through the channel in the table. We answer within the response time stated there." },
      ],
    },
    {
      id: "log",
      heading: "Everything is recorded",
      blocks: [
        { id: "log.p1", type: "p", text: "Every step, whether notice, warning, pause, resumption or removal, is recorded with the time, the reason and who made the decision. You can have the records for your module." },
      ],
    },
    {
      id: "penge",
      heading: "Payment and distribution",
      blocks: [
        { id: "penge.p1", type: "p", text: "When a clinic pays for your module, the amount is divided as shown in the table. The payment is handled by the payment provider in the table, and your share is paid out at the rhythm stated there." },
      ],
    },
    {
      id: "tal",
      heading: "Figures and deadlines",
      blocks: [{ id: "tal.facts", type: "facts", fact: "moduleTerms" }],
    },
    {
      id: "aendring",
      heading: "Changes to these terms",
      blocks: [
        { id: "aendring.p1", type: "p", text: "If we change these terms materially, we ask you to accept them again before they apply to you. Your acceptance is recorded on your BID account." },
      ],
    },
    {
      id: "lov",
      heading: "Governing law and language",
      blocks: [
        { id: "lov.p1", type: "p", text: "These terms are governed by Danish law, and disputes are settled by the Danish courts. If the Danish and a translated version differ, the Danish version prevails." },
      ],
    },
  ],
};
