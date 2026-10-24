// F038.31 — every package card shows its npm link, when it was last published
// (Danish time) and whether it was published via Trusted Publisher.
import { describe, expect, it, vi } from "vitest";
import { fetchLatestReleases } from "../../scripts/npm-latest.mjs";
import { readFileSync } from "node:fs";
import { daTime, npmMeta, npmMetaRow, npmMetaMd } from "../../scripts/npm-meta.mjs";
import { DATA, npmUrl } from "../../scripts/inventory-data.mjs";
process.env.ENROLL_DB_URL = ":memory:";
import { app } from "./server";
import { getEnrollStore } from "./enroll";
import { createHash } from "node:crypto";

const REL = [
  { pkg: "@broberg/a", version: "1.0.0", published: "2026-10-22T22:40:12.833Z", provenance: true },
  { pkg: "@broberg/b", version: "0.1.0", published: "2026-01-15T12:00:00.000Z", provenance: false },
];

describe("daTime — Danish time, zone named, DST-correct", () => {
  it("22:40 UTC on 22 Oct (summer time, UTC+2) is 00.40 on the 23rd — the midnight case", () => {
    expect(daTime("2026-10-22T22:40:12.833Z")).toBe("23.10.2026 kl. 00.40 (dansk tid)");
  });
  it("12:00 UTC on 15 Jan (winter time, UTC+1) is 13.00 — a fixed +2 would say 14.00", () => {
    expect(daTime("2026-01-15T12:00:00.000Z")).toBe("15.01.2026 kl. 13.00 (dansk tid)");
  });
  it("no time → null, never a made-up one", () => {
    expect(daTime(undefined)).toBeNull();
    expect(daTime("not a date")).toBeNull();
  });
});

describe("npmMeta — three provenance states, never a guess", () => {
  it("yes / no from the registry, unknown when npm did not answer for the package", () => {
    expect(npmMeta("@broberg/a", REL)).toEqual({ npmUrl: "https://www.npmjs.com/package/@broberg/a", version: "1.0.0", publishedAt: "2026-10-22T22:40:12.833Z", provenance: "yes" });
    expect(npmMeta("@broberg/b", REL).provenance).toBe("no");
    expect(npmMeta("@broberg/zz", REL)).toEqual({ npmUrl: "https://www.npmjs.com/package/@broberg/zz", version: null, publishedAt: null, provenance: "unknown" });
  });

  it("the card row carries link, time and label for each state", () => {
    const yes = npmMetaRow("f1", npmMeta("@broberg/a", REL));
    expect(yes).toContain('href="https://www.npmjs.com/package/@broberg/a"');
    expect(yes).toContain('data-testid="card-npm-f1"');
    expect(yes).toContain("udgivet 23.10.2026 kl. 00.40 (dansk tid)");
    expect(yes).toContain("Trusted Publisher ✓");
    expect(npmMetaRow("f2", npmMeta("@broberg/b", REL))).toContain("ingen provenance");
    const unk = npmMetaRow("f3", npmMeta("@broberg/zz", REL));
    expect(unk).toContain("udgivelsestid ukendt");
    expect(unk).toContain("provenance ukendt");
  });

  it("llms.txt fragment says the same", () => {
    expect(npmMetaMd(npmMeta("@broberg/a", REL))).toBe("https://www.npmjs.com/package/@broberg/a · udgivet 23.10.2026 kl. 00.40 (dansk tid) · Trusted Publisher ✓");
  });
});

