import { describe, it, expect } from "vitest";
import { contrastRatio, readableInk, readableAccent, cta, eyebrow, renderShell } from "../src/index";

/**
 * F023.13 — one accentColor was doing two jobs.
 *
 * Every assertion here COMPUTES the contrast from the emitted HTML rather than
 * comparing against an expected string. A snapshot would pass just as happily
 * on an illegible colour, which is the entire defect: a 1.7:1 mail renders,
 * sends, and looks like a deliberately pale style.
 */

const GOLD = "#F7BB2E";   // WebHouse, cms's brand — light
const TEAL = "#0f7391";   // our own default — dark
const CARD = "#fffffe";   // resolveColors' default card background
const FOOT = "#f4f4f5";   // resolveColors' default footer backdrop
const AA = 4.5;

/** Pull `color:#xxxxxx` out of rendered HTML. */
function colourOf(html: string, after?: string): string {
  const hay = after ? html.slice(html.indexOf(after)) : html;
  const m = /color:(#[0-9a-f]{3,8})/i.exec(hay);
  if (!m) throw new Error(`no color: found in ${hay.slice(0, 200)}`);
  return m[1]!;
}

describe("the control that decides the design: no FIXED label colour can be right", () => {
  it("white fails on gold and dark fails on teal — measured, both directions", () => {
    // This is the negative control for everything below. Without it, "the
    // derivation works" cannot be told apart from "gold happened to need dark".
    expect(contrastRatio("#ffffff", GOLD)!).toBeLessThan(AA);      // 1.74
    expect(contrastRatio("#1a1a1a", TEAL)!).toBeLessThan(AA);      // 3.22
    // …and each is fine on the other, so neither constant is safe to hardcode.
    expect(contrastRatio("#1a1a1a", GOLD)!).toBeGreaterThan(10);
    expect(contrastRatio("#ffffff", TEAL)!).toBeGreaterThan(AA);
  });

  it("relative luminance, NOT the BT.601 brightness isDark uses", () => {
    // #0078fa — an ordinary brand blue. BT.601 calls it dark, so a
    // brightness-based pick would choose WHITE (4.14); the real contrast maths
    // prefers the dark ink (4.20). Swept the whole cube in steps of 5: the two
    // disagree on 14,440 colours, so this is a REGION and not an edge case.
    //
    // My first version of this test used #808080, which sits exactly on BT.601's
    // 128 boundary and therefore gives the SAME answer both ways — the mutation
    // survived and the test looked fine. A case that cannot discriminate reads
    // exactly like a passing one.
    const BLUE = "#0078fa";
    expect(contrastRatio("#1a1a1a", BLUE)!).toBeGreaterThan(contrastRatio("#ffffff", BLUE)!);
    expect(readableInk(BLUE)).toBe("#1a1a1a");
  });

  it("contrastRatio returns null for a colour it cannot parse, rather than a number that looks measured", () => {
    expect(contrastRatio("rgb(10,20,30)", "#ffffff")).toBeNull();
    expect(contrastRatio("rebeccapurple", "#ffffff")).toBeNull();
  });
});

describe("cta() — the BACKGROUND keeps the brand, only the LABEL is derived", () => {
  it("a light brand gets a dark label, measured ≥10:1", () => {
    const html = cta("https://x.dk", "Svar til Mette", { accentColor: GOLD });
    const ratio = contrastRatio(colourOf(html, "<a "), GOLD)!;
    expect(ratio).toBeGreaterThanOrEqual(10);
    // THE CARD SAID 12:1 AND THAT NUMBER WAS PURE BLACK (12.10). The ink we
    // actually use is the shell's own #1a1a1a, which measures 10.03 — chosen
    // because a button label in a different black from every other line of the
    // mail is a visible seam for two points of contrast that are both far above
    // AA. The AC's figure was measured before the ink was picked; correcting
    // the number rather than the code, because 12 was never a requirement.
    expect(colourOf(html, "<a ")).toBe("#1a1a1a");
  });

  it("a dark brand keeps the white label, measured ≥5.4:1", () => {
    const html = cta("https://x.dk", "Åbn", { accentColor: TEAL });
    expect(colourOf(html, "<a ")).toBe("#ffffff");
    expect(contrastRatio("#ffffff", TEAL)!).toBeGreaterThan(5.4);
  });

  it("the button is still EXACTLY the brand colour — that is what cms had to give up", () => {
    const html = cta("https://x.dk", "Svar", { accentColor: GOLD });
    expect(html).toContain(`bgcolor="${GOLD}"`);
    expect(html).toContain(`background:${GOLD}`);
  });
});

describe("eyebrow() — accent used as TEXT", () => {
  it("a light brand is darkened until legible on the card", () => {
    const html = eyebrow("NY HENVENDELSE", { accentColor: GOLD });
    const colour = colourOf(html);
    expect(colour).not.toBe(GOLD);
    expect(contrastRatio(colour, CARD)!).toBeGreaterThanOrEqual(AA);
  });

  it("a dark brand is returned UNCHANGED — 4.5 is a floor, not a target", () => {
    expect(colourOf(eyebrow("X", { accentColor: TEAL }))).toBe(TEAL);
  });

  it("the derived colour keeps the brand's hue: the channel RATIOS survive", () => {
    // Scaling all three channels by one factor preserves hue and saturation.
    // A gold that came back legible but no longer gold would pass every
    // contrast assertion in this file and be useless.
    //
    // ORDER (r>g>b) is too weak and the mutation harness proved it: dropping the
    // blue channel from the scaling left the order intact, so the test stayed
    // green while the hue shifted. RATIOS are the property that actually holds.
    const src = [247, 187, 46];                      // #F7BB2E
    const c = colourOf(eyebrow("X", { accentColor: GOLD })).slice(1);
    const got = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
    const k = got[0]! / src[0]!;                     // the scale factor it chose
    expect(got[1]!).toBeCloseTo(src[1]! * k, -0.5);  // ±~1.5 for integer rounding
    expect(got[2]!).toBeCloseTo(src[2]! * k, -0.5);
    expect(k).toBeLessThan(1);                       // and it really did darken
  });

  it("measures against the surface it is GIVEN, not against white", () => {
    // A colour can clear AA on the card and fail on a darker surface. If the
    // function ignored `surface`, these two would return the same value.
    const onCard = colourOf(eyebrow("X", { accentColor: GOLD, surface: CARD }));
    const onDark = colourOf(eyebrow("X", { accentColor: GOLD, surface: "#101010" }));
    expect(onCard).not.toBe(onDark);
    expect(contrastRatio(onDark, "#101010")!).toBeGreaterThanOrEqual(AA);
  });
});

describe("renderShell — SURFACE and TEXT part company", () => {
  const shell = (accent: string) =>
    renderShell({
      subject: "s", accentColor: accent, bodyHtml: "<p>x</p>",
      footerLines: ["a"], footerHref: "https://webhouse.dk", footerLabel: "webhouse.dk",
    } as never);

  it("the top bar keeps the RAW brand colour even when the brand is light", () => {
    expect(shell(GOLD)).toContain(`bgcolor="${GOLD}"`);
  });

  it("the footer link is derived and measured against #f4f4f5 — NOT against white", () => {
    const colour = colourOf(shell(GOLD), "https://webhouse.dk");
    expect(contrastRatio(colour, FOOT)!).toBeGreaterThanOrEqual(AA);
  });

  it("a colour that clears AA on WHITE but not on #f4f4f5 is still adjusted", () => {
    // The detail that cost cms a round, as a case rather than a comment.
    // #767676 measures 4.54 on white and 4.13 on the footer's backdrop. A
    // function that took white as a stand-in would leave it alone and ship an
    // illegible footer link. My first attempt at this assertion was inverted
    // and passed for the wrong reason; this one names the colour.
    expect(contrastRatio("#767676", "#ffffff")!).toBeGreaterThan(AA);
    expect(contrastRatio("#767676", FOOT)!).toBeLessThan(AA);
    const colour = colourOf(shell("#767676"), "https://webhouse.dk");
    expect(colour).not.toBe("#767676");
    expect(contrastRatio(colour, FOOT)!).toBeGreaterThanOrEqual(AA);
  });

  it("a DARK footer backdrop lightens the accent instead of darkening it", () => {
    // Our own dark shell measured 3.52:1 on the footer link with our own default
    // teal — already failing before this card existed. A "darken until legible"
    // helper would have been right for cms and wrong for us.
    const html = renderShell({
      subject: "s", accentColor: TEAL, cardBg: "#1a1a1a", backdropColor: "#101010",
      bodyHtml: "<p>x</p>", footerLines: ["a"], footerHref: "https://x.dk",
    } as never);
    const colour = colourOf(html, "https://x.dk");
    expect(contrastRatio(colour, "#101010")!).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(colour, "#101010")!).toBeGreaterThan(contrastRatio(TEAL, "#101010")!);
  });
});

describe("nothing moves for a brand that was already legible", () => {
  it("every teal render is untouched: the accent appears verbatim as text AND as surface", () => {
    const html = renderShell({
      subject: "s", accentColor: TEAL, bodyHtml: "<p>x</p>",
      footerLines: ["a"], footerHref: "https://x.dk",
    } as never);
    expect(html).toContain(`bgcolor="${TEAL}"`);
    expect(html).toContain(`color:${TEAL};text-decoration:none`);
    expect(colourOf(cta("https://x.dk", "Åbn", { accentColor: TEAL }), "<a ")).toBe("#ffffff");
  });

  it("readableAccent is a NO-OP above the floor, byte-for-byte", () => {
    expect(readableAccent(TEAL, FOOT)).toBe(TEAL);
    expect(readableAccent(TEAL, CARD)).toBe(TEAL);
    expect(readableAccent("#1a1a1a", CARD)).toBe("#1a1a1a");
  });

  it("a colour we cannot parse is left ALONE rather than half-adjusted", () => {
    expect(readableAccent("rgb(247,187,46)", CARD)).toBe("rgb(247,187,46)");
    expect(readableInk("rgb(247,187,46)")).toBe("#ffffff"); // today's behaviour, unchanged
  });
});
