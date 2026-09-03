import { describe, expect, it } from "vitest";
import { factBox, fill, fillHtml, heading, paragraph, renderShell, signOff, SHELL_VERSION } from "../src/index";
import fixture from "./shell-contract.snapshot.json";

/** F023.11 — the payload verbatim from the card. */
const PAYLOAD = `<a href="https://phish.example">Log ind</a>`;

describe("fill() escapes (F023.11)", () => {
  it("the proven payload renders as visible text, not as a link", () => {
    const out = fill("<p>Hej {name}</p>", { name: PAYLOAD });
    expect(out).not.toContain(`<a href="https://phish.example">`);
    expect(out).toContain("&lt;a href=");
  });

  it("and the payload IS a link when unescaped — so the test above is about escaping", () => {
    // Without this, the assertion above passes against a fill() that returns "".
    expect(fillHtml("<p>Hej {name}</p>", { name: PAYLOAD })).toContain(`<a href="https://phish.example">`);
  });

  it("fillHtml does NOT escape — the unsafe one is the one you have to name", () => {
    expect(fillHtml("{x}", { x: "<b>hi</b>" })).toBe("<b>hi</b>");
  });

  it("unknown tokens are still left as-is, in BOTH", () => {
    // Existing behaviour consumers rely on; the escaping fix must not change it.
    expect(fill("a {nope} b", {})).toBe("a {nope} b");
    expect(fillHtml("a {nope} b", {})).toBe("a {nope} b");
  });

  it("an EMPTY value is honoured as empty, not treated as absent", () => {
    // cardmem's point: "" is an answer, absent is not. `key in vars`, not truthiness.
    expect(fill("[{x}]", { x: "" })).toBe("[]");
  });

  it("numbers survive", () => expect(fill("{n}", { n: 42 })).toBe("42"));
});

describe("ORDER: render then fill, never the reverse (cardmem, F023.11)", () => {
  const NAME = "Sørensen & Søn";

  it("render THEN fill escapes exactly once", () => {
    const rendered = paragraph("Hej {name}");        // escapes the template's own text
    expect(fill(rendered, { name: NAME })).toContain("Sørensen &amp; Søn");
    expect(fill(rendered, { name: NAME })).not.toContain("&amp;amp;");
  });

  it("SENTINEL: fill THEN render still double-escapes — if this stops being true, the docstring is stale", () => {
    // Deliberately the wrong order. This test exists so the rule documented on
    // fill() is flagged rather than silently going out of date.
    const filled = fill("Hej {name}", { name: NAME });
    expect(paragraph(filled)).toContain("&amp;amp;");
  });
});

describe("no `opacity` on text in ANY primitive (F023.12)", () => {
  // F023.8's AC said "no opacity in the shell" and its test rendered only
  // renderShell — while factBox, forty lines away in the same file, still had
  // one. Render every text-emitting primitive instead of a hand-picked entry.
  const outputs: Record<string, string> = {
    renderShell: renderShell({ subject: "s", accentColor: "#0f7391", bodyHtml: "<p>x</p>", footerLines: ["f"], footerHref: "https://x.dk" } as never),
    factBox: factBox([{ label: "Navn", value: "x" }], { accentColor: "#0f7391" }),
    heading: heading("t", { accentColor: "#0f7391", emphasis: "t" }),
    paragraph: paragraph("t"),
    signOff: signOff([{ text: "a" }, { text: "b", tier: "name" }, { text: "c", tier: "meta" }]),
  };
  for (const [name, html] of Object.entries(outputs)) {
    it(`${name} emits no opacity`, () => expect(html).not.toContain("opacity:"));
  }
  it("factBox uses the package's ONE muted colour", () => {
    expect(outputs.factBox).toContain("color:#4a4d63");
  });
});

describe("SHELL_VERSION tracks the RENDERING, not the package (F023.12)", () => {
  it("the seal: rendered output matches the fixture stored for this SHELL_VERSION", () => {
    // If the output changes and SHELL_VERSION does not, this fails and names the
    // marker. That converts "remember to bump it" — which produced three
    // releases at "1" while the rendering changed three times — into "cannot
    // forget": the only ways to green are bump the version, or do not change
    // the output.
    expect(SHELL_VERSION).toBe(fixture.shellVersion);
    for (const [name, html] of Object.entries(fixture.renders)) {
      expect(`${name}:${outputsFor(name)}`).toBe(`${name}:${html}`);
    }
  });
});

function outputsFor(name: string): string {
  switch (name) {
    case "minimal": return renderShell({ subject: "s", accentColor: "#0f7391", bodyHtml: "<p>x</p>" } as never);
    case "full": return renderShell({ subject: "s", accentColor: "#0f7391", bodyHtml: "<p>x</p>", footerLines: ["a", "b"], footerHref: "https://x.dk", logoUrl: "https://x.dk/l.png", logoWidth: 56 } as never);
    case "dark": return renderShell({ subject: "s", accentColor: "#0f7391", cardBg: "#1a1a1a", backdropColor: "#101010", bodyHtml: "<p>x</p>", footerLines: ["a"] } as never);
    case "signOff": return signOff([{ text: "a" }, { text: "b", tier: "name" }, { text: "c", tier: "meta" }]);
    case "factBox": return factBox([{ label: "L", value: "V" }], { accentColor: "#0f7391" });
    default: throw new Error(`no renderer for fixture key ${name}`);
  }
}
