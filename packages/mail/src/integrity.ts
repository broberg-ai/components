// @broberg/mail/integrity — nothing broken leaves the house.
//
// THREE PRODUCTION DEFECTS, measured by sanne on a PAYING CUSTOMER in two days,
// and the reason this sits in send() rather than in a template check: NONE of
// them originated in a template.
//
//   1  href="/da/shop/…"        valid on a web page, dead in a mail. Outlook read
//                               it as a file path: "Den angivne fil blev ikke
//                               fundet". Click-throughs lost for months.
//   2  subject "{{subject}}"    the template was fine; the CALLER did not supply
//                               the key.
//   3  cid: with no attachment  a script grabbed the transport directly and
//                               skipped the function that attaches the logo.
//
// So a per-template check misses all three. The check has to stand where the
// FINISHED content and the REAL attachments exist at the same moment.
//
// AND THE FAILURE MODE HERE IS OVER-REJECTION, NOT UNDER-REJECTION. sanne
// previously shipped a guard that rewrote `mailto:` and `tel:` to `#` — it broke
// the two links a customer needs most. A guard that rejects too much gets
// switched off, and then it protects nothing. Every check below therefore has
// its passing cases asserted by name, not only its failing ones.

import type { MailAttachment, MailMessage } from "./index.js";

/** Which check produced a finding. */
export type IntegrityCheck = "links" | "placeholders" | "attachments";

export interface IntegrityFinding {
  check: IntegrityCheck;
  /** Where in the message, so a reader can go and look. */
  where: "subject" | "html" | "text";
  /** The offending value, verbatim — never a summary of it. */
  value: string;
  /** What it does to the recipient, not what rule it broke. */
  consequence: string;
}

/** A check we did NOT run, and why. Never merged with "found nothing". */
export interface IntegritySkip {
  check: IntegrityCheck;
  reason: string;
}

export interface IntegrityReport {
  /** The checks that actually ran. */
  checked: IntegrityCheck[];
  /**
   * The checks that did NOT run, each with its reason.
   *
   * THIS IS THE FIELD THAT KEEPS THE REPORT HONEST. "found nothing" and "could
   * not look" are opposite facts, and a report that renders them the same is
   * this package's own recurring defect one layer up. An empty `findings` with
   * a non-empty `skipped` is NOT a clean bill of health.
   */
  skipped: IntegritySkip[];
  findings: IntegrityFinding[];
}

/**
 * Schemes that are correct in a mail and must NEVER be flagged.
 *
 * `mailto:` and `tel:` are on this list because sanne's own guard broke exactly
 * those two. `#` is a same-document anchor; `//` inherits the scheme, which is
 * unusual in mail but not broken; `data:` and `cid:` are inline content.
 */
const SAFE_LINK = /^(?:https?:|mailto:|tel:|sms:|cid:|data:|#|\/\/)/i;

/** `href="…"` / `href='…'` / bare `href=…`, in whatever order the HTML happens to be. */
const HREF = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/**
 * `{{ anything }}` — an unfilled placeholder the caller never supplied.
 *
 * NO `\s*` AFTER THE BRACES, and that is not tidying. `\s` is a subset of
 * `[^}]`, so `\{\{\s*[^}]*` gives the engine two ways to split the same
 * whitespace run — and on a body with an UNCLOSED `{{` it tries all of them.
 * Measured on the first version of this file:
 *
 *     "{{" + " ".repeat(n)      n=2 000    5 ms     n=8 000   104 ms
 *                               n=20 000 583 ms  →  n=200 000 ≈ a minute
 *
 * That is a send() that stops answering, and any consumer interpolating user
 * text into a body can be handed those characters. Dropping `\s*` accepts
 * exactly the same strings — verified over the whitespace, empty, multi-line
 * and unclosed cases — and runs in 0 ms on all of the above.
 */
const PLACEHOLDER = /\{\{[^}]*\}\}/g;

