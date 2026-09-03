import { describe, expect, it } from "vitest";
import { SHELL_VERSION, eyebrow, heading, noteBox, renderShell } from "../src/index";

const shell = () =>
  renderShell({ subject: "s", accentColor: "#0f7391", bodyHtml: "<p>x</p>" } as never);

describe("heading({ emphasis }) — F023.7", () => {
  it("italicises the FIRST occurrence, in the accent colour", () => {
    const h = heading("Vores nye produkt", { emphasis: "nye", accentColor: "#0f7391" });
    expect(h).toContain(`<i style="color:#0f7391;font-style:italic;">nye</i>`);
    // exactly one, not every occurrence
    expect(h.match(/<i /g)).toHaveLength(1);
  });

  it("NEGATIVE CONTROL: no emphasis renders exactly as it did before", () => {
    // If this ever drifts, every consumer's stored render changes silently.
    expect(heading("Plain")).toBe(
      `<h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:400;color:#1a1a1a;text-align:center;">Plain</h1>`,
    );
  });

  it("NEGATIVE CONTROL: an emphasis that does not occur leaves the heading alone", () => {
    // The tempting alternative — append it — renders the caller's mistake as design.
    const a = heading("Vores nye produkt");
    const b = heading("Vores nye produkt", { emphasis: "fraværende", accentColor: "#0f7391" });
    expect(b).toBe(a);
  });

  it("finds a word that had to be escaped", () => {
    const h = heading("Ris & ros", { emphasis: "Ris & ros", accentColor: "#000" });
    expect(h).toContain(`<i style="color:#000;font-style:italic;">Ris &amp; ros</i>`);
  });

  it("escapes the text, emphasis or not", () => {
    expect(heading("<script>")).toContain("&lt;script&gt;");
    expect(heading("<script>", { emphasis: "<script>", accentColor: "#000" })).not.toContain("<script>");
  });
});

describe("eyebrow / noteBox — F023.7", () => {
  it("eyebrow carries the accent colour and escapes its text", () => {
    const e = eyebrow("Projekt & co", { accentColor: "#0f7391" });
    expect(e).toContain("#0f7391");
    expect(e).toContain("Projekt &amp; co");
    expect(e).toContain("text-transform:uppercase");
  });

  it("noteBox takes RAW html (it is the paragraphHtml of boxes), with a left rule", () => {
    const n = noteBox("<strong>hi</strong>", { accentColor: "#0f7391" });
    expect(n).toContain("<strong>hi</strong>");
    expect(n).toContain("border-left:3px solid #0f7391");
  });

  it("noteBox is NOT factBox: it renders prose, not label/value rows", () => {
    // Same visual family, different datatype — the reason it is its own function.
    const n = noteBox("just prose", { accentColor: "#000" });
    expect(n).not.toMatch(/<td[^>]*>[\s\S]*<\/td>\s*<td/);
  });
});

describe("the shell says which shell rendered it — F023.7", () => {
  it("emits SHELL_VERSION into the output", () => {
    expect(shell()).toContain(`<!-- @broberg/mail-core shell v${SHELL_VERSION} -->`);
  });

  it("the marker is the FIRST thing after the doctype, so a truncated body still carries it", () => {
    // `at` must be asserted FOUND before it is compared: indexOf returns -1 when
    // the marker is missing, and -1 is less than every real index — so the
    // obvious version of this test passes on a shell with NO marker at all.
    // Caught by mutating the marker away and watching only its sibling go red.
    const html = shell();
    const at = html.indexOf("mail-core shell v");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(html.indexOf("<html"));
  });

  it("NEGATIVE CONTROL: the version is not the package version", () => {
    // Deliberately decoupled — a docs-only release must not make every stored
    // render look different. If these are ever wired together, this goes red.
    const pkg = require("../package.json").version as string;
    expect(SHELL_VERSION).not.toBe(pkg);
  });
});
