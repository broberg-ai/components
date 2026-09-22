// components-F086 — the two providers must answer the SAME key the same way.
//
// THE BUG THIS SEALS, measured rather than reasoned: `encodeURIComponent("..")`
// is ".." (a dot is not encoded), so percent-encoding each segment looks like
// sanitising and is not. `..` reached the URL intact and the URL parser
// collapsed it. `volume` refused the key; `r2` built the URL and fetched it.
//
// THE LOAD-BEARING ASSERTION IS NOT "r2 now refuses". It is that BOTH providers
// refuse — because the package's whole promise is that `provider` is a config
// value, and that promise is what broke, in the direction that decides security.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMedia, type R2Config, type VolumeConfig } from "../src/index";

const R2: R2Config = {
  provider: "r2",
  accountId: "acct123",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "SECRET_TEST_KEY",
  bucket: "bid-avatarer",
  keyPrefix: "tenant-a/",
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "media-safekey-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const volume = () =>
  createMedia({
    provider: "volume",
    root,
    keyPrefix: "tenant-a/",
    publicBaseUrl: "https://app.example.com/media",
  } as VolumeConfig);
const r2 = () => createMedia(R2);

/**
 * Did this key get REFUSED? Works for a sync throw and for a rejected promise
 * alike — and that distinction is not academic: the first version of this test
 * wrapped `r2().signedUrl(key)` in a plain try/catch, which cannot catch an
 * async rejection. Every r2 case read as ACCEPTED, so the test reported the bug
 * as unfixed while the fix was in place. A test that cannot see a refusal is a
 * test that will later fail to see its absence.
 */
async function refused(run: () => unknown): Promise<boolean> {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
}

/** Keys that must be refused. Each is a way out of the root or the prefix. */
const HOSTILE = [
  "../x",
  "../../x",
  "a/../../x",
  "../tenant-b/privat.jpg",
  "..",
  ".",
  "",
  "a//b",
  "a/./b",
  "nul\0byte",
  "back\\slash",
];

/** Keys that must keep working. Without these, "refuse everything" passes. */
const LEGAL = [
  "normal/avatar.png",
  "avatar.v2.png", // a dot in a FILENAME is not a traversal
  "..hidden.png", // leading dots are likewise fine
  "mappe/med mellemrum/fil.png",
  "unicode/æøå-ñ-日本.png",
  "a/b/c/d/e.png",
];

describe("F086 — one key guard, both providers", () => {
  it("BOTH providers refuse every hostile key — the disagreement is the bug", async () => {
    const disagreements: string[] = [];
    for (const key of HOSTILE) {
      const vol = await refused(() => volume().publicUrl(key));
      const r = await refused(() => r2().signedUrl(key));
      if (!vol || !r) {
        disagreements.push(
          `${JSON.stringify(key)}: volume=${vol ? "refused" : "ACCEPTED"} r2=${r ? "refused" : "ACCEPTED"}`,
        );
      }
    }
    // Printed in full on failure: "one of them accepted it" is the finding, and
    // which one it was is the whole diagnosis.
    expect(disagreements).toEqual([]);
  });

  it("the URL PROPERTY holds, not merely that something threw", async () => {
    // A throw is the mechanism; this is the goal. For every hostile key there
    // must be no buildable URL whose normalised form has lost the bucket or the
    // prefix. Asserting on the throw alone would stay green if a future change
    // threw for one reason and built a bad URL for another.
    for (const key of HOSTILE) {
      let url: string | null = null;
      try {
        url = await r2().signedUrl(key);
      } catch {
        continue; // refused — nothing was built, which is the point
      }
      const href = new URL(url).href;
      expect(href, `key ${JSON.stringify(key)} built a URL that escaped`).toContain("/bid-avatarer/");
      expect(href, `key ${JSON.stringify(key)} escaped its tenant prefix`).toContain("/tenant-a/");
    }
  });

  it("the TENANT escape has its own case — no token scoping stops it", async () => {
    // Escaping the BUCKET can still be refused by a bucket-scoped credential:
    // there is a layer below us that may say no. Escaping only the keyPrefix
    // stays inside the bucket the token is allowed to touch, so NOTHING refuses
    // it. A suite that only covered the bucket case would be green on exactly
    // the multi-tenant leak the prefix exists to prevent.
    await expect(r2().signedUrl("../tenant-b/privat.jpg")).rejects.toThrow(/escapes the root/);

    // And the property, stated directly against the collapse that caused it:
    const collapsed = new URL(
      "https://acct123.r2.cloudflarestorage.com/bid-avatarer/tenant-a/../tenant-b/privat.jpg",
    ).href;
    expect(collapsed).toContain("/bid-avatarer/"); // still in the bucket…
    expect(collapsed).not.toContain("/tenant-a/"); // …but out of the tenant
  });

  it("NEGATIVE CONTROL — legal keys still work on both providers", async () => {
    for (const key of LEGAL) {
      const vol = volume().publicUrl(key);
      expect(vol, `volume rejected a legal key: ${key}`).toBeTruthy();

      const signed = await r2().signedUrl(key);
      const href = new URL(signed).href;
      expect(href, `r2 lost the bucket on a legal key: ${key}`).toContain("/bid-avatarer/");
      expect(href, `r2 lost the prefix on a legal key: ${key}`).toContain("/tenant-a/");
    }
  });

  it("publicUrl is guarded too — measured, not assumed", () => {
    // It builds its path with the same encodeKey(fullKey(...)), so it was
    // presumed affected. Presumed is not measured; this is the measurement.
    const m = createMedia({ ...R2, publicBaseUrl: "https://cdn.example.com" });
    expect(() => m.publicUrl("../tenant-b/x.png")).toThrow(/escapes the root/);
    expect(m.publicUrl("ok/x.png")).toBe("https://cdn.example.com/tenant-a/ok/x.png");
  });

  it("the error names the provider, so a log still says where it happened", () => {
    expect(() => volume().publicUrl("../x")).toThrow(/media\(volume\)/);
    expect(() => createMedia({ ...R2, publicBaseUrl: "https://c.example" }).publicUrl("../x")).toThrow(
      /media\(r2\)/,
    );
  });
});
