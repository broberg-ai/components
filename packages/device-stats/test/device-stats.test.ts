import { describe, expect, it } from "vitest";
import * as mod from "../src/index";
import { deriveDevice, bucketWidth, deviceFromRequest } from "../src/index";
import { UA_FIXTURES } from "./fixtures";

const ua = (s: string) => ({ "user-agent": s });

describe("AC#2 — real User-Agent strings, with provenance", () => {
  it("carries at least 20 fixtures, and every one records where it came from", () => {
    expect(UA_FIXTURES.length).toBeGreaterThanOrEqual(20);
    for (const f of UA_FIXTURES) {
      expect(f.provenance, `${f.label} has no provenance`).toBeTruthy();
      expect(f.ua.startsWith("Mozilla/5.0"), `${f.label} is not a real UA`).toBe(true);
    }
  });

  it("covers the families the AC names", () => {
    const families = new Set(UA_FIXTURES.map((f) => f.expect.browserFamily));
    for (const want of ["Safari", "Chrome", "Firefox", "Edge", "Samsung Internet"]) {
      expect(families.has(want), `no fixture for ${want}`).toBe(true);
    }
    const os = new Set(UA_FIXTURES.map((f) => f.expect.osFamily));
    for (const want of ["iOS", "Android", "Windows", "macOS"]) {
      expect(os.has(want), `no fixture for ${want}`).toBe(true);
    }
  });

  it.each(UA_FIXTURES.map((f) => [f.label, f] as const))("derives %s", (_label, f) => {
    const got = deriveDevice({ headers: ua(f.ua) });
    expect(got.formFactor).toBe(f.expect.formFactor);
    expect(got.os.family).toBe(f.expect.osFamily);
    expect(got.os.majorVersion).toBe(f.expect.osMajor);
    expect(got.browser.family).toBe(f.expect.browserFamily);
  });
});

describe("AC#1 — pure, framework-free", () => {
  it("returns deep-equal output for identical input, called twice", () => {
    const input = { headers: ua(UA_FIXTURES[0]!.ua), launchCtx: "pwa", screenWidth: 393 };
    expect(deriveDevice(input)).toEqual(deriveDevice(input));
  });

  it("never mutates the caller's input", () => {
    const headers = ua(UA_FIXTURES[0]!.ua);
    const snapshot = JSON.stringify(headers);
    deriveDevice({ headers });
    expect(JSON.stringify(headers)).toBe(snapshot);
  });

  it("works with a Headers instance, a plain object and odd casing alike", () => {
    const s = UA_FIXTURES.find((f) => f.expect.osFamily === "iOS")!.ua;
    const fromHeaders = deriveDevice({ headers: new Headers({ "user-agent": s }) });
    const fromObject = deriveDevice({ headers: { "user-agent": s } });
    const fromCasing = deriveDevice({ headers: { "User-Agent": s } });
    expect(fromHeaders).toEqual(fromObject);
    expect(fromCasing).toEqual(fromObject);
  });

  it("survives being told nothing at all", () => {
    const got = deriveDevice();
    expect(got.formFactor).toBe("unknown");
    expect(got.os.majorVersion).toBe("unknown");
    expect(got.source).toBe("none");
  });
});

describe("AC#3 — never guess a version", () => {
  it("returns `unknown` for Chrome's UA-reduced Android sentinel, NOT the plausible 10", () => {
    const f = UA_FIXTURES.find((x) => x.label.includes("UA-reduced"))!;
    const got = deriveDevice({ headers: ua(f.ua) });
    // The string literally contains "Android 10". Parsing it is easy and wrong.
    expect(f.ua).toContain("Android 10");
    expect(got.os.majorVersion).toBe("unknown");
    expect(typeof got.os.majorVersion).not.toBe("number");
  });

  it("returns `unknown` for Windows NT 10.0 — Windows 10 and 11 are indistinguishable", () => {
    const got = deriveDevice({
      headers: ua("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"),
    });
    expect(got.os.family).toBe("Windows");
    expect(got.os.majorVersion).toBe("unknown");
  });

  it("returns `unknown` for Safari's frozen macOS 10_15_7", () => {
    const f = UA_FIXTURES.find((x) => x.label === "Desktop Safari")!;
    expect(f.ua).toContain("10_15_7");
    expect(deriveDevice({ headers: ua(f.ua) }).os.majorVersion).toBe("unknown");
  });

  it("still reports a REAL version when the UA carries one", () => {
    const got = deriveDevice({ headers: ua(UA_FIXTURES.find((x) => x.label === "Pixel 7")!.ua) });
    expect(got.os.majorVersion).toBe(14);
  });
});

