import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// THE TOOLTIP IS A SHIPPED ARTIFACT, and nothing in this package tested it.
//
// 0.7.0 made the exported patterns stateless (no `/g`) and left the interface's
// own docstring saying "global regex". That string is what an editor shows a
// consumer hovering `SECRET_PATTERNS[i].regex`, and following it —
// `while ((m = p.regex.exec(text)))` — never advances `lastIndex` on a
// non-global regex and spins forever. The README documented the change
// correctly; the .d.ts contradicted it, and the README is not the thing a
// consumer reads at the call site.
//
// So this asserts on dist/index.d.ts, not on src: the file that is published is
// the file whose claims can hurt someone.

const DTS = join(__dirname, "..", "dist", "index.d.ts");

describe("the published type declarations", () => {
  // A missing dist is NOT a skip. The whole point of this file is that a claim
  // reaches consumers through the built artifact; "could not look" and "looked
  // and it was fine" must never produce the same green (F061.5).
  it("is built — this suite cannot run against a missing artifact", () => {
    expect(
      existsSync(DTS),
      `dist/index.d.ts is missing, so the shipped tooltips were not checked.\n` +
        `Build first:  pnpm --filter @broberg/secret-scan build`,
    ).toBe(true);
  });

  it("does not describe the exported regexes as global", () => {
    const dts = readFileSync(DTS, "utf8");
    // Narrow on purpose: `cloudflare-global-key` is a legitimate label, and the
    // internal list IS global. What must not appear is the claim ABOUT the
    // exported shape.
    expect(dts).not.toMatch(/global regex/i);
  });

  it("documents SECRET_PATTERNS itself, not only the interface beside it", () => {
    const dts = readFileSync(DTS, "utf8");
    const decl = dts.indexOf("declare const SECRET_PATTERNS");
    expect(decl).toBeGreaterThan(-1);
    // The explanation of statelessness used to sit above an UNEXPORTED helper,
    // so tsup dropped it and the export shipped with no doc comment at all.
    const before = dts.slice(0, decl).trimEnd();
    expect(
      before.endsWith("*/"),
      "SECRET_PATTERNS ships with no doc comment — the explanation is attached " +
        "to a declaration that does not reach the .d.ts",
    ).toBe(true);
    expect(before.slice(-400)).toMatch(/stateless/i);
  });
});
