// F014.13 — the choice lives in a first-party cookie and expires after 12 months.
import { afterEach, describe, expect, it } from "vitest";
import { createConsentManager, createCookieConsentStorage, createMemoryConsentStorage } from "../src/index.js";

/** A document whose cookie jar records every raw write, so attributes can be asserted. */
function fakeDoc(protocol = "https:") {
  const writes: string[] = [];
  let jar = new Map<string, string>();
  const doc = {
    get cookie() { return Array.from(jar, ([k, v]) => `${k}=${v}`).join("; "); },
    set cookie(raw: string) {
      writes.push(raw);
      const [pair] = raw.split("; ");
      const i = pair!.indexOf("=");
      const k = pair!.slice(0, i), v = pair!.slice(i + 1);
      if (/Max-Age=0(;|$)/.test(raw)) jar.delete(k); else jar.set(k, v);
    },
  };
  (globalThis as any).document = doc;
  (globalThis as any).location = { protocol };
  return { writes, reset: () => { jar = new Map(); } };
}
afterEach(() => { delete (globalThis as any).document; delete (globalThis as any).location; });

describe("cookie attributes (AC#0)", () => {
  it("writes broberg-consent with Max-Age 365 days, Path=/, SameSite=Lax, Secure on https", () => {
    const { writes } = fakeDoc("https:");
    const m = createConsentManager({ policyVersion: "1", storage: createCookieConsentStorage() });
    m.rejectAll();
    expect(writes).toHaveLength(1);
    const raw = writes[0]!;
    expect(raw.startsWith("broberg-consent=")).toBe(true);
    expect(raw.split("; ").slice(1)).toStrictEqual(["Max-Age=31536000", "Path=/", "SameSite=Lax", "Secure"]);
    const value = JSON.parse(decodeURIComponent(raw.split("; ")[0]!.slice("broberg-consent=".length)));
    expect(value.policyVersion).toBe("1");
    expect(value.categories).toStrictEqual({ essential: true, analytics: false, marketing: false });
  });

  it("no Secure on plain http (localhost dev)", () => {
    const { writes } = fakeDoc("http:");
    createConsentManager({ policyVersion: "1", storage: createCookieConsentStorage() }).acceptAll();
    expect(writes[0]!.includes("Secure")).toBe(false);
  });

  it("round-trips: a fresh manager reads the stored choice back", () => {
    fakeDoc();
    createConsentManager({ policyVersion: "1", storage: createCookieConsentStorage() }).acceptAll();
    const again = createConsentManager({ policyVersion: "1", storage: createCookieConsentStorage() });
    expect(again.needsBanner()).toBe(false);
    expect(again.has("marketing")).toBe(true);
  });

  it("withdraw expires the cookie (Max-Age=0)", () => {
    const { writes } = fakeDoc();
    const m = createConsentManager({ policyVersion: "1", storage: createCookieConsentStorage() });
    m.acceptAll();
    m.withdraw();
    expect(writes.at(-1)!.includes("Max-Age=0")).toBe(true);
    expect(m.needsBanner()).toBe(true);
  });

  it("without a document it degrades to memory instead of throwing (SSR)", () => {
    expect(() => createCookieConsentStorage().set({ policyVersion: "1", acceptedAt: "x", categories: {} })).not.toThrow();
  });
});

describe("12-month expiry (AC#1)", () => {
  const DAY = 86400_000;
  const T0 = Date.UTC(2026, 8, 28);
  const at = (t: number, storage = createMemoryConsentStorage()) =>
    ({ storage, m: createConsentManager({ policyVersion: "1", storage, now: () => t }) });

  it("a choice older than 365 days asks again, and grants nothing meanwhile", () => {
    const { storage, m } = at(T0);
    m.acceptAll();
    const later = at(T0 + 366 * DAY, storage).m;
    expect(later.needsBanner()).toBe(true);
    expect(later.has("analytics")).toBe(false);
  });

  it("negative control: 364 days old → no banner, consent still holds", () => {
    const { storage, m } = at(T0);
    m.acceptAll();
    const later = at(T0 + 364 * DAY, storage).m;
    expect(later.needsBanner()).toBe(false);
    expect(later.has("analytics")).toBe(true);
  });

  it("maxAgeDays is configurable", () => {
    const storage = createMemoryConsentStorage();
    createConsentManager({ policyVersion: "1", storage, now: () => T0 }).acceptAll();
    const m = createConsentManager({ policyVersion: "1", storage, now: () => T0 + 31 * DAY, maxAgeDays: 30 });
    expect(m.needsBanner()).toBe(true);
  });
});

describe("cookie-domain (AC#2)", () => {
  it("domain sets Domain=; omitted is host-only", () => {
    const a = fakeDoc();
    createConsentManager({ policyVersion: "1", storage: createCookieConsentStorage({ domain: ".broberg.ai" }) }).rejectAll();
    expect(a.writes[0]!.includes("; Domain=.broberg.ai")).toBe(true);
    const b = fakeDoc();
    createConsentManager({ policyVersion: "1", storage: createCookieConsentStorage() }).rejectAll();
    expect(b.writes[0]!.includes("Domain=")).toBe(false);
  });
});
