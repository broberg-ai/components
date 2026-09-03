import { describe, expect, it } from "vitest";
import {
  assertColor, assertFontStack, cta, eyebrow, factBox, heading, noteBox, renderShell, signOff,
} from "../src/index";

/** F023.9 — a brand value could inject markup into a transactional mail.
 *  The two payloads below are VERBATIM the ones proven against the built
 *  package on 2026-09-03; paraphrasing them would test a different string. */
const BREAKOUT = `#0f7391" onmouseover="alert(1)" x="`;
const TAG_INJECTION =
  `#fff;"></td></tr></table><a href="https://phish.example">Log ind her</a><table><tr><td x="`;

const shell = (over: Record<string, unknown>) =>
  renderShell({ subject: "s", accentColor: "#0f7391", bodyHtml: "<p>x</p>", ...over } as never);

describe("the proven payloads are REJECTED (AC#0)", () => {
  it("the attribute breakout throws, naming the field", () => {
    expect(() => shell({ accentColor: BREAKOUT })).toThrow(/accentColor/);
  });

  it("the full tag injection throws", () => {
    expect(() => shell({ accentColor: TAG_INJECTION })).toThrow(/accentColor/);
  });

  it("and the injection genuinely reached the output before the guard", () => {
    // Without this the two tests above pass against a guard that rejects
    // everything, and prove nothing about the attack. Assert the payload IS
    // dangerous: unescaped, it closes the attribute and opens an anchor.
    expect(TAG_INJECTION).toContain(`<a href="https://phish.example">`);
    expect(BREAKOUT).toContain(`" onmouseover=`);
  });
});

describe("legitimate values still pass — the negative control (AC#1)", () => {
  // Without this, a reject-everything stub scores identically to a correct guard.
  const ok = ["#0f7391", "#fff", "#0f7391cc", "#abcd", "rgb(15,115,145)", "rgba(0,0,0,.5)",
    "hsl(190,80%,31%)", "hsla(190,80%,31%,0.4)", "rebeccapurple", "transparent", "  #0f7391  "];
  for (const v of ok) {
    it(`accepts ${JSON.stringify(v)}`, () => {
      expect(() => assertColor("accentColor", v)).not.toThrow();
      expect(() => shell({ accentColor: v })).not.toThrow();
    });
  }
  it("an omitted optional colour is not an error", () => {
    expect(() => assertColor("cardBg", undefined)).not.toThrow();
  });
});

describe("every brand field is covered, driven by NAME not by line number (AC#2)", () => {
  // A hand-written list of call sites goes stale the next time the file is
  // edited, and staleness here reads as coverage.
  for (const field of ["accentColor", "cardBg", "textColor", "backdropColor"]) {
    it(`${field} rejects the payload`, () => {
      expect(() => shell({ [field]: BREAKOUT })).toThrow(new RegExp(field));
    });
  }
  for (const field of ["fontSans", "fontSerif"]) {
    it(`${field} rejects a tag delimiter`, () => {
      expect(() => shell({ [field]: `Arial"><script>x</script>` })).toThrow(new RegExp(field));
    });
  }
});

describe("the standalone primitives are guarded too (AC#2)", () => {
  it("eyebrow", () => expect(() => eyebrow("t", { accentColor: BREAKOUT })).toThrow(/accentColor/));
  it("noteBox", () => expect(() => noteBox("t", { accentColor: BREAKOUT })).toThrow(/accentColor/));
  it("cta", () => expect(() => cta("https://x.dk", "t", { accentColor: BREAKOUT })).toThrow(/accentColor/));
  it("factBox", () => expect(() => factBox([{ label: "a", value: "b" }], { accentColor: BREAKOUT })).toThrow(/accentColor/));
  it("heading", () => expect(() => heading("t", { accentColor: BREAKOUT })).toThrow(/accentColor/));
  it("signOff's cardBg", () => expect(() => signOff([{ text: "t" }], { cardBg: BREAKOUT })).toThrow(/cardBg/));
});

describe("a font stack is not a colour (AC#3)", () => {
  it("accepts a real stack, quotes and commas included", () => {
    expect(() => assertFontStack("fontSans", "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif")).not.toThrow();
    expect(() => assertFontStack("fontSerif", "Georgia,'Times New Roman',serif")).not.toThrow();
  });
  it("rejects a tag delimiter and a double quote", () => {
    expect(() => assertFontStack("fontSans", "Arial<b>")).toThrow(/fontSans/);
    expect(() => assertFontStack("fontSans", `Arial" onload="x`)).toThrow(/fontSans/);
  });
  it("does NOT borrow the colour grammar", () => {
    // A stack is not a colour; if the colour rule were reused here every real
    // font stack would be rejected. This is the test that catches that.
    expect(() => assertColor("x", "Georgia,'Times New Roman',serif")).toThrow();
    expect(() => assertFontStack("x", "Georgia,'Times New Roman',serif")).not.toThrow();
  });
});
