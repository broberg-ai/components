// F038.35 — the package page: every field, and who in the fleet installs it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
process.env.ENROLL_DB_URL = ":memory:";
import { app } from "./server";
import { getEnrollStore } from "./enroll";
import { consumersOf } from "../../scripts/fleet-graph.mjs";
import { consumerDetails, renderPackageDetail, ageText, formatDescription } from "./package-detail-page";
import { DATA } from "../../scripts/inventory-data.mjs";

const login = async () => {
  const k = "d".repeat(64);
  await (await getEnrollStore())!.bindSessionKey("t-detail", createHash("sha256").update(k).digest("hex"));
  return { "x-discovery-session": "t-detail", "x-enroll-key": k };
};
const scan = JSON.parse(readFileSync(new URL("../../data/fleet-deps.json", import.meta.url), "utf8"));
const PKG = "@broberg/mail";
const field = (html: string, name: string) => html.match(new RegExp(`<dd data-field="${name}">(.*?)</dd>`))?.[1];

describe("/packages/@broberg/<name>", () => {
  it("is behind the same login as the rest of Discovery", async () => {
    expect((await app.request(`/packages/${PKG}`)).status).toBe(401);
  });

  it("an unknown package is a 404 page with a way back, not an empty page", async () => {
    const res = await app.request("/packages/@broberg/does-not-exist", { headers: await login() });
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('data-testid="pkg-detail-notfound"');
    expect(html).toContain('href="/packages" data-testid="pkg-detail-back"');
  });

  it("shows the roster fields strictly as /api/packages has them", async () => {
    const h = await login();
    const api = (await (await app.request(`/api/packages`, { headers: h })).json()) as { packages: Record<string, unknown>[] };
    const p = api.packages.find((x) => x.name === PKG)!;
    const html = await (await app.request(`/packages/${PKG}`, { headers: h })).text();
    expect(html).toContain(`data-testid="pkg-detail-root" data-name="${PKG}"`);
    expect(field(html, "Version")).toBe(String(p.version));
    expect(field(html, "Installér")).toBe(`<code>${p.install}</code>`);
    expect(field(html, "Ejer")).toBe(String(p.owner));
    expect(field(html, "Lag")!.startsWith(String(p.layer))).toBe(true);
    expect(field(html, "npm")).toContain(`href="${p.npmUrl}"`);
  });

  it("lists exactly the repos consumersOf() finds, with range, field and manifest path", async () => {
    const html = await (await app.request(`/packages/${PKG}`, { headers: await login() })).text();
    const repos = [...new Set([...html.matchAll(/data-testid="pkg-detail-consumer-\d+" data-repo="([^"]+)"/g)].map((m) => m[1]))];
    const details = consumerDetails(scan, PKG);
    expect(details.map((d) => d.session).sort()).toEqual([...consumersOf(scan, PKG)].sort());
    expect(repos.sort()).toEqual(details.map((d) => d.repo).sort());
    const first = details[0].uses[0];
    expect(html).toContain(`<code>${first.range}</code></td><td>${first.field}</td><td><code>${first.at}</code>`);
  });

  it("no consumers: says «none use it» only when the scan is fresh — otherwise it says the scan is missing", () => {
    const p = { name: "@broberg/x", version: "1.0.0", install: "npm i @broberg/x", description: null, summary: null, layer: null, layerName: null, component: null, componentName: null, model: null, modelDesc: null, status: null, owner: null, graduate: false, note: null, keywords: [], npmUrl: null, repoUrl: null, publishedAt: null, provenance: "unknown" as const };
    const fresh = renderPackageDetail(p, null, [], [], { scannedAt: new Date().toISOString(), stale: false, reposScanned: 70, reposFailed: 0 });
    const missing = renderPackageDetail(p, null, [], [], { scannedAt: null, stale: true, reposScanned: 0, reposFailed: 0 });
    expect(fresh).toContain('data-testid="pkg-detail-consumers-empty" data-reason="none"');
    expect(missing).toContain('data-testid="pkg-detail-consumers-empty" data-reason="no-scan"');
    // a missing field reads «ukendt»/«ingen», never an empty cell
    expect(field(fresh, "Ejer")).toBe('<span class="pd-none">ukendt</span>');
    expect(fresh).toContain('data-testid="pkg-detail-summary"><span class="pd-none">intet resumé endnu</span>');
  });

  it("the dependency check is shown in full; «kunne ikke tjekke» keeps its reason", () => {
    const p = { name: "@broberg/x", version: "1.0.0", install: "i", description: null, summary: null, layer: null, layerName: null, component: null, componentName: null, model: null, modelDesc: null, status: null, owner: null, graduate: false, note: null, keywords: [], npmUrl: null, repoUrl: null, publishedAt: null, provenance: "unknown" as const };
    const z = { critical: 0, high: 0, moderate: 0, low: 0 };
    const html = renderPackageDetail(p, { verdict: "kunne ikke tjekke", status: "error", error: "pnpm audit failed: timeout", prod: z, checkedAt: "2026-10-23T00:24:26Z" }, [], [], { scannedAt: null, stale: true, reposScanned: 0, reposFailed: 0 });
    expect(html).toMatch(/<dd data-field="verdict" class="pd-warn">kunne ikke tjekke — pnpm audit failed: timeout<\/dd>/);
    expect(html).toContain("23.10.2026 kl. 02.24 (dansk tid)");
  });

  it("each name on /packages links to its page", async () => {
    const html = await (await app.request("/packages", { headers: await login() })).text();
    expect(html).toContain(`href="/packages/${PKG}" data-testid="pkg-link-`);
  });
});

describe("F038.36 — a short summary, a folded full description, and how long since the last release", () => {
  it("every shipped npm package in the roster has a Danish summary ≤160 chars, no versions, no F-numbers", () => {
    const bad: string[] = [];
    for (const L of DATA as { items: { pkg?: string; s?: string; dist?: string; sum?: string }[] }[])
      for (const it of L.items) {
        if (!it.pkg || it.s !== "shipped" || it.dist === "spm") continue;
        const sum = it.sum ?? "";
        if (!sum || sum.length > 160 || /\bv?\d+\.\d+|\bF\d{2,}/.test(sum)) bad.push(`${it.pkg}: ${JSON.stringify(sum)}`);
      }
    expect(bad).toEqual([]);
  });

  it("the page leads with the summary and folds the full description behind a button", async () => {
    const html = await (await app.request(`/packages/${PKG}`, { headers: await login() })).text();
    const roster = (DATA as { items: { pkg?: string; sum?: string }[] }[]).flatMap((L) => L.items).find((it) => it.pkg === PKG)!;
    expect(html.match(/data-testid="pkg-detail-summary">([^<]*)</)![1]).toBe(roster.sum);
    expect(html).toContain('aria-expanded="false" aria-controls="pkg-detail-desc" data-testid="pkg-detail-desc-toggle"');
    expect(html).toMatch(/data-testid="pkg-detail-desc" hidden>/);
  });

  it("the full description becomes paragraphs with code words marked, escaped first", () => {
    const out = formatDescription("Sends mail via createMailer(). Uses @broberg/mail-core and F023.1. Third one is @broberg/mail. v0.17.0 adds idempotencyKey. <b>x</b> stays text.");
    expect(out).toBe('<p>Sends mail via <code>createMailer()</code>. Uses <code>@broberg/mail-core</code> and <code>F023.1</code>. Third one is <code>@broberg/mail</code>.</p><p><code>v0.17.0</code> adds idempotencyKey. &lt;b&gt;x&lt;/b&gt; stays text.</p>'.replace("<code>v0.17.0</code>", "v0.17.0"));
  });

  it("«Sidst opdateret» counts days and hours from the release, and the date stays", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(ageText("2026-10-20T07:00:00Z", now)).toBe("3 dage og 5 timer siden");
    expect(ageText("2026-10-22T11:00:00Z", now)).toBe("1 dag og 1 time siden");
    expect(ageText("2026-10-23T09:30:00Z", now)).toBe("2 timer siden");
    expect(ageText("2026-10-21T12:00:00Z", now)).toBe("2 dage siden");
    expect(ageText("2026-10-23T11:30:00Z", now)).toBe("under en time siden");
    expect(ageText(null, now)).toBe(null);
    const p = { name: "@broberg/x", version: "1.0.0", install: "i", description: null, summary: null, layer: null, layerName: null, component: null, componentName: null, model: null, modelDesc: null, status: null, owner: null, graduate: false, note: null, keywords: [], npmUrl: null, repoUrl: null, publishedAt: "2026-10-20T07:00:00Z", provenance: "unknown" as const };
    const html = renderPackageDetail(p, null, [], [], { scannedAt: null, stale: true, reposScanned: 0, reposFailed: 0 }, now);
    expect(field(html, "Udgivet")).toBe("20.10.2026 kl. 09.00 (dansk tid)");
    expect(field(html, "Sidst opdateret")).toBe('<span data-testid="pkg-detail-age">3 dage og 5 timer siden</span>');
  });
});
