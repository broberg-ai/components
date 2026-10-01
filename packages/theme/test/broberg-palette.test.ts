// F001.17 — the broberg.ai palette is BID's house tokens, not a look-alike.
//
// test/fixtures/bid-app.css is broberg-id/ui/src/app.css as of 1/10 2026, the
// file that says «HUSETS TOKENS — samme værdier som brand.ts». Every mapped
// value is compared exactly; a typo in one hex fails here, not in a customer's
// eyes. If BID changes its palette, refresh the fixture and this goes red until
// the preset follows.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEME_KEYS } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const PRESET = readFileSync(join(here, "..", "css", "neutral-preset.css"), "utf8");
const BID = readFileSync(join(here, "fixtures", "bid-app.css"), "utf8");

function block(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(selector + " {");
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

const bidDark = block(BID, "@theme");
const bidLight = block(BID, ':root[data-theme="light"]');
const pre = {
  dark: block(PRESET, '[data-theme="dark-broberg"]'),
  light: block(PRESET, '[data-theme="light-broberg"]'),
};

// preset token  <-  BID token. The ONE place the mapping is written down.
const MAP: Array<[string, string]> = [
  ["--background", "--color-bg"],
  ["--foreground", "--color-fg"],
  ["--popover", "--color-surface-float"],
  ["--primary", "--color-primary"],
  ["--primary-foreground", "--color-on-primary"],
  ["--muted", "--color-bg2"],
  ["--muted-foreground", "--color-muted"],
  ["--border", "--color-border"],
  ["--sidebar", "--color-bg2"],
  ["--ring", "--color-primary"],
  ["--brand-accent", "--color-accent"],
  ["--brand-accent-text", "--color-accent-text"],
];

describe.each([
  ["dark-broberg", "dark", bidDark],
  ["light-broberg", "light", bidLight],
] as const)("%s equals BID's house tokens", (_key, mode, bid) => {
  it.each(MAP)("%s = BID %s", (ours, theirs) => {
    expect(bid.get(theirs), `BID fixture lost ${theirs}`).toBeDefined();
    expect(pre[mode].get(ours)).toBe(bid.get(theirs));
  });
});

describe("the brand orange is NOT shadcn's hover --accent", () => {
  it.each(["dark", "light"] as const)("%s: --accent is BID's hover, not its orange", (mode) => {
    const bid = mode === "dark" ? bidDark : bidLight;
    expect(pre[mode].get("--accent")).not.toBe(bid.get("--color-accent"));
  });
  it("light --accent is BID's hover surface exactly", () => {
    expect(pre.light.get("--accent")).toBe(bidLight.get("--color-hover"));
  });
});

describe("every ThemeKey has a block in the preset", () => {
  it.each([...THEME_KEYS].filter((k) => k !== "dark"))("%s", (key) => {
    expect(PRESET).toContain(`[data-theme="${key}"] {`);
  });
  it("broberg keys keep the dark-/light- prefix the dark custom-variant matches on", () => {
    expect(PRESET).toContain('@custom-variant dark (&:is([data-theme^="dark"] *));');
    expect(THEME_KEYS).toContain("dark-broberg");
    expect(THEME_KEYS).toContain("light-broberg");
  });
});
