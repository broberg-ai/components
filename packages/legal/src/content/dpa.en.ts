import type { DocumentSource } from "../types.js";

// F110.4 — translation of DPA_DA. Ids and order mirror the Danish master exactly; Danish prevails.
export const DPA_EN: DocumentSource = {
  doc: "dpa",
  locale: "en",
  title: "Data processing agreement",
  version: "2026-11-02",
  effectiveFrom: "2026-11-02",
  material: true,
  draft: false,
  translationOf: { version: "2026-11-02", sourceHash: "f010df51a1606121d196f2eb7db5937763bf7d75417ce2cc4c7da48769a1b66c" },
  sections: [
    {
      id: "parter",
      heading: "Parties",
      blocks: [
        { id: "parter.p1", type: "p", text: "The controller: {customer.name}, CVR {customer.cvr}, {customer.address}." },
        { id: "parter.p2", type: "p", text: "The processor: {provider.name}, CVR {provider.cvr}, {provider.address}." },
        { id: "parter.p3", type: "p", text: "This agreement was entered into on {contract.date} and belongs to the agreement «{contract.title}»." },
      ],
    },
    {
      id: "formaal",
      heading: "§ 1 Background and purpose",
      blocks: [
        { id: "formaal.p1", type: "p", text: "The processor processes personal data on behalf of the controller in order to deliver the services the parties have agreed. This agreement ensures that the processing complies with the General Data Protection Regulation (GDPR) and the Danish Data Protection Act." },
      ],
    },
    {
      id: "instruks",
      heading: "§ 2 Processing on instructions",
      blocks: [
        { id: "instruks.p1", type: "p", text: "The processor only processes personal data on documented instructions from the controller, unless otherwise required by EU or Danish law. If, in the processor's opinion, an instruction infringes the rules, the controller is informed immediately." },
      ],
    },
    {
      id: "fortrolighed",
      heading: "§ 3 Confidentiality",
      blocks: [
        { id: "fortrolighed.p1", type: "p", text: "Only persons who need it to deliver the service are given access to the personal data, and they are bound by confidentiality." },
      ],
    },
    {
      id: "sikkerhed",
      heading: "§ 4 Security of processing",
      blocks: [
        { id: "sikkerhed.p1", type: "p", text: "The processor takes appropriate technical and organisational measures under GDPR art. 32, including encryption in transit and at rest, access control, logging of access, backups and a plan for security incidents." },
      ],
    },
    {
      id: "underdatabehandlere",
      heading: "§ 5 Sub-processors",
      blocks: [
        { id: "underdatabehandlere.p1", type: "p", text: "The controller gives general authorisation to the sub-processors listed below. The processor gives at least 14 days' notice of changes, and the controller may object. Sub-processors are bound by the same obligations as in this agreement." },
        { id: "underdatabehandlere.facts", type: "facts", fact: "subprocessors" },
      ],
    },
    {
      id: "tredjelande",
      heading: "§ 6 Transfers to third countries",
      blocks: [
        { id: "tredjelande.p1", type: "p", text: "Transfers to countries outside the EU/EEA only take place with a valid transfer mechanism under GDPR chapter V." },
      ],
    },
    {
      id: "bistand",
      heading: "§ 7 Assistance to the controller",
      blocks: [
        { id: "bistand.p1", type: "p", text: "The processor assists the controller in fulfilling the rights of data subjects and with security, impact assessments and prior consultations, to the extent relevant to the service." },
      ],
    },
    {
      id: "brud",
      heading: "§ 8 Personal data breaches",
      blocks: [
        { id: "brud.p1", type: "p", text: "The processor notifies the controller without undue delay and no later than 24 hours after becoming aware of a breach, with the information the controller needs to report it." },
      ],
    },
    {
      id: "produktanalyse",
      heading: "§ 9 Analysis to improve the processor's products",
      blocks: [
        { id: "produktanalyse.p1", type: "p", text: "The processor may use the information in pseudonymised form to analyse and improve its products: use of the products, the structure of enquiries and anonymous statistics for groups of at least 10 people. The pseudonymised analysis copy is kept for at most 6 months. For this purpose the processor is an independent controller." },
        { id: "produktanalyse.p2", type: "p", text: "Health information and other special categories are only included if the data subject has given explicit consent." },
        { id: "produktanalyse.p3", type: "p", text: "The controller may object to this analysis in writing at any time. The objection applies from receipt. Exceptions to this are only agreed in a separate contract." },
        { id: "produktanalyse.p4", type: "p", text: "The controller informs its own users about the analysis in its privacy policy. The paragraph below can be used unchanged:" },
        { id: "produktanalyse.note", type: "note", text: "«Our vendor, {provider.name}, analyses pseudonymised information about the use of the solution in order to improve its products. Names and other direct identifiers are removed or replaced first, health information is only included with your explicit consent, and the analysis copy is kept for at most 6 months. You can object by contacting us.»" },
      ],
    },
    {
      id: "ophoer",
      heading: "§ 10 Deletion and return",
      blocks: [
        { id: "ophoer.p1", type: "p", text: "When the agreement ends, the processor deletes or returns all personal data, at the controller's choice, unless the law requires it to be kept. Backups are deleted within 90 days." },
      ],
    },
    {
      id: "revision",
      heading: "§ 11 Audit and inspection",
      blocks: [
        { id: "revision.p1", type: "p", text: "The processor makes available the information necessary to demonstrate compliance with this agreement, and allows audits after reasonable notice." },
      ],
    },
    {
      id: "varighed",
      heading: "§ 12 Entry into force, duration and governing law",
      blocks: [
        { id: "varighed.p1", type: "p", text: "This agreement applies for as long as the processor processes personal data for the controller. It is governed by Danish law, and disputes are settled by the Danish courts. The Danish version prevails if it differs from a translation." },
      ],
    },
  ],
};
