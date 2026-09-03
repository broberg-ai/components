import { describe, expect, it } from "vitest";
import { renderShell, signOff } from "../src/index";
import legacy from "./signoff-legacy.snapshot.json";

/** The four defects vn-leker found after adopting the package, each with its own
 *  test so AC#5's "reverting one turns a DISTINCT test red" is checkable. */

describe("signOff — the legacy form is load-bearing (F023.8 AC#0)", () => {
  it("renders BYTE-IDENTICALLY to the shipped build", () => {
    // The snapshot was captured from dist/index.js as built BEFORE this change —
    // from the code three repos are calling in production mail. Regenerating it
    // from the new source would make this assert nothing.
    expect(signOff("Med venlig hilsen", "Christian Broberg", "WebHouse ApS")).toBe(legacy.normal);
  });

  it("an EMPTY sign no longer leaves a blank line and an empty styled span", () => {
    // vn-leker's negative control, and the residue is real: the old form emitted
    // `<br>\n      <span style="font-size:20px;"></span>` unconditionally. It
    // failed nowhere, which is why it survived.
    expect(legacy.emptySign).toContain(`<span style="font-size:20px;"></span>`);
    const now = signOff("a", "b", "");
    expect(now).not.toContain("font-size:20px");
    expect(now).not.toContain("<span");
    // and the two real lines are still there, in order
    expect(now.indexOf("a")).toBeGreaterThanOrEqual(0);
    expect(now.indexOf("a")).toBeLessThan(now.indexOf("b"));
  });
});

