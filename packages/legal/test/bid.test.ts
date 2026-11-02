// F110.6 — the helpers against BID's live routes, with a fake fetch that records
// exactly what was sent and answers like BID does.
import { describe, expect, it } from "vitest";
import { BidConsentError, getAcceptance, getConsent, needsReaccept, recordAcceptance, recordConsent, toBidHash } from "../src/index";

const HEX = "a".repeat(64);
function fakeBid(respond: (req: { url: string; method: string; auth: string | null; body: any }) => { status: number; body?: unknown }) {
  const seen: { url: string; method: string; auth: string | null; body: any }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const req = { url, method: init?.method ?? "GET", auth: (init?.headers as Record<string, string>)?.authorization ?? null, body: init?.body ? JSON.parse(init.body as string) : undefined };
    seen.push(req);
    const { status, body } = respond(req);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { f, seen };
}
const echo = (extra: Record<string, unknown>) => (r: { body: any }) => ({ status: 201, body: { sub: "u1", product: "jam", clientId: "jam-web", ...r.body, ...extra } });

describe("terms acceptance in BID", () => {
  it("POSTs to /api/app/terms-acceptance with the user's token and a sha256: hash, and returns the row BID stored", async () => {
    const { f, seen } = fakeBid(echo({ acceptedAt: 1 }));
    const row = await recordAcceptance({ accessToken: "TOKEN", fetch: f }, { doc: "terms", version: "2026-11-01", contentHash: HEX });
    expect(seen[0]).toEqual({ url: "https://id.broberg.ai/api/app/terms-acceptance", method: "POST", auth: "Bearer TOKEN", body: { doc: "terms", version: "2026-11-01", contentHash: `sha256:${HEX}` } });
    expect(row).toMatchObject({ product: "jam", doc: "terms", version: "2026-11-01", contentHash: `sha256:${HEX}` });
  });
  it("refuses a stored row that does not echo what was sent (a green «saved» over a no-op)", async () => {
    const { f } = fakeBid(() => ({ status: 201, body: { doc: "terms", version: "OLD", contentHash: `sha256:${HEX}` } }));
    await expect(recordAcceptance({ accessToken: "T", fetch: f }, { doc: "terms", version: "2026-11-01", contentHash: HEX })).rejects.toMatchObject({ code: "not_echoed" });
  });
  it("reads the latest acceptance, or null when there is none", async () => {
    const { f, seen } = fakeBid(() => ({ status: 200, body: { acceptance: null } }));
    expect(await getAcceptance({ accessToken: "T", fetch: f }, "terms")).toBeNull();
    expect(seen[0]).toMatchObject({ url: "https://id.broberg.ai/api/app/terms-acceptance?doc=terms", method: "GET", auth: "Bearer T" });
  });
  it("turns BID's errors into BidConsentError with status and code", async () => {
    const { f } = fakeBid(() => ({ status: 401, body: { error: "invalid_token" } }));
    const err = await getAcceptance({ accessToken: "bad", fetch: f }, "terms").catch((e) => e);
    expect(err).toBeInstanceOf(BidConsentError);
    expect([err.status, err.code]).toEqual([401, "invalid_token"]);
    const { f: f400 } = fakeBid(() => ({ status: 400, body: { error: "invalid_hash" } }));
    await expect(recordAcceptance({ accessToken: "T", fetch: f400 }, { doc: "terms", version: "x", contentHash: "nope" })).rejects.toMatchObject({ status: 400, code: "invalid_hash" });
  });
});

describe("GDPR consent in BID", () => {
  it("records a consent and a withdrawal, each read back", async () => {
    const { f, seen } = fakeBid(echo({ at: 2 }));
    const given = await recordConsent({ accessToken: "T", fetch: f }, { purpose: "health-text-analysis", granted: true, version: "2026-11-01", contentHash: HEX });
    const withdrawn = await recordConsent({ accessToken: "T", fetch: f }, { purpose: "health-text-analysis", granted: false, version: "2026-11-01", contentHash: HEX });
    expect(seen.map((s) => [s.url, s.body.granted])).toEqual([["https://id.broberg.ai/api/app/consents", true], ["https://id.broberg.ai/api/app/consents", false]]);
    expect([given.granted, withdrawn.granted]).toEqual([true, false]);
  });
  it("refuses a stored consent whose granted does not match (a withdrawal that did not take)", async () => {
    const { f } = fakeBid((r) => ({ status: 201, body: { ...r.body, granted: true } }));
    await expect(recordConsent({ accessToken: "T", fetch: f }, { purpose: "p", granted: false, version: "v", contentHash: HEX })).rejects.toMatchObject({ code: "not_echoed" });
  });
  it("reads the current state, including a withdrawal made on the BID account", async () => {
    const { f, seen } = fakeBid(() => ({ status: 200, body: { consent: { purpose: "p", granted: false, clientId: "bid-account" } } }));
    const c = await getConsent({ accessToken: "T", fetch: f }, "health-text-analysis");
    expect(seen[0]?.url).toBe("https://id.broberg.ai/api/app/consents?purpose=health-text-analysis");
    expect([c?.granted, c?.clientId]).toEqual([false, "bid-account"]);
  });
});

describe("needsReaccept", () => {
  it("asks when never accepted; not when the same version", () => {
    expect(needsReaccept(null, { version: "2026-11-01", material: false })).toBe(true);
    expect(needsReaccept({ version: "2026-11-01" }, { version: "2026-11-01", material: true })).toBe(false);
  });
  it("asks again for a MATERIAL newer version, not for a non-material one", () => {
    expect(needsReaccept({ version: "2026-11-01" }, { version: "2027-01-15", material: true })).toBe(true);
    expect(needsReaccept({ version: "2026-11-01" }, { version: "2027-01-15", material: false })).toBe(false);
  });
});

it("toBidHash adds the prefix once", () => {
  expect([toBidHash(HEX), toBidHash(`sha256:${HEX}`)]).toEqual([`sha256:${HEX}`, `sha256:${HEX}`]);
});
