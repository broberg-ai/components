// F005.25 — the code + magic-link mail. What Gmail/iOS do with it can only be
// measured in a real inbox (manual AC on the card); this pins everything that
// can be pinned without one.
import { describe, expect, it } from "vitest";
import { CODE_MAIL_TEXT, codeBlock, codeMail, contrastRatio } from "../src/index";

const base = { accentColor: "#0f7391", logoWidth: 56, product: "cardmem", code: "064562" } as const;

describe("F005.25 — codeMail", () => {
  it("subject carries «kode» and the code", () => {
    const m = codeMail(base);
    expect(m.subject).toStrictEqual("Din kode til cardmem: 064562");
    expect(m.subject.toLowerCase()).toContain("kode");
  });

  it("html carries the code as CONTIGUOUS characters in one monospace element with letter-spacing", () => {
    const html = codeMail(base).html;
    const el = html.match(/<p style="([^"]*)">064562<\/p>/);
    expect(el, "the code must stand alone and unbroken in one element").not.toBeNull();
    expect(el![1]).toContain("monospace");
    expect(el![1]).toMatch(/letter-spacing:\d+px/);
    expect(html).not.toMatch(/0\s+6\s+4\s+5\s+6\s+2/);
    expect(html).not.toMatch(/<img[^>]*064562/);
  });

  it("text part has the code alone on its own line", () => {
    expect(codeMail(base).text.split("\n")).toContain("064562");
  });

  it("a magic link gives ONE button and the same link written out", () => {
    const link = "https://app.example/login?t=abc";
    const html = codeMail({ ...base, link }).html;
    expect(html.split(`href="${link}"`).length - 1).toStrictEqual(2); // button + written-out link
    expect(html).toContain(`>${link}</a>`);
    expect(html.match(/>Log ind<\/a>/g)).toHaveLength(1);
    expect(codeMail({ ...base, link }).text).toContain(link);
  });

  it("a relative or javascript: link is refused", () => {
    expect(() => codeMail({ ...base, link: "/login?t=1" })).toThrow(/absolute https/);
    expect(() => codeMail({ ...base, link: "javascript:alert(1)" })).toThrow(/absolute https/);
    expect(() => codeMail({ ...base, link: "http://app.example/x" })).toThrow(/absolute https/);
  });

  it("a code outside 4–10 letters/digits is refused", () => {
    for (const code of ["123", "12345678901", "06 45 62", "06-4562", "<b>1234</b>"]) {
      expect(() => codeMail({ ...base, code }), code).toThrow(/4–10 letters or digits/);
    }
    expect(() => codeMail({ ...base, code: "AB12CD" })).not.toThrow();
  });

  it("another long number beside the code is NAMED in warnings; none without one", () => {
    expect(codeMail(base).warnings).toStrictEqual([]);
    const w = codeMail({ ...base, product: "Kundeservice 20261025" }).warnings;
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("20261025");
  });

  it("a subject override that drops the code is refused", () => {
    expect(() => codeMail({ ...base, text: { subject: () => "Log ind" } })).toThrow(/subject must contain the code/);
  });

  it("English wording follows lang", () => {
    expect(codeMail({ ...base, lang: "en" }).subject).toStrictEqual(CODE_MAIL_TEXT.en.subject("cardmem", "064562"));
  });

  it("the code inherits the card's text colour — contrast ≥ 4.5:1 on a light AND a dark card", () => {
    expect(codeBlock("064562")).not.toMatch(/[^-]color:/);
    const light = codeMail(base).html;
    const dark = codeMail({ ...base, cardBg: "#1a1a1a" }).html;
    const pair = (html: string) => {
      const bg = html.match(/\.mc-bg-card\s*\{ background:(#[0-9a-f]{6})/i)![1]!;
      const ink = html.match(/\.mc-text\s*\{ color:(#[0-9a-f]{6})/i)![1]!;
      return contrastRatio(ink, bg)!;
    };
    expect(pair(light)).toBeGreaterThanOrEqual(4.5);
    expect(pair(dark)).toBeGreaterThanOrEqual(4.5);
  });
});
