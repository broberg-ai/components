// F023.15 — the shell can load a webfont, and only a Google Fonts stylesheet.
import { describe, expect, it } from "vitest";
import { assertWebfontHref, renderShell } from "../src/index";

const DM = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&display=swap";
const shell = (over: Record<string, unknown>) =>
  renderShell({ subject: "s", accentColor: "#0f7391", bodyHtml: "<p>x</p>", ...over } as never);

describe("webfontHref loads the stylesheet (AC#0)", () => {
  it("emits exactly one <link>, attribute-escaped, before <style>", () => {
    const html = shell({ webfontHref: DM });
    const tag = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&amp;display=swap">`;
    expect(html.split("<link ").length - 1).toBe(1);
    expect(html).toContain(tag);
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head.indexOf(tag)).toBeGreaterThan(-1);
    expect(head.indexOf(tag)).toBeLessThan(head.indexOf("<style>"));
  });

  it("/css (v1) is accepted too", () => {
    expect(() => shell({ webfontHref: "https://fonts.googleapis.com/css?family=Inter" })).not.toThrow();
  });
});

describe("omitted = unchanged (AC#1)", () => {
  it("no <link> and output identical to an explicit undefined", () => {
    const a = shell({});
    expect(a).not.toContain("<link");
    expect(shell({ webfontHref: undefined })).toBe(a);
  });
});

describe("everything else is refused, naming the field (AC#2)", () => {
  const bad: [string, string][] = [
    ["http", "http://fonts.googleapis.com/css2?family=DM+Sans"],
    ["suffix host", "https://fonts.googleapis.com.evil.com/css2?family=DM+Sans"],
    ["host in path", "https://evil.com/fonts.googleapis.com/css2"],
    ["credentials", "https://fonts.googleapis.com@evil.com/css2"],
    ["user on right host", "https://user@fonts.googleapis.com/css2"],
    ["port", "https://fonts.googleapis.com:8443/css2"],
    ["other path", "https://fonts.googleapis.com/icon?family=Material+Icons"],
    ["relative", "/css2?family=DM+Sans"],
    ["quote breakout", `https://fonts.googleapis.com/css2?family=a" onload="alert(1)`],
    ["tag", "https://fonts.googleapis.com/css2?family=<x>"],
    ["backtick", "https://fonts.googleapis.com/css2?family=`x`"],
    ["other cdn", "https://fonts.bunny.net/css?family=dm-sans"],
  ];
  for (const [name, v] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => shell({ webfontHref: v })).toThrow(/webfontHref/);
      expect(() => assertWebfontHref("webfontHref", v)).toThrow(/webfontHref/);
    });
  }
  it("negative control: the real Google Fonts URL is not refused", () => {
    expect(() => assertWebfontHref("webfontHref", DM)).not.toThrow();
  });
});
