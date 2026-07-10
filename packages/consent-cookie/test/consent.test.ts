import { describe, it, expect } from "vitest";
import {
  createConsentManager,
  createMemoryConsentStorage,
  createLocalStorageConsentStorage,
  CONSENT_CATEGORIES,
  type ConsentStorage,
} from "../src/index.js";

function mgr(version = "1.0", storage: ConsentStorage = createMemoryConsentStorage()) {
  return { manager: createConsentManager({ policyVersion: version, storage }), storage };
}

describe("createConsentManager — banner gating", () => {
  it("needs the banner when storage is empty", () => {
    const { manager } = mgr();
    expect(manager.needsBanner()).toBe(true);
    expect(manager.isOutdated()).toBe(false); // no record ≠ outdated
    expect(manager.getRecord()).toBeNull();
  });

  it("hides the banner once consent for the current version is stored", () => {
    const { manager } = mgr();
    manager.acceptAll();
    expect(manager.needsBanner()).toBe(false);
  });

  it("re-surfaces when the stored version differs (policy updated)", () => {
    const storage = createMemoryConsentStorage();
    createConsentManager({ policyVersion: "1.0", storage }).acceptAll();
    const later = createConsentManager({ policyVersion: "1.1", storage });
    expect(later.needsBanner()).toBe(true);
    expect(later.isOutdated()).toBe(true);
  });

  it("treats a legacy record with no version as outdated", () => {
    const storage = createMemoryConsentStorage();
    storage.set({ policyVersion: "", acceptedAt: "x", categories: { essential: true, analytics: true } });
    const manager = createConsentManager({ policyVersion: "1.0", storage });
    expect(manager.needsBanner()).toBe(true);
  });
});

describe("createConsentManager — decisions", () => {
  it("acceptAll grants every category incl. essential", () => {
    const { manager } = mgr();
    const rec = manager.acceptAll();
    expect(rec.categories).toEqual({ essential: true, analytics: true, marketing: true });
    expect(rec.policyVersion).toBe("1.0");
    expect(rec.acceptedAt).toMatch(/\dT\d/); // ISO-ish
    expect(manager.has("analytics")).toBe(true);
  });

  it("rejectAll grants only essential", () => {
    const { manager } = mgr();
    const rec = manager.rejectAll();
    expect(rec.categories).toEqual({ essential: true, analytics: false, marketing: false });
    expect(manager.has("analytics")).toBe(false);
    expect(manager.has("essential")).toBe(true);
  });

  it("setConsent applies a partial selection, essential forced on, unlisted off", () => {
    const { manager } = mgr();
    const rec = manager.setConsent({ analytics: true });
    expect(rec.categories).toEqual({ essential: true, analytics: true, marketing: false });
  });

  it("has('essential') is always true even with no record", () => {
    const { manager } = mgr();
    expect(manager.has("essential")).toBe(true);
    expect(manager.has("analytics")).toBe(false);
  });
});

describe("createConsentManager — subscribe + withdraw", () => {
  it("notifies subscribers on every change", () => {
    const { manager } = mgr();
    const seen: (string | null)[] = [];
    const off = manager.subscribe((r) => seen.push(r ? r.policyVersion : null));
    manager.acceptAll();
    manager.rejectAll();
    manager.withdraw();
    expect(seen).toEqual(["1.0", "1.0", null]);
    off();
    manager.acceptAll();
    expect(seen).toHaveLength(3); // no more after unsubscribe
  });

  it("withdraw clears the record → banner returns (GDPR right to withdraw)", () => {
    const { manager } = mgr();
    manager.acceptAll();
    expect(manager.needsBanner()).toBe(false);
    manager.withdraw();
    expect(manager.getRecord()).toBeNull();
    expect(manager.needsBanner()).toBe(true);
  });
});

describe("createConsentManager — config", () => {
  it("throws without a policyVersion", () => {
    // @ts-expect-error intentional
    expect(() => createConsentManager({ storage: createMemoryConsentStorage() })).toThrow(/policyVersion/);
  });

  it("honours a custom category set", () => {
    const manager = createConsentManager({
      policyVersion: "1.0",
      storage: createMemoryConsentStorage(),
      categories: [
        { key: "essential", label: "E", description: "", essential: true },
        { key: "personalization", label: "P", description: "" },
      ],
    });
    const rec = manager.acceptAll();
    expect(Object.keys(rec.categories).sort()).toEqual(["essential", "personalization"]);
    expect(manager.has("personalization")).toBe(true);
  });

  it("exports the default category set with essential-first", () => {
    expect(CONSENT_CATEGORIES[0].key).toBe("essential");
    expect(CONSENT_CATEGORIES[0].essential).toBe(true);
    expect(CONSENT_CATEGORIES.map((c) => c.key)).toContain("marketing");
  });
});

describe("localStorage storage (via injected mock)", () => {
  it("round-trips a record through a Storage-shaped mock", () => {
    const map = new Map<string, string>();
    const mockLs = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    (globalThis as unknown as { localStorage: unknown }).localStorage = mockLs;
    try {
      const storage = createLocalStorageConsentStorage("app-consent");
      const manager = createConsentManager({ policyVersion: "2.0", storage });
      manager.acceptAll();
      expect(map.get("app-consent")).toContain('"policyVersion":"2.0"');
      // a fresh manager reads it back
      const again = createConsentManager({ policyVersion: "2.0", storage: createLocalStorageConsentStorage("app-consent") });
      expect(again.needsBanner()).toBe(false);
    } finally {
      delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    }
  });
});
