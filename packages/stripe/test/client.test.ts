import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createStripeClient,
  createFeeCalculator,
  STRIPE_API_VERSION,
  type StripeConstructor,
} from "../src/index.js";

describe("createStripeClient (dark-ship)", () => {
  beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("returns disabled + null and does NOT throw when no secret key", () => {
    let client: ReturnType<typeof createStripeClient> | undefined;
    expect(() => {
      client = createStripeClient();
    }).not.toThrow();
    expect(client!.enabled).toBe(false);
    expect(client!.stripe).toBeNull();
    expect(client!.isTestMode).toBe(false);
  });

  it("constructs with the pinned apiVersion and reports test mode from the key prefix", () => {
    const ctor = vi.fn(function (this: Record<string, unknown>, key: string, config: unknown) {
      this.key = key;
      this.config = config;
    });

    const test = createStripeClient({
      secretKey: "sk_test_abc",
      stripeCtor: ctor as unknown as StripeConstructor,
    });
    expect(test.enabled).toBe(true);
    expect(test.isTestMode).toBe(true);
    expect(ctor).toHaveBeenCalledWith(
      "sk_test_abc",
      expect.objectContaining({ apiVersion: STRIPE_API_VERSION }),
    );

    const live = createStripeClient({
      secretKey: "sk_live_abc",
      stripeCtor: ctor as unknown as StripeConstructor,
    });
    expect(live.isTestMode).toBe(false);
  });
});

describe("createFeeCalculator", () => {
  it("computes integer-øre application fees from injected percents", () => {
    const fees = createFeeCalculator({ booking: 1, shop_online: 30 });
    expect(fees.calculateApplicationFee(10000, "booking")).toBe(100);
    expect(fees.calculateApplicationFee(5000, "shop_online")).toBe(1500);
    expect(fees.percentFor("booking")).toBe(1);
  });

  it("returns 0 (with a warn), never NaN, for an unknown type", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fees = createFeeCalculator({ booking: 1 });
    const fee = fees.calculateApplicationFee(10000, "does_not_exist");
    expect(fee).toBe(0);
    expect(Number.isNaN(fee)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