describe("AC#4 — installed PWA vs browser, with no device access", () => {
  it("headers only → browser", () => {
    expect(deriveDevice({ headers: ua(UA_FIXTURES[0]!.ua) }).launch).toBe("browser");
  });

  it("launchCtx 'pwa' → installed", () => {
    expect(deriveDevice({ headers: ua(UA_FIXTURES[0]!.ua), launchCtx: "pwa" }).launch).toBe("installed");
  });

  it("accepts the other markers a manifest start_url might carry", () => {
    for (const m of ["installed", "standalone", "homescreen", "app", "PWA", " pwa "]) {
      expect(deriveDevice({ launchCtx: m }).launch, m).toBe("installed");
    }
  });

  it("an unrecognised marker is `unknown`, not silently `browser`", () => {
    // A marker we don't know means the app told us something we can't read —
    // that is different from the app telling us nothing, and collapsing the two
    // would hide a misconfigured start_url forever.
    expect(deriveDevice({ launchCtx: "utm_campaign_spring" }).launch).toBe("unknown");
    expect(deriveDevice({ launchCtx: null }).launch).toBe("browser");
  });
});

describe("AC#6 — screen buckets, boundaries on both sides", () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [360, "<=360"], [361, "361-768"],
    [768, "361-768"], [769, "769-1024"],
    [1024, "769-1024"], [1025, "1025-1440"],
    [1440, "1025-1440"], [1441, ">1440"],
  ];
  it.each(cases)("width %i → %s", (w, want) => {
    expect(bucketWidth(w)).toBe(want);
    expect(deriveDevice({ screenWidth: w }).screenBucket).toBe(want);
  });

  it("omits the bucket entirely when no width was supplied", () => {
    expect(deriveDevice({ headers: ua(UA_FIXTURES[0]!.ua) }).screenBucket).toBeUndefined();
  });

  it("rejects nonsense widths rather than bucketing them", () => {
    for (const w of [0, -1, NaN, Infinity]) expect(bucketWidth(w)).toBeUndefined();
  });
});

describe("AC#5 — anti-fingerprint, proven adversarially", () => {
  const full = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5.1 Mobile/15E148 Safari/604.1";

  it("exposes no way to obtain a FULL version string", () => {
    const got = deriveDevice({ headers: ua(full) });
    const serialised = JSON.stringify(got);
    expect(serialised).not.toContain("17.5.1");
    expect(serialised).not.toContain("605.1.15");
    expect(got.os.majorVersion).toBe(17);
  });

  it("exposes no way to obtain a RAW pixel width — only the bucket", () => {
    const got = deriveDevice({ headers: ua(full), screenWidth: 1237 });
    expect(JSON.stringify(got)).not.toContain("1237");
    expect(got.screenBucket).toBe("1025-1440");
  });

  it("returns no identifier, no hash, no timestamp — the whole surface is 6 known keys", () => {
    const got = deriveDevice({ headers: ua(full), launchCtx: "pwa", screenWidth: 393 });
    expect(Object.keys(got).sort()).toEqual(
      ["browser", "formFactor", "launch", "os", "screenBucket", "source"].sort(),
    );
    const serialised = JSON.stringify(got).toLowerCase();
    for (const forbidden of ["id", "hash", "fingerprint", "uuid", "timestamp"]) {
      expect(serialised, `result leaks a ${forbidden}`).not.toContain(`"${forbidden}`);
    }
  });

  it("two visits from the same device are INDISTINGUISHABLE from two devices", () => {
    const a = deriveDevice({ headers: ua(full), screenWidth: 393 });
    const b = deriveDevice({ headers: ua(full), screenWidth: 393 });
    expect(a).toEqual(b); // nothing carried forward, nothing unique
  });

  it("no option, second argument or export can widen the result", () => {
    // The adversary here is a future consumer who wants "just a bit more detail".
    // TS reports only the FIRST excess property in an object literal, so a
    // second @ts-expect-error here would be flagged as unused. One directive,
    // then the runtime check proves the extras are ignored rather than honoured.
    const widened = deriveDevice({
      headers: ua(full),
      screenWidth: 1237,
      // @ts-expect-error — there is deliberately no such option
      precise: true,
      raw: true,
    });
    expect(JSON.stringify(widened)).not.toContain("1237");
    expect(JSON.stringify(widened)).not.toContain("17.5.1");

    // And the module exports nothing that hands back raw detail. This is an
    // ALLOWLIST, not a snapshot: a new export must be added here deliberately,
    // which forces whoever adds one to think about whether it widens the
    // result. (It already caught `deviceFromRequest` being added in F078.2.)
    const exported = Object.keys(mod).sort();
    expect(exported).toEqual(["bucketWidth", "deriveDevice", "deviceFromRequest"]);
    expect(bucketWidth(1237)).toBe("1025-1440");

    // Every export that returns facts is held to the same bar.
    const viaRequest = mod.deviceFromRequest(
      { headers: ua(full), url: "https://x.dk/?src=pwa" },
      { screenWidth: 1237 },
    );
    const s = JSON.stringify(viaRequest);
    expect(s).not.toContain("1237");
    expect(s).not.toContain("17.5.1");
    expect(Object.keys(viaRequest).sort()).toEqual(
      ["browser", "formFactor", "launch", "os", "screenBucket", "source"].sort(),
    );
  });
});

