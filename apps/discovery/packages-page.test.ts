// F038.32 — «Packages»: every published @broberg package on one page.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
process.env.ENROLL_DB_URL = ":memory:";
import { app } from "./server";
import { getEnrollStore } from "./enroll";
import { SITE_CSS } from "../../scripts/site-chrome.mjs";
import { consumersOf } from "../../scripts/fleet-graph.mjs";

const login = async () => {
  const k = "p".repeat(64);
  await (await getEnrollStore())!.bindSessionKey("t-pkgs", createHash("sha256").update(k).digest("hex"));
  return { "x-discovery-session": "t-pkgs", "x-enroll-key": k };
};
const meta = JSON.parse(readFileSync(new URL("../../docs/npm-meta.json", import.meta.url), "utf8")) as Record<string, { publishedAt: string; provenance: string }>;
const scan = JSON.parse(readFileSync(new URL("../../data/fleet-deps.json", import.meta.url), "utf8"));

describe("/packages", () => {
  it("is behind the same login as the rest of Discovery", async () => {
    expect((await app.request("/packages")).status).toBe(401);
  });

  it("one row per published @broberg package — the same count as docs/npm-meta.json", async () => {
    const html = await (await app.request("/packages", { headers: await login() })).text();
    expect(html.match(/data-testid="pkg-row-\d+"/g)?.length).toBe(Object.keys(meta).length);
  });

  it("a row carries every column, strictly from the sources", async () => {
    const html = await (await app.request("/packages", { headers: await login() })).text();
    const row = html.match(/<tr data-testid="pkg-row-\d+" data-name="@broberg\/webpush"[^>]*>.*?<\/tr>/)![0];
    const m = meta["@broberg/webpush"]!;
    expect(row).toContain(`data-published="${m.publishedAt}"`);
    expect(row).toContain(`data-provenance="${m.provenance}"`);
    expect(row).toContain(`data-consumers="${consumersOf(scan, "@broberg/webpush").length}"`);
    expect(row).toContain('href="https://www.npmjs.com/package/@broberg/webpush"');
    expect(row).toContain("<code>npm i @broberg/webpush</code>");
    expect(row).toMatch(/<td>\d\d\.\d\d\.\d{4} kl\. \d\d\.\d\d \(dansk tid\)<\/td>/);
  });

  it("uses the site's design module, with «Packages» marked current and a sort button per column", async () => {
    const html = await (await app.request("/packages", { headers: await login() })).text();
    expect(html).toContain(SITE_CSS);
    expect(html).toMatch(/<a href="\/packages" data-testid="nav-packages" aria-current="page"/);
    for (const k of ["name", "version", "published", "provenance", "layer", "owner", "consumers"]) expect(html).toContain(`data-testid="pkg-sort-${k}"`);
  });

  it("«Packages» is in the top bar of the landing page and of /tickets", async () => {
    const landing = readFileSync(new URL("../../docs/inventory.html", import.meta.url), "utf8");
    expect(landing).toMatch(/<a href="\/packages" data-testid="nav-packages"/);
    const tickets = await (await app.request("/tickets", { headers: await login() })).text();
    expect(tickets).toMatch(/<a href="\/packages" data-testid="nav-packages"/);
  });
});
