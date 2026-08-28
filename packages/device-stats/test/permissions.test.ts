import { describe, expect, it, vi } from "vitest";
import {
  PERMISSION_NAMES,
  readPermissionFacts,
  type PermissionsGlobalLike,
} from "../src/permissions.js";
import { collectDeviceDetail } from "../src/client.js";
import { readFileSync, readdirSync } from "node:fs";

// ---------------------------------------------------------------------------
// fixtures — browsers, as they actually answer
// ---------------------------------------------------------------------------

/** Chrome/Edge/Firefox: the Permissions API answers for every name. */
const chromium = (states: Record<string, string>): PermissionsGlobalLike => ({
  navigator: { permissions: { query: async ({ name }) => ({ state: states[name] ?? "prompt" }) } },
  Notification: { permission: "default" },
  PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true },
});

/**
 * A browser whose `permissions.query` exists but THROWS TypeError on a name it
 * does not know — the spec's own way of rejecting an unrecognised name.
 *
 * NOT LABELLED "Safari" ANY MORE: measured 2026-08-28, Playwright's WebKit
 * answers `prompt` for all four names, so the documentation-based claim that
 * Safari refuses geolocation did not reproduce. The SHAPE still has to be
 * handled — it is what the spec says — but naming an engine we did not observe
 * would put a fact in the test suite that no measurement supports.
 */
const throwsOnUnknownName = (notification = "granted"): PermissionsGlobalLike => ({
  navigator: {
    permissions: {
      query: async ({ name }) => {
        if (name === "notifications") return { state: "granted" };
        throw new TypeError(`The permission name '${name}' is not supported.`);
      },
    },
  },
  Notification: { permission: notification },
  PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true },
});

/** An old browser with no Permissions API at all. */
const ancient = (): PermissionsGlobalLike => ({ navigator: {}, Notification: { permission: "denied" } });

// ---------------------------------------------------------------------------
// AC 1 — five states, and `unsupported` is not `denied`
// ---------------------------------------------------------------------------

