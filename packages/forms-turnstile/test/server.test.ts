import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HONEYPOT_FIELD,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
  _resetRateLimiter,
  applySpamGauntlet,
  envDefaults,
  getSitekeyResponse,
  hashIp,
  isHoneypotTriggered,
  isRateLimited,
  validateTurnstile,
} from "../src/server";

afterEach(() => {
  _resetRateLimiter();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isHoneypotTriggered", () => {
  it("true when the honeypot field is filled", () => {
    expect(isHoneypotTriggered({ [HONEYPOT_FIELD]: "bot filled this" })).toBe(true);
  });

  it("false when the honeypot field is empty/absent", () => {
    expect(isHoneypotTriggered({})).toBe(false);
    expect(isHoneypotTriggered({ [HONEYPOT_FIELD]: "" })).toBe(false);
    expect(isHoneypotTriggered({ [HONEYPOT_FIELD]: null })).toBe(false);
  });
});

describe("hashIp", () => {
  it("returns an 8-hex-char digest, deterministic per input", () => {
    const a = hashIp("1.2.3.4");
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(hashIp("1.2.3.4")).toBe(a);
    expect(hashIp("5.6.7.8")).not.toBe(a);
  });
});

describe("isRateLimited", () => {
  it("counts hits and blocks once over maxPerHour", () => {
    const ipHash = hashIp("9.9.9.9");
    expect(isRateLimited(ipHash, "contact", 2)).toBe(false); // 1
    expect(isRateLimited(ipHash, "contact", 2)).toBe(false); // 2
    expect(isRateLimited(ipHash, "contact", 2)).toBe(true); // 3 > 2
  });

  it("resets the counter once the window (1h) has elapsed", () => {
    const ipHash = hashIp("9.9.9.10");
    const t0 = 1_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(t0);
    expect(isRateLimited(ipHash, "contact", 1)).toBe(false); // 1, within window
    expect(isRateLimited(ipHash, "contact", 1)).toBe(true); // 2 > 1, still within window

    vi.spyOn(Date, "now").mockReturnValue(t0 + 61 * 60 * 1000); // > 1h later
    expect(isRateLimited(ipHash, "contact", 1)).toBe(false); // window reset
  });

  it("keys are independent per formName", () => {
    const ipHash = hashIp("9.9.9.11");
    expect(isRateLimited(ipHash, "contact", 1)).toBe(false);
    expect(isRateLimited(ipHash, "newsletter", 1)).toBe(false); // different form, own counter
  });
});

describe("validateTurnstile", () => {
  it("returns true when siteverify reports success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }),
    );
    await expect(validateTurnstile("tok", TURNSTILE_TEST_SECRET_KEY)).resolves.toBe(true);
  });

  it("returns false when siteverify reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ success: false }) }),
    );
    await expect(validateTurnstile("tok", TURNSTILE_TEST_SECRET_KEY)).resolves.toBe(false);
  });

  it("posts secret + response (+ remoteip when given) as form-urlencoded", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await validateTurnstile("tok", "secret", "1.2.3.4");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("secret");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });
});

describe("applySpamGauntlet", () => {
  it("short-circuits on honeypot before rate-limit/turnstile run", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await applySpamGauntlet({
      honeypot: { body: { [HONEYPOT_FIELD]: "bot" } },
      rateLimit: { ipHash: hashIp("1.1.1.1"), formName: "contact", maxPerHour: 1 },
      turnstile: { token: "tok", secret: "secret" },
    });
    expect(result).toEqual({ blocked: true, reason: "honeypot" });
    expect(fetchMock).not.toHaveBeenCalled(); // never reached turnstile
  });

  it("short-circuits on rate-limit before turnstile runs", async () => {
    const ipHash = hashIp("2.2.2.2");
    isRateLimited(ipHash, "contact", 1); // consume the one allowed slot
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await applySpamGauntlet({
      rateLimit: { ipHash, formName: "contact", maxPerHour: 1 },
      turnstile: { token: "tok", secret: "secret" },
    });
    expect(result).toEqual({ blocked: true, reason: "rate-limit" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes clean when every configured layer passes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }),
    );
    const result = await applySpamGauntlet({
      honeypot: { body: {} },
      turnstile: { token: "tok", secret: TURNSTILE_TEST_SECRET_KEY },
    });
    expect(result).toEqual({ blocked: false });
  });

  it("blocks on a failed turnstile verification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ success: false }) }),
    );
    const result = await applySpamGauntlet({ turnstile: { token: "bad", secret: "secret" } });
    expect(result).toEqual({ blocked: true, reason: "turnstile" });
  });

  it("skips a layer entirely when its options key is absent (opt-in)", async () => {
    const result = await applySpamGauntlet({});
    expect(result).toEqual({ blocked: false });
  });
});

describe("envDefaults", () => {
  it("mirrors the Cloudflare always-pass test keys under the real env-var names", () => {
    expect(envDefaults).toEqual({
      TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
      TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
    });
  });

  it("resolves a form end-to-end in local dev/CI with no real keys (xrt81 pattern)", async () => {
    // Mirrors a consuming repo's Zod env schema: z.string().default(envDefaults.TURNSTILE_SECRET_KEY)
    const env = {
      TURNSTILE_SITE_KEY: envDefaults.TURNSTILE_SITE_KEY,
      TURNSTILE_SECRET_KEY: envDefaults.TURNSTILE_SECRET_KEY,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }),
    );
    const result = await applySpamGauntlet({
      turnstile: { token: "any-token", secret: env.TURNSTILE_SECRET_KEY },
    });
    expect(result).toEqual({ blocked: false });
  });
});

describe("getSitekeyResponse", () => {
  it("wraps a site key in the single-source runtime-config shape", () => {
    expect(getSitekeyResponse(TURNSTILE_TEST_SITE_KEY)).toEqual({
      turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
    });
  });
});
