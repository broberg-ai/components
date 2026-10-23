// F038.38 — Cmd+K leads to the package page, not only the old drawer.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DATA, npmUrl } from "../../scripts/inventory-data.mjs";

const inv = readFileSync(new URL("../../docs/inventory.html", import.meta.url), "utf8");
type Row = { f: string; pkg?: string; s?: string; dist?: string; sum?: string };
const rows = (DATA as { items: Row[] }[]).flatMap((L) => L.items);
const search = JSON.parse(inv.match(/var SEARCH=(\[.*?\]);/)![1]) as { f: string; href: string; sum: string }[];

describe("F038.38 Cmd+K → package page", () => {
  it("every published package's search entry carries its page, and nothing else does", () => {
    const bad: string[] = [];
    for (const r of rows) {
      const e = search.find((x) => x.f === r.f)!;
      const want = npmUrl(r) ? `/packages/${r.pkg}` : "";
      if (e.href !== want) bad.push(`${r.f}: ${JSON.stringify(e.href)} ≠ ${JSON.stringify(want)}`);
    }
    for (const e of search.filter((x) => x.f.startsWith("infra-"))) if (e.href) bad.push(`${e.f} has href`);
    expect(bad).toEqual([]);
  });

  it("each published package's drawer opens with «Åbn pakkeside →»", () => {
    const missing = rows.filter((r) => npmUrl(r)).filter((r) => !inv.includes(`href=\\"/packages/${r.pkg}\\" data-testid=\\"d-pkgpage-${r.f.toLowerCase()}\\"`)).map((r) => r.f);
    expect(missing).toEqual([]);
  });

  it("Enter and click navigate to data-href when present, else open the drawer", () => {
    expect(inv).toContain("if(x.href){location.href=x.href;return;}closeSearch();openDrawerByF(x.f);");
    expect(inv).toContain("var h=r.getAttribute('data-href');if(h){location.href=h;return;}");
  });

  it("the summary is searchable", () => {
    expect(inv).toContain("(x.sum||'')");
    expect(search.find((x) => x.f === "lens-svg")!.sum).toBe(rows.find((r) => r.f === "lens-svg")!.sum);
  });
});