/** `src="cid:sa-logo"` and every other form a content-id reference takes. */
const CID_REF = /\bcid:([A-Za-z0-9._@+-]+)/gi;

function hrefsIn(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(HREF)) out.push((m[1] ?? m[2] ?? m[3] ?? "").trim());
  return out;
}

/**
 * Check a finished message for the three defects that reached a real customer.
 *
 * PURE — no I/O, no provider, no config. It answers what it can and says what it
 * could not look at; the caller decides whether that blocks a send.
 */
export function checkMailIntegrity(
  message: Pick<MailMessage, "subject" | "html" | "text" | "attachments">,
): IntegrityReport {
  const findings: IntegrityFinding[] = [];
  const checked: IntegrityCheck[] = [];
  const skipped: IntegritySkip[] = [];

  const html = typeof message.html === "string" ? message.html : "";
  const text = typeof message.text === "string" ? message.text : "";
  const subject = typeof message.subject === "string" ? message.subject : "";
  const attachments: MailAttachment[] = message.attachments ?? [];

  // ── links ────────────────────────────────────────────────────────────────
  if (!html) {
    skipped.push({ check: "links", reason: "no html body — there are no links to read" });
  } else if (!html.includes("<")) {
    // Not a parse failure we can detect properly — we are not a parser and must
    // not claim to be. But a "html" with no tag in it at all is a caller who
    // passed plain text, and reporting that as CLEAN would be the false green
    // this field exists to prevent.
    skipped.push({ check: "links", reason: "html contains no markup — passed as plain text?" });
  } else {
    checked.push("links");
    for (const href of hrefsIn(html)) {
      if (!href || SAFE_LINK.test(href)) continue;
      findings.push({
        check: "links",
        where: "html",
        value: href,
        consequence:
          "a relative link has no domain to resolve against in a mail — Outlook reads it as a file path and the click is lost",
      });
    }
  }

  // ── placeholders ─────────────────────────────────────────────────────────
  // Runs on whatever exists. A text-only mail is a perfectly ordinary mail and
  // its subject can still arrive as "{{subject}}".
  if (!subject && !html && !text) {
    skipped.push({ check: "placeholders", reason: "message has no subject, html or text" });
  } else {
    checked.push("placeholders");
    for (const [where, body] of [
      ["subject", subject],
      ["html", html],
      ["text", text],
    ] as const) {
      if (!body) continue;
      for (const m of body.matchAll(PLACEHOLDER)) {
        findings.push({
          check: "placeholders",
          where,
          value: m[0],
          consequence: "the recipient receives the placeholder itself — the caller never supplied the key",
        });
      }
    }
  }

  // ── attachments ──────────────────────────────────────────────────────────
  if (!html) {
    skipped.push({ check: "attachments", reason: "no html body — there are no cid: references to resolve" });
  } else {
    checked.push("attachments");
    const ids = new Set(attachments.map((a) => a.contentId).filter((v): v is string => !!v));
    for (const m of html.matchAll(CID_REF)) {
      const id = m[1]!;
      if (ids.has(id)) continue;
      findings.push({
        check: "attachments",
        where: "html",
        value: `cid:${id}`,
        // A MISTYPED id and a MISSING attachment produce the identical broken
        // square, and the code reads as if everything is wired in both cases.
        consequence:
          ids.size > 0
            ? `no attachment has contentId "${id}" (present: ${[...ids].join(", ")}) — the recipient sees a broken image`
            : "no attachment carries this contentId — the recipient sees a broken image",
      });
    }
  }

  return { checked, skipped, findings };
}

/** One line a human can act on. Empty string when there is nothing to say. */
export function describeIntegrity(report: IntegrityReport): string {
  const parts: string[] = [];
  for (const f of report.findings) parts.push(`${f.check}/${f.where}: ${f.value} — ${f.consequence}`);
  // Said even when there are no findings: a check that did not run is not a
  // check that passed.
  for (const s of report.skipped) parts.push(`${s.check}: NOT CHECKED (${s.reason})`);
  return parts.join(" · ");
}