describe("signOff — three tiers, one axis each (F023.8 AC#1)", () => {
  // vn-leker's own signature: the case that reached Christian's inbox with the
  // job title rendered larger than the person.
  const sig = () =>
    signOff([
      { text: "Med venlig hilsen" },
      { text: "Christian Broberg", tier: "name" },
      { text: "CEO & Founding Partner · WebHouse ApS", tier: "meta" },
    ]);

  it("the NAME is the emphasised line, not the title", () => {
    const html = sig();
    const name = html.indexOf("Christian Broberg");
    const title = html.indexOf("CEO &amp; Founding Partner");
    // Both present first — an indexOf that returns -1 is LESS than every real
    // index, so an ordering assert alone passes hardest when a line is missing.
    expect(name).toBeGreaterThanOrEqual(0);
    expect(title).toBeGreaterThanOrEqual(0);
    expect(name).toBeLessThan(title);
    // the emphasis is ON the name
    expect(html).toContain(`<strong style="font-weight:700;">Christian Broberg</strong>`);
    // and NOT on the title
    expect(html).not.toContain(`<strong style="font-weight:700;">CEO`);
  });

  it("ORDER, not markup: the same lines mapped the old way put the title on top", () => {
    // AC#5 requires the signOff test to fail on the ORDER. This is that check:
    // the legacy form forces the big slot to the LAST argument, so the same
    // three strings render with the title emphasised.
    const forced = signOff("Med venlig hilsen", "Christian Broberg", "CEO & Founding Partner");
    expect(forced).toContain(`<span style="font-size:20px;">CEO &amp; Founding Partner</span>`);
    expect(sig()).not.toContain("font-size:20px");
  });

  it("tiers are distinguished by STYLE, not by content", () => {
    // vn-leker's suggestion: three identical strings. A test with three
    // different strings can pass merely because the lines are visibly different.
    const html = signOff([
      { text: "same" },
      { text: "same", tier: "name" },
      { text: "same", tier: "meta" },
    ]);
    expect(html).toContain(`<strong style="font-weight:700;">same</strong>`);
    expect(html).toContain(`<span style="color:#4a4d63;">same</span>`);
    // the plain one is present and carries neither
    expect(html.match(/same/g)).toHaveLength(3);
    expect(html.match(/<strong/g)).toHaveLength(1);
    expect(html.match(/<span/g)).toHaveLength(1);
  });

  it("each tier changes exactly ONE axis against lead", () => {
    // The invariant that says there is no fourth tier coming.
    // Read the LINE's own element, not the block — the wrapping <p> always
    // carries font-size:15px, so asserting on the whole string tests the wrapper.
    const lineOf = (html: string) => html.match(/<(strong|span)[^>]*>x<\/\1>/)?.[0] ?? "";
    const name = lineOf(signOff([{ text: "x", tier: "name" }]));
    const meta = lineOf(signOff([{ text: "x", tier: "meta" }]));
    expect(name).toBe(`<strong style="font-weight:700;">x</strong>`);
    expect(meta).toBe(`<span style="color:#4a4d63;">x</span>`);
    // and stated as the invariant: neither adds a second axis, neither resizes.
    expect(name).not.toContain("color:");
    expect(name).not.toContain("font-size:");
    expect(meta).not.toContain("font-weight");
    expect(meta).not.toContain("font-size:");
  });

  it("`meta` follows the CARD, not a hardcoded light value", () => {
    // The defect this catches was in the first cut of this very change: a
    // hardcoded #4a4d63 measures 2.10:1 on a #1a1a1a card, under the 4.5:1
    // floor — while the README advertises dark cards as supported. It is the
    // same defect the footer fix removed, one function away, in the same commit.
    const line = (html: string) => html.match(/<span[^>]*>t<\/span>/)?.[0] ?? "";
    const light = line(signOff([{ text: "t", tier: "meta" }]));
    const dark = line(signOff([{ text: "t", tier: "meta" }], { cardBg: "#1a1a1a" }));
    expect(light).toBe(`<span style="color:#4a4d63;">t</span>`);
    expect(dark).toBe(`<span style="color:#c1c2d1;">t</span>`);
    // and the two must actually DIFFER — without this the test passes if both
    // branches return the same value.
    expect(dark).not.toBe(light);
  });

  it("an omitted cardBg gets the light pair, matching the shell's own default", () => {
    const a = signOff([{ text: "t", tier: "meta" }]);
    const b = signOff([{ text: "t", tier: "meta" }], {});
    const c = signOff([{ text: "t", tier: "meta" }], { cardBg: "#fffffe" });
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("an omitted tier is lead — plain text, no wrapper", () => {
    expect(signOff([{ text: "plain" }])).toContain(">\n      plain\n    <");
  });
});

describe("the footer zone survives a dark-mapping client (F023.8 AC#2)", () => {
  it("is carried by an ACCENT-coloured rule, not by its fill", () => {
    // The state fd-sundhed measured in Outlook iOS: card and footer mapped to
    // the SAME colour, so any fill-based boundary stops existing. Render it that
    // way deliberately — two different colours would pass without touching the bug.
    const html = renderShell({
      subject: "s",
      accentColor: "#0f7391",
      cardBg: "#484848",
      backdropColor: "#484848",
      bodyHtml: "<p>x</p>",
      footerLines: ["WebHouse ApS"],
    } as never);
    expect(html).toContain("border-top:1px solid #0f7391");
    expect(html).not.toContain("border-top:1px solid rgba(0,0,0,0.08)");
  });
});

describe("no opacity on text anywhere in the shell (F023.8 AC#3)", () => {
  it("footer text is a real colour, and the colour follows the backdrop", () => {
    const light = renderShell({
      subject: "s", accentColor: "#0f7391", bodyHtml: "<p>x</p>",
      footerLines: ["line"],
    } as never);
    expect(light).toContain("color:#4a4d63");

    const dark = renderShell({
      subject: "s", accentColor: "#0f7391", backdropColor: "#1a1c2b",
      bodyHtml: "<p>x</p>", footerLines: ["line"],
    } as never);
    // #4a4d63 on a dark ground would be illegal; #c1c2d1 measures 9.56:1 there
    // and 5.18:1 even on the #484848 that Outlook iOS maps to.
    expect(dark).toContain("color:#c1c2d1");
    expect(dark).not.toContain("color:#4a4d63");
  });

  it("NO `opacity:` appears in a rendered mail at all", () => {
    // Asserting the INVARIANT rather than the one line that had it — an opacity
    // added elsewhere tomorrow is the same defect.
    const html = renderShell({
      subject: "s", accentColor: "#0f7391", bodyHtml: "<p>x</p>",
      footerLines: ["a", "b"], footerHref: "https://x.dk",
    } as never);
    expect(html).not.toContain("opacity:");
  });
});

describe("cardBg is not exactly white (F023.8 AC#4)", () => {
  it("defaults to #fffffe, making the F023.7 comment true", () => {
    const html = renderShell({ subject: "s", accentColor: "#0f7391", bodyHtml: "<p>x</p>" } as never);
    expect(html).toContain(`bgcolor="#fffffe"`);
    // The contradiction this AC closes: the source claimed the technique was in
    // use while the code shipped exactly #ffffff.
    expect(html).not.toContain(`bgcolor="#ffffff"`);
  });

  it("an explicit cardBg still wins", () => {
    const html = renderShell({
      subject: "s", accentColor: "#0f7391", cardBg: "#101010", bodyHtml: "<p>x</p>",
    } as never);
    // Assert the ATTRIBUTE, not the string: `#fffffe` also appears in the
    // shipped CSS comment recording fd-sundhed's measurement, so a bare
    // not.toContain here fails on a comment rather than on a colour.
    expect(html).toContain(`bgcolor="#101010"`);
    expect(html).not.toContain(`bgcolor="#fffffe"`);
  });
});
