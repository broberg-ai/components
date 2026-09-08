import { describe, it, expect } from "vitest";
import { checkSpecDrift, FIELD_EXPECTATIONS } from "../src/spec-drift.js";

// Built from the REAL spec's shape, measured 2026-09-08 (version
// 2026-08-26.dahlia). The two absent fields are absent in the real document —
// they are F098.4 and F102 themselves.
const realShape = () => ({
  info: { version: "2026-08-26.dahlia" },
  components: {
    schemas: {
      subscription: { properties: { id: {}, items: {} } }, // no current_period_end — moved
      subscription_item: { properties: { current_period_end: {}, current_period_start: {} } },
      invoice: { properties: { parent: {}, lines: {} } }, // no subscription — removed
    },
  },
});

const spec = (o: unknown) => ({ fetchSpec: async () => o });

describe("checkSpecDrift — the published spec, no account, no key", () => {
  it("today's real shape → ok, and it names the spec version", async () => {
    const r = await checkSpecDrift(spec(realShape()));
    expect(r.status).toBe("ok");
    expect(r.specVersion).toBe("2026-08-26.dahlia");
  });

  it("the FALLBACKS are reported absent WITHOUT causing drift", async () => {
    // Both are absent in the real spec right now. Asserting them would turn a
    // change in our favour into a red check.
    const r = await checkSpecDrift(spec(realShape()));
    const fallbacks = r.findings.filter((f) => f.role === "fallback");
    expect(fallbacks).toHaveLength(2);
    expect(fallbacks.every((f) => !f.present)).toBe(true);
    expect(r.status).toBe("ok");
  });

  it("F098.4 AGAIN: the item loses current_period_end → DRIFT, naming the field", async () => {
    const s = realShape();
    delete (s.components.schemas.subscription_item.properties as Record<string, unknown>)
      .current_period_end;
    const r = await checkSpecDrift(spec(s));
    expect(r.status).toBe("drift");
    const f = r.findings.find((x) => x.schema === "subscription_item");
    expect(f).toMatchObject({ reader: "readPeriod", role: "primary", present: false });
  });

  it("F102 AGAIN: invoice loses parent → DRIFT", async () => {
    const s = realShape();
    delete (s.components.schemas.invoice.properties as Record<string, unknown>).parent;
    const r = await checkSpecDrift(spec(s));
    expect(r.status).toBe("drift");
    expect(r.findings.find((x) => x.property === "parent")?.present).toBe(false);
  });

  // THE OUTCOME THAT GETS COLLAPSED. GitHub being unreachable says nothing
  // about Stripe and nothing about us.
  it("a fetch failure is UNKNOWN — never drift, never ok", async () => {
    const r = await checkSpecDrift({
      fetchSpec: async () => {
        throw new Error("getaddrinfo ENOTFOUND raw.githubusercontent.com");
      },
    });
    expect(r.status).toBe("unknown");
    expect(r.status).not.toBe("drift");
    expect(r.reason).toMatch(/could not read the Stripe spec/);
  });

  it("a document that is not the spec is UNKNOWN, not ok", async () => {
    // An empty object has no fields, so a naive check would report every
    // primary missing and cry drift about a 404 page.
    for (const junk of [{}, { hello: "world" }, null, "<html>404</html>"]) {
      const r = await checkSpecDrift(spec(junk));
      expect(r.status, JSON.stringify(junk)).toBe("unknown");
    }
  });

  it("every expectation names a reader that exists, and both roles are covered", async () => {
    // A zero-length or one-sided list would pass every check above.
    expect(FIELD_EXPECTATIONS.length).toBeGreaterThanOrEqual(4);
    expect(FIELD_EXPECTATIONS.some((e) => e.role === "primary")).toBe(true);
    expect(FIELD_EXPECTATIONS.some((e) => e.role === "fallback")).toBe(true);
    for (const e of FIELD_EXPECTATIONS)
      expect(["readPeriod", "readSubscriptionId"]).toContain(e.reader);
  });
});