describe("the browser refusing to answer is not the user saying no", () => {
  it("THE CASE THIS CARD EXISTS FOR: a browser that will not answer gives `unsupported` — never `denied`", async () => {
    const facts = await readPermissionFacts(throwsOnUnknownName());
    expect(facts.geolocation).toBe("unsupported");
    expect(facts.geolocation).not.toBe("denied");
    // Fold these two together and a browser that declined to answer is counted
    // as a user who refused. Measured on 2026-08-28: WebKit and Chromium gave
    // OPPOSITE answers (prompt vs denied) for the same page, so what a read
    // means varies by engine — which is exactly why it must be able to say
    // "I could not ask" at all.
  });

  it("three different navigators produce three different answers, not one", async () => {
    const noApi = await readPermissionFacts(ancient());
    const throws = await readPermissionFacts(throwsOnUnknownName());
    const says = await readPermissionFacts(chromium({ geolocation: "denied" }));
    expect([noApi.geolocation, throws.geolocation, says.geolocation]).toEqual([
      "unsupported",
      "unsupported",
      "denied",
    ]);
  });

  it("a query that rejects with a NON-TypeError is `error`, distinct from `unsupported`", async () => {
    const flaky: PermissionsGlobalLike = {
      navigator: { permissions: { query: async () => { throw new Error("SecurityError"); } } },
    };
    const facts = await readPermissionFacts(flaky);
    expect(facts.geolocation).toBe("error");
    expect(facts.geolocation).not.toBe("unsupported");
    expect(facts.geolocation).not.toBe("denied");
  });

  it("`prompt` survives as itself — not-asked-yet is the most actionable state there is", async () => {
    const facts = await readPermissionFacts(chromium({ camera: "prompt", microphone: "denied" }));
    expect(facts.camera).toBe("prompt");
    expect(facts.microphone).toBe("denied");
  });

  it("a state string the browser invents is `unsupported`, never silently passed through", async () => {
    const facts = await readPermissionFacts(chromium({ geolocation: "maybe" }));
    expect(facts.geolocation).toBe("unsupported");
  });

  it("the OLDER notification source is used when the Permissions API has no answer", async () => {
    // This branch was completely unexercised until a mutation exposed it: every
    // other fixture lets permissions.query answer for `notifications`, so the
    // fallback never ran. It is the path that matters on a browser without the
    // Permissions API — i.e. exactly the browsers this card is about.
    const viaNotificationOnly = (permission: string): PermissionsGlobalLike => ({
      navigator: {}, // no Permissions API at all
      Notification: { permission },
    });
    // "default" is the Notification API's word for "not asked yet" — it MUST map
    // onto `prompt`, or every never-asked visitor is filed under the wrong state.
    expect((await readPermissionFacts(viaNotificationOnly("default"))).notifications).toBe("prompt");
    expect((await readPermissionFacts(viaNotificationOnly("granted"))).notifications).toBe("granted");
    expect((await readPermissionFacts(viaNotificationOnly("denied"))).notifications).toBe("denied");
    // And no Notification object at all is `unsupported`, not `denied`.
    expect((await readPermissionFacts({ navigator: {} })).notifications).toBe("unsupported");
  });

  it("a throwing Notification getter is `error`, not a guess", async () => {
    const hostile: PermissionsGlobalLike = {
      navigator: {},
      get Notification(): never {
        throw new Error("blocked by policy");
      },
    };
    expect((await readPermissionFacts(hostile)).notifications).toBe("error");
  });

  it("every permission we ask for comes back with a value — no undefined holes", async () => {
    const facts = await readPermissionFacts(throwsOnUnknownName());
    for (const name of PERMISSION_NAMES) expect(typeof facts[name]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// AC 2 — the package CANNOT prompt
// ---------------------------------------------------------------------------

describe("it asks what is switched on, never whether you would like to switch it on", () => {
  it("no prompting API appears anywhere in the source", () => {
    const banned = /requestPermission|getCurrentPosition|watchPosition|getUserMedia|\.create\s*\(/;
    const offenders: string[] = [];
    for (const f of readdirSync("src")) {
      if (!f.endsWith(".ts")) continue;
      const src = readFileSync(`src/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      if (banned.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("a navigator whose prompting methods EXPLODE survives a full read", async () => {
    const boobyTrapped = {
      ...chromium({ notifications: "granted" }),
      Notification: {
        permission: "granted",
        requestPermission: () => {
          throw new Error("a statistics package asked the user for permission");
        },
      },
    } as PermissionsGlobalLike;
    const facts = await readPermissionFacts(boobyTrapped);
    expect(facts.notifications).toBe("granted");
  });
});

// ---------------------------------------------------------------------------
// AC 4 — Face ID is a capability, not a consent
// ---------------------------------------------------------------------------

describe("Face ID is what the device HAS, not what the user allowed", () => {
  it("lives outside the permission map and cannot be spelled `granted`", async () => {
    const facts = await readPermissionFacts(chromium({}));
    expect(facts.platformAuthenticator).toBe("available");
    // @ts-expect-error — "granted" is not an AuthenticatorAvailability. If this
    // ever compiles, the field has become readable as a consent.
    const wrong: typeof facts.platformAuthenticator = "granted";
    expect(wrong).toBe("granted");
    expect(PERMISSION_NAMES).not.toContain("platformAuthenticator" as never);
  });

  it("false is `unavailable`, a missing API is `unsupported`, a throw is `error` — three answers", async () => {
    const no = await readPermissionFacts({
      ...chromium({}),
      PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => false },
    });
    const absent = await readPermissionFacts({ navigator: {} });
    const broken = await readPermissionFacts({
      ...chromium({}),
      PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => { throw new Error("x"); } },
    });
    expect([no.platformAuthenticator, absent.platformAuthenticator, broken.platformAuthenticator]).toEqual([
      "unavailable",
      "unsupported",
      "error",
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC 5 + 7 — the gate makes the read impossible, and the field is opt-in
// ---------------------------------------------------------------------------

describe("consent gates the READ, and permissions are asked for explicitly", () => {
  const withGlobals = async (fn: () => Promise<unknown>, query: () => Promise<never>) => {
    const g = globalThis as Record<string, unknown>;
    const before = g.window;
    // The collector resolves ONE environment (`getWindow()`), and the permission
    // read uses that same object — so stubbing the window is enough, and there
    // is no second source that could be read while the first was blocked.
    g.window = {
      matchMedia: () => ({ matches: false }),
      innerWidth: 390,
      screen: { width: 390 },
      devicePixelRatio: 3,
      navigator: { permissions: { query } },
      Notification: { permission: "granted" },
    };
    try {
      return await fn();
    } finally {
      g.window = before;
    }
  };

  it("WITHOUT consent the permission query is never ISSUED — not issued and discarded", async () => {
    const query = vi.fn(async () => {
      throw new Error("the gate let a read through");
    });
    const result = await withGlobals(
      () => collectDeviceDetail({ consent: { has: () => false }, permissions: true }),
      query as never,
    );
    expect(result).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("WITH consent but WITHOUT `permissions: true`, still not issued — and the field is absent", async () => {
    const query = vi.fn(async () => ({ state: "granted" }));
    const detail = (await withGlobals(
      () => collectDeviceDetail({ consent: { has: () => true } }),
      query as never,
    )) as Record<string, unknown> | null;
    expect(detail).not.toBeNull();
    expect(detail?.permissions).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("WITH both, it is issued — so the two tests above cannot pass on a collector that never works", async () => {
    const query = vi.fn(async () => ({ state: "granted" }));
    const detail = (await withGlobals(
      () => collectDeviceDetail({ consent: { has: () => true }, permissions: true }),
      query as never,
    )) as Record<string, unknown> | null;
    expect(detail?.permissions).toBeDefined();
    expect(query).toHaveBeenCalled();
  });
});