describe("browser ordering is the contract", () => {
  it("Edge is not reported as Chrome, though its UA contains 'Chrome'", () => {
    const f = UA_FIXTURES.find((x) => x.label === "Desktop Edge")!;
    expect(f.ua).toContain("Chrome/");
    expect(deriveDevice({ headers: ua(f.ua) }).browser.family).toBe("Edge");
  });

  it("Samsung Internet is not reported as Chrome", () => {
    const f = UA_FIXTURES.find((x) => x.label.includes("Samsung"))!;
    expect(f.ua).toContain("Chrome/");
    expect(deriveDevice({ headers: ua(f.ua) }).browser.family).toBe("Samsung Internet");
  });

  it("Chrome on iOS is not reported as Safari, though its UA contains 'Safari'", () => {
    const f = UA_FIXTURES.find((x) => x.label.includes("CriOS"))!;
    expect(f.ua).toContain("Safari");
    expect(deriveDevice({ headers: ua(f.ua) }).browser.family).toBe("Chrome");
  });
});

describe("form factor — the absence of a token is the signal", () => {
  it("an Android TABLET is an Android UA WITHOUT the Mobile token", () => {
    const tablet = UA_FIXTURES.find((x) => x.label === "Galaxy Tab S4")!;
    const phone = UA_FIXTURES.find((x) => x.label === "Pixel 7")!;
    expect(tablet.ua).not.toContain("Mobile");
    expect(phone.ua).toContain("Mobile");
    expect(deriveDevice({ headers: ua(tablet.ua) }).formFactor).toBe("tablet");
    expect(deriveDevice({ headers: ua(phone.ua) }).formFactor).toBe("mobile");
  });

  it("an iPad is a tablet even though its UA carries the Mobile token", () => {
    const ipad = UA_FIXTURES.find((x) => x.label.startsWith("iPad"))!;
    expect(ipad.ua).toContain("Mobile/");
    expect(deriveDevice({ headers: ua(ipad.ua) }).formFactor).toBe("tablet");
  });
});

describe("evidence source", () => {
  it("reports which evidence produced the answer", () => {
    const s = UA_FIXTURES[0]!.ua;
    expect(deriveDevice({ headers: ua(s) }).source).toBe("ua");
    expect(deriveDevice({ headers: { "sec-ch-ua-mobile": "?1" } }).source).toBe("client-hints");
    expect(deriveDevice({ headers: { "user-agent": s, "sec-ch-ua-mobile": "?1" } }).source).toBe("mixed");
    expect(deriveDevice({}).source).toBe("none");
  });

  it("Client Hints refine what the UA could not say, and never overwrite it", () => {
    const s = UA_FIXTURES.find((x) => x.expect.osFamily === "iOS")!.ua;
    const got = deriveDevice({ headers: { "user-agent": s, "sec-ch-ua-platform": '"Windows"' } });
    expect(got.os.family).toBe("iOS"); // the UA said iOS; a hint does not override it
  });
});

// ---------------------------------------------------------------------------
// the page is not a dimension — a scope boundary, enforced
// ---------------------------------------------------------------------------

describe("no page path ever reaches the result", () => {
  const SENSITIVE = "/da/behandlinger/psych";

  it("reads the launch marker out of the query and nothing else from the URL", () => {
    const facts = deviceFromRequest({
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" },
      url: `https://klinik.example${SENSITIVE}?src=pwa&utm_source=nyhedsbrev`,
    });

    // The marker WAS found — so the URL really was read, and the assertion
    // below is about what was kept, not about a path that never arrived.
    expect(facts.launch).toBe("installed");

    const json = JSON.stringify(facts);
    expect(json).not.toContain("behandlinger");
    expect(json).not.toContain("psych");
    expect(json).not.toContain("klinik.example");
    expect(json).not.toContain("utm_source");
    expect(json).not.toContain("nyhedsbrev");
  });

  it("has no field for a page, a URL, an id or a session", () => {
    const facts = deriveDevice({ headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } });
    // An exact key list, so a future dimension cannot be added quietly.
    // sanneandersen measured why this matters: 543 rows, 119 with a user id,
    // paths like /da/vidensbank/burnout — a named person plus the treatment
    // she read about is GDPR article 9 data.
    expect(Object.keys(facts).sort()).toEqual(["browser", "formFactor", "launch", "os", "source"]);
    for (const forbidden of ["path", "url", "page", "referrer", "userId", "user_id", "sessionId", "session"]) {
      expect(facts).not.toHaveProperty(forbidden);
    }
  });
});
