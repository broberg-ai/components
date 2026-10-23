// F038.35 — the package page: every field, and who in the fleet installs it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
process.env.ENROLL_DB_URL = ":memory:";
import { app } from "./server";
import { getEnrollStore } from "./enroll";
import { consumersOf } from "../../scripts/fleet-graph.mjs";
import { consumerDetails, renderPackageDetail } from "./package-detail-page";

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
    const p = { name: "@broberg/x", version: "1.0.0", install: "npm i @broberg/x", description: null, layer: null, layerName: null, component: null, componentName: null, model: null, modelDesc: null, status: null, owner: null, graduate: false, note: null, keywords: [], npmUrl: null, repoUrl: null, publishedAt: null, provenance: "unknown" as const };
    const fresh = renderPackageDetail(p, null, [], [], { scannedAt: new Date().toISOString(), stale: false, reposScanned: 70, reposFailed: 0 });
    const missing = renderPackageDetail(p, null, [], [], { scannedAt: null, stale: true, reposScanned: 0, reposFailed: 0 });
    expect(fresh).toContain('data-testid="pkg-detail-consumers-empty" data-reason="none"');
    expect(missing).toContain('data-testid="pkg-detail-consumers-empty" data-reason="no-scan"');
    // a missing field reads «ukendt»/«ingen», never an empty cell
    expect(field(fresh, "Ejer")).toBe('<span class="pd-none">ukendt</span>');
    expect(field(fresh, "Beskrivelse")).toBe('<span class="pd-none">ingen</span>');
  });

  it("the dependency check is shown in full; «kunne ikke tjekke» keeps its reason", () => {
    const p = { name: "@broberg/x", version: "1.0.0", install: "i", description: null, layer: null, layerName: null, component: null, componentName: null, model: null, modelDesc: null, status: null, owner: null, graduate: false, note: null, keywords: [], npmUrl: null, repoUrl: null, publishedAt: null, provenance: "unknown" as const };
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
