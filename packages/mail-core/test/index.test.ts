import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  cta,
  escapeHtml,
  factBox,
  fill,
  heading,
  makeLogoAttachment,
  paragraph,
  paragraphHtml,
  renderShell,
  signOff,
} from "../src/index";

const FIXTURE_LOGO = join(__dirname, "fixtures/logo.png");

describe("renderShell", () => {
  it("renders a complete HTML document with the given opts", () => {
    const html = renderShell({
      accentColor: "#2E6B62",
      subject: "Welcome",
      preheader: "Glad to have you",
      bodyHtml: paragraph("Hello there"),
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Welcome</title>");
    expect(html).toContain("Glad to have you");
    expect(html).toContain("Hello there");
    expect(html).toContain("#2E6B62");
  });

  it("works with minimal opts (defaults applied)", () => {
    const html = renderShell({ accentColor: "#000", subject: "S", bodyHtml: "<p>x</p>" });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("#ffffff"); // default cardBg
    expect(html).not.toContain("undefined");
  });

  it("derives a light text color when cardBg is dark (legibility cross-check)", () => {
    const html = renderShell({ accentColor: "#d4af37", cardBg: "#1a1a1a", subject: "S", bodyHtml: "<p>x</p>" });
    expect(html).toContain("#1a1a1a"); // cardBg present
    expect(html).toContain("#f5f5f5"); // auto light text on a dark card
  });

  it("omits the footer when showFooter is false", () => {
    const html = renderShell({ accentColor: "#000", subject: "S", bodyHtml: "x", showFooter: false, footerLines: ["should not appear"] });
    expect(html).not.toContain("should not appear");
  });
});

describe("primitives", () => {
  it("heading/paragraph/paragraphHtml/signOff render expected structure", () => {
    expect(heading("Hi")).toContain("<h1");
    expect(heading("Hi")).toContain("Hi");
    expect(paragraph("<b>x</b>")).toContain("&lt;b&gt;"); // escaped
    expect(paragraphHtml("<b>x</b>")).toContain("<b>x</b>"); // raw
    expect(signOff("Thanks", "Best", "Team")).toContain("Team");
  });

  it("cta renders a table-cell-based button (not a bare <a>/<button>)", () => {
    const html = cta("https://example.com", "Click me", { accentColor: "#123456" });
    expect(html).toContain("<table");
    expect(html).toContain("#123456");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("Click me");
  });

  it("factBox renders a table-row per fact, empty string for zero rows", () => {
    expect(factBox([])).toBe("");
    const html = factBox([{ label: "Name", value: "Christian" }, { label: "Email", value: "cb@webhouse.dk" }]);
    expect(html).toContain("<table");
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
    expect(html).toContain("Name");
    expect(html).toContain("Christian");
    expect(html).toContain("Email");
  });
});

describe("escapeHtml / escapeAttr", () => {
  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("fill", () => {
  it("substitutes known tokens and leaves unknown ones as-is", () => {
    expect(fill("Hi {name}, you have {count} items", { name: "Christian", count: 3 })).toBe(
      "Hi Christian, you have 3 items",
    );
    expect(fill("Hi {missing}", {})).toBe("Hi {missing}");
  });
});

describe("makeLogoAttachment", () => {
  it("returns a Resend-shaped attachment for an existing file", () => {
    const att = makeLogoAttachment(FIXTURE_LOGO);
    expect(att).not.toBeNull();
    expect(att?.filename).toBe("logo.png");
    expect(att?.contentType).toBe("image/png");
    expect(att?.content).toBeInstanceOf(Buffer);
    expect(att?.content.length).toBeGreaterThan(0);
  });

  it("returns null (not a throw) for a missing file", () => {
    expect(makeLogoAttachment("/nonexistent/path/logo.png")).toBeNull();
  });
});
