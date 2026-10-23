// F038.37 — every keyword is a clickable tag; a tag lists the packages that carry it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
process.env.ENROLL_DB_URL = ":memory:";
import { app } from "./server";
import { getEnrollStore } from "./enroll";
import { DATA } from "../../scripts/inventory-data.mjs";

const login = async () => {
  const k = "k".repeat(64);
  await (await getEnrollStore())!.bindSessionKey("t-tags", createHash("sha256").update(k).digest("hex"));
  return { "x-discovery-session": "t-tags", "x-enroll-key": k };
};
type Row = { pkg?: string; s?: string; dist?: string; kw?: string[]; f: string };
const rows = (DATA as { items: Row[] }[]).flatMap((L) => L.items);
const shippedRows = rows.filter((r) => r.pkg?.startsWith("@broberg/") && r.s === "shipped" && r.dist !== "spm");
// a package under two components carries the union of both rows' keywords, first-seen order
const shipped = [...new Set(shippedRows.map((r) => r.pkg!))].map((pkg) => {
  const kw: string[] = [];
  for (const r of shippedRows.filter((x) => x.pkg === pkg)) for (const k of r.kw ?? []) if (!kw.includes(k)) kw.push(k);
  return { pkg, kw, f: shippedRows.find((x) => x.pkg === pkg)!.f };
});
const enc = (k: string) => encodeURIComponent(k).replace(/&/g, "&amp;");

describe("F038.37 keyword tags", () => {
  it("on every package page each keyword is a tag link to /packages?tag=… — none stay plain text", async () => {
    const h = await login();
    const bad: string[] = [];
    for (const r of shipped) {
      const html = await (await app.request(`/packages/${r.pkg}`, { headers: h })).text();
      const dd = html.match(/<dd data-field="Nøgleord">(.*?)<\/dd>/)?.[1] ?? "";
      const links = [...dd.matchAll(/<a class="tag" href="\/packages\?tag=([^"]+)" data-testid="pkg-tag-\d+">/g)].map((m) => m[1]);
      const want = (r.kw ?? []).map(enc);
      if (JSON.stringify(links) !== JSON.stringify(want)) bad.push(`${r.pkg}: ${links.length} links for ${want.length} keywords`);
      const text = dd.replace(/<a class="tag"[^>]*>[^<]*<\/a>/g, "").replace(/<[^>]+>/g, "").trim();
      if ((r.kw ?? []).length && text !== "") bad.push(`${r.pkg}: plain text left «${text}»`);
    }
    expect(bad).toEqual([]);
  });

  it("/packages?tag=X lists exactly the packages whose keywords hold X, with an active tag and a way out", async () => {
    const tag = "skærmbillede";
    const want = shipped.filter((r) => (r.kw ?? []).some((k) => k.toLowerCase() === tag)).map((r) => r.pkg).sort();
    expect(want.length).toBeGreaterThan(0);
    const html = await (await app.request(`/packages?tag=${encodeURIComponent(tag)}`, { headers: await login() })).text();
    const got = [...html.matchAll(/<tr data-testid="pkg-row-\d+" data-name="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(got).toEqual(want);
    expect(html).toContain('data-testid="pkg-tag-active"');
    expect(html).toContain('href="/packages" data-testid="pkg-tag-clear"');
  });

  it("an unknown tag says so instead of showing an empty table", async () => {
    const html = await (await app.request(`/packages?tag=findesikke`, { headers: await login() })).text();
    expect(html).toContain('data-testid="pkg-tag-empty"');
    expect(html.match(/data-testid="pkg-row-\d+"/g)).toBeNull();
  });

  it("the free-text filter matches keywords too", async () => {
    const html = await (await app.request(`/packages`, { headers: await login() })).text();
    const row = html.match(/<tr[^>]*data-name="@broberg\/lens-engine"[^>]*>/)![0];
    expect(row.match(/data-haystack="([^"]*)"/)![1]).toContain("skærmbillede");
  });

  it("the front page's component drawer shows the same tags", () => {
    const inv = readFileSync(new URL("../../docs/inventory.html", import.meta.url), "utf8");
    const le = rows.find((r) => r.pkg === "@broberg/lens-engine")!;
    for (const [i, k] of (le.kw ?? []).entries())
      expect(inv).toContain(`href=\\"/packages?tag=${encodeURIComponent(k)}\\" data-testid=\\"d-tag-${le.f.toLowerCase()}-${i}\\"`);
  });
});
