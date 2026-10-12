// @vitest-environment happy-dom
// F099.6 — the manifest factory, the content-script half and the popup half.
import { describe, expect, it } from "vitest";
import { defineClipperManifest, clipActiveTab, ClipTabError, EXTRACT_MESSAGE } from "../src/extension";
import { runContentScript, CONTENT_EXTRACT_MESSAGE } from "../src/content";
import { contentScriptStandsAlone, CONTENT_SCRIPT_PATH } from "../src/vite";

describe("F099.6 — defineClipperManifest", () => {
  it("a few lines → an MV3 manifest with the clipper's permissions and no page hosts", () => {
    expect(defineClipperManifest({ name: "Trail Web Clipper", version: "0.3.0", apiHosts: ["https://app.trailmem.com/*"], bidIssuer: "https://id.broberg.ai", geckoId: "trail-clipper@broberg.ai", key: "MIIB" })).toStrictEqual({
      manifest_version: 3,
      name: "Trail Web Clipper",
      version: "0.3.0",
      action: { default_popup: "popup.html" },
      background: { service_worker: "src/background.ts", type: "module" },
      permissions: ["activeTab", "scripting", "identity", "storage"],
      host_permissions: ["https://app.trailmem.com/*", "https://id.broberg.ai/*"],
      key: "MIIB",
      browser_specific_settings: { gecko: { id: "trail-clipper@broberg.ai" } },
    });
  });
  it("refuses a version Chrome would refuse", () => {
    expect(() => defineClipperManifest({ name: "x", version: "1.0.0-beta", bidIssuer: "https://id.broberg.ai" })).toThrow(/dot-separated integers/);
  });
  it("BrobergID's origin is always a host permission — its token endpoint sends no CORS headers (Trail 12/10: «Failed to fetch»)", () => {
    // Issuer with a trailing slash and a path still yields the bare origin; a consumer who already listed it is not duplicated.
    expect(defineClipperManifest({ name: "x", version: "1", bidIssuer: "https://id.broberg.ai/" }).host_permissions).toStrictEqual(["https://id.broberg.ai/*"]);
    expect(defineClipperManifest({ name: "x", version: "1", bidIssuer: "https://id.broberg.ai", apiHosts: ["https://id.broberg.ai/*"] }).host_permissions).toStrictEqual(["https://id.broberg.ai/*"]);
    expect(() => defineClipperManifest({ name: "x", version: "1", bidIssuer: "id.broberg.ai" })).toThrow(/bidIssuer/);
  });
});

describe("F099.6 — popup asks, content script answers", () => {
  it("the two message literals are the same (they must not share a module)", () => {
    expect(CONTENT_EXTRACT_MESSAGE).toBe(EXTRACT_MESSAGE);
  });

  it("end to end with a fake chrome: inject, ask, get the article clip of the page", async () => {
    document.title = "Fixture";
    document.body.innerHTML = "<article><h1>Fixture</h1><p>A paragraph with enough words in it to be read as the article body by Readability.</p></article>";
    let listener: ((m: unknown, s: unknown, r: (x: unknown) => void) => boolean | void) | undefined;
    (globalThis as { __brobergWebClipper?: boolean }).__brobergWebClipper = false;
    runContentScript([], { onMessage: { addListener: (fn) => { listener = fn as never; } } });
    const injected: string[] = [];
    const clip = await clipActiveTab(CONTENT_SCRIPT_PATH, {
      tabs: {
        query: async () => [{ id: 7, url: location.href }],
        sendMessage: (_id, msg) => new Promise((resolve) => listener!(msg, {}, resolve as never)),
      },
      scripting: { executeScript: async (d) => { injected.push(...d.files); } },
    });
    expect(injected).toStrictEqual([CONTENT_SCRIPT_PATH]);
    expect(clip.units).toHaveLength(1);
    expect(clip.units[0]!.content).toContain("A paragraph with enough words");
  });

  it("a chrome:// page is refused with a reason the popup can show", async () => {
    await expect(clipActiveTab(CONTENT_SCRIPT_PATH, { tabs: { query: async () => [{ id: 1, url: "chrome://extensions/" }], sendMessage: async () => undefined }, scripting: { executeScript: async () => {} } }))
      .rejects.toMatchObject({ name: "ClipTabError", reason: "restricted_page" });
    expect(ClipTabError).toBeTypeOf("function");
  });
});

describe("F099.6 — the build refuses a content script that imports", () => {
  const run = (imports: string[]) => {
    const errors: string[] = [];
    const plugin = contentScriptStandsAlone();
    (plugin.generateBundle as (this: unknown, o: unknown, b: unknown) => void).call(
      { error: (m: string) => { errors.push(m); } },
      {},
      { [CONTENT_SCRIPT_PATH]: { type: "chunk", fileName: CONTENT_SCRIPT_PATH, imports, dynamicImports: [] }, "assets/popup.js": { type: "chunk", fileName: "assets/popup.js", imports: ["assets/shared.js"], dynamicImports: [] } },
    );
    return errors;
  };
  it("standalone content script → no error (the popup may import what it likes)", () => expect(run([])).toStrictEqual([]));
  it("content script importing a shared chunk → build error naming it", () => expect(run(["assets/shared.js"])[0]).toMatch(/assets\/shared\.js.*cannot import/));
});
