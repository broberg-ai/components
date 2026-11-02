import type { DocumentSource } from "../types.js";

// F110.4 — translation of SUPPORT_DA. Ids and order mirror the Danish master exactly; Danish prevails.
export const SUPPORT_EN: DocumentSource = {
  doc: "support",
  locale: "en",
  title: "Support agreement",
  version: "2026-11-02",
  effectiveFrom: "2026-11-02",
  material: true,
  draft: false,
  translationOf: { version: "2026-11-02", sourceHash: "26adb8f1722904362334dc711fd7414456fb3613383cb370f8f3831bb3168a68" },
  sections: [
    {
      id: "parter",
      heading: "Parties",
      blocks: [
        { id: "parter.p1", type: "p", text: "The customer: {customer.name}, CVR {customer.cvr}, {customer.address}." },
        { id: "parter.p2", type: "p", text: "The supplier: {provider.name}, CVR {provider.cvr}, {provider.address}." },
        { id: "parter.p3", type: "p", text: "This agreement applies from {contract.startDate} and belongs to the agreement «{contract.title}»." },
      ],
    },
    {
      id: "formaal",
      heading: "§ 1 Purpose",
      blocks: [
        { id: "formaal.p1", type: "p", text: "This agreement sets out which support the supplier provides for the solutions the customer has bought, and how quickly the supplier responds." },
      ],
    },
    {
      id: "omfang",
      heading: "§ 2 What the support covers",
      blocks: [
        {
          id: "omfang.list",
          type: "list",
          items: [
            "Fixing errors in the delivered solutions.",
            "Operation, monitoring and security updates.",
            "Questions about using the solutions.",
          ],
        },
        { id: "omfang.p1", type: "p", text: "New development and changes that are not error fixes are not covered and are agreed separately." },
      ],
    },
    {
      id: "responstid",
      heading: "§ 3 Response times",
      blocks: [
        {
          id: "responstid.table",
          type: "table",
          head: ["Severity", "Example", "Response within"],
          rows: [
            ["Critical", "The solution is down or data is at risk", "2 hours on working days"],
            ["High", "An important function does not work", "1 working day"],
            ["Normal", "Other errors and questions", "3 working days"],
          ],
        },
        { id: "responstid.note", type: "note", text: "Different response times can be agreed in the agreement's appendix. The appendix takes precedence over the table." },
      ],
    },
    {
      id: "pris",
      heading: "§ 4 Price and payment",
      blocks: [
        { id: "pris.p1", type: "p", text: "The price of the support and the hourly rate for work outside the support are set out in the agreement's price appendix." },
      ],
    },
    {
      id: "varighed",
      heading: "§ 5 Duration and termination",
      blocks: [
        { id: "varighed.p1", type: "p", text: "The agreement runs until it is terminated. Either party may terminate the agreement with 3 months' notice to the end of a month, unless the agreement's appendix states otherwise." },
      ],
    },
    {
      id: "ansvar",
      heading: "§ 6 Liability",
      blocks: [
        { id: "ansvar.p1", type: "p", text: "The supplier is not liable for indirect loss, including operating loss and loss of profit. The supplier's total liability is limited to the amount the customer has paid for the support in the last 12 months." },
      ],
    },
    {
      id: "data",
      heading: "§ 7 Personal data",
      blocks: [
        { id: "data.p1", type: "p", text: "If the supplier processes personal data for the customer, the parties' data processing agreement applies." },
      ],
    },
    {
      id: "lov",
      heading: "§ 8 Governing law and disputes",
      blocks: [
        { id: "lov.p1", type: "p", text: "This agreement is governed by Danish law. Disputes are sought resolved by negotiation and are otherwise settled by the Danish courts. The Danish version prevails if it differs from a translation." },
      ],
    },
  ],
};