describe("the committed build", () => {
  const html = readFileSync(new URL("../../docs/inventory.html", import.meta.url), "utf8");
  const shippedNpm = (DATA as { items?: { pkg?: string; f?: string }[] }[]).flatMap((L) => L.items ?? []).filter((it) => Boolean(npmUrl(it)) && String(it.pkg).startsWith("@broberg/"));

  it("one visible npm link per published @broberg package card", () => {
    expect(html.match(/data-testid="card-npm-[^"]+"/g)?.length).toBe(shippedNpm.length);
  });

  it("the drawer of every published package says when it was published, its provenance, and when consumers were scanned", () => {
    const detail = JSON.parse(html.match(/var DETAIL=(\{.*?\});\n/)![1]) as Record<string, string>;
    for (const it of shippedNpm as { f?: string }[]) {
      const d = detail[it.f!]!;
      expect(d).toContain(`data-testid="d-published-${it.f!.toLowerCase()}"`);
      expect(d).toContain(`data-testid="d-provenance-${it.f!.toLowerCase()}"`);
      expect(d).toMatch(/data-testid="d-scanned-[^"]+">\d\d\.\d\d\.\d{4} kl\. \d\d\.\d\d \(dansk tid\)</);
    }
  });

  it("every card row has a publish time and a provenance label", () => {
    expect(html.match(/data-testid="card-published-[^"]+"/g)?.length).toBe(shippedNpm.length);
    expect(html.match(/data-testid="card-provenance-[^"]+"/g)?.length).toBe(shippedNpm.length);
  });
});

describe("/api/packages carries the same facts", () => {
  it("each npm package has npmUrl, publishedAt and provenance equal to the build's npm-meta.json", async () => {
    const k = "m".repeat(64);
    await (await getEnrollStore())!.bindSessionKey("t-meta", createHash("sha256").update(k).digest("hex"));
    const res = await app.request("/api/packages", { headers: { "x-discovery-session": "t-meta", "x-enroll-key": k } });
    expect(res.status).toBe(200);
    const { packages } = (await res.json()) as { packages: { name: string; npmUrl: string | null; publishedAt: string | null; provenance: string }[] };
    const meta = JSON.parse(readFileSync(new URL("../../docs/npm-meta.json", import.meta.url), "utf8"));
    const webpush = packages.find((p) => p.name === "@broberg/webpush")!;
    expect({ npmUrl: webpush.npmUrl, publishedAt: webpush.publishedAt, provenance: webpush.provenance }).toEqual({
      npmUrl: meta["@broberg/webpush"].npmUrl,
      publishedAt: meta["@broberg/webpush"].publishedAt,
      provenance: meta["@broberg/webpush"].provenance,
    });
    expect(packages.filter((p) => p.name?.startsWith("@broberg/")).every((p) => ["yes", "no", "unknown"].includes(p.provenance))).toBe(true);
  });
});

describe("fetchLatestReleases reads provenance off the LATEST version's attestations", () => {
  it("attested latest → true; latest without attestations → false even if an OLDER version had them", async () => {
    const docs: Record<string, unknown> = {
      "@broberg/x": { "dist-tags": { latest: "0.2.1" }, time: { "0.2.1": "2026-10-01T10:00:00Z" }, versions: { "0.2.1": { dist: { attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } } } } } },
      "@broberg/y": { "dist-tags": { latest: "0.2.0" }, time: { "0.2.0": "2026-10-02T10:00:00Z" }, versions: { "0.1.0": { dist: { attestations: { provenance: {} } } }, "0.2.0": { dist: {} } } },
    };
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      const name = decodeURIComponent(String(url).split("/").pop()!);
      return new Response(JSON.stringify(docs[name]), { status: 200 });
    }) as never);
    const r = await fetchLatestReleases(["@broberg/x", "@broberg/y"]);
    spy.mockRestore();
    expect(Object.fromEntries(r.map((x: { pkg: string; provenance: boolean }) => [x.pkg, x.provenance]))).toEqual({ "@broberg/x": true, "@broberg/y": false });
  });
});

describe("F038.43 — Trusted Publisher is read off _npmUser.trustedPublisher, not only off a provenance attestation", () => {
  it("TP from a PRIVATE repo (no attestation, trustedPublisher set) → true; a person's local publish → false", async () => {
    const docs: Record<string, unknown> = {
      // shape measured on @broberg/lens-daemon 0.1.34, 25/10 2026
      "@broberg/priv": { "dist-tags": { latest: "0.1.34" }, time: { "0.1.34": "2026-10-24T20:42:02Z" }, versions: { "0.1.34": { _npmUser: { name: "GitHub Actions", email: "npm-oidc-no-reply@github.com", trustedPublisher: { id: "github", oidcConfigId: "x" } }, dist: {} } } },
      // shape measured on @broberg/nativepush 0.1.0 (local bootstrap)
      "@broberg/local": { "dist-tags": { latest: "0.1.0" }, time: { "0.1.0": "2026-10-24T20:10:00Z" }, versions: { "0.1.0": { _npmUser: { name: "cbroberg", email: "cb@webhouse.dk" }, dist: {} } } },
    };
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      const name = decodeURIComponent(String(url).split("/").pop()!);
      return new Response(JSON.stringify(docs[name]), { status: 200 });
    }) as never);
    const r = await fetchLatestReleases(["@broberg/priv", "@broberg/local"]);
    spy.mockRestore();
    expect(Object.fromEntries(r.map((x: { pkg: string; provenance: boolean }) => [x.pkg, x.provenance]))).toEqual({ "@broberg/priv": true, "@broberg/local": false });
  });
});

