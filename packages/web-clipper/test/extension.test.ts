// @vitest-environment happy-dom
// F099.6 — the manifest factory, the content-script half and the popup half.
import { describe, expect, it } from "vitest";
import { defineClipperManifest, clipActiveTab, ClipTabError, EXTRACT_MESSAGE, PART_MESSAGE, PART_CHARS } from "../src/extension";
import { runContentScript, CONTENT_EXTRACT_MESSAGE, CONTENT_PART_MESSAGE, CONTENT_PART_CHARS } from "../src/content";
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
    delete (globalThis as { __brobergWebClipper?: unknown }).__brobergWebClipper;
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

  it("0.5.1 — a NEW injection replaces the old listener (jam 13/10: after reloading the extension, the old one kept answering)", async () => {
    delete (globalThis as { __brobergWebClipper?: unknown }).__brobergWebClipper;
    const live = new Set<(m: unknown, s: unknown, r: (x: unknown) => void) => boolean | void>();
    const rt = { onMessage: { addListener: (fn: never) => void live.add(fn), removeListener: (fn: never) => void live.delete(fn) } };
    runContentScript([], rt);
    const first = [...live][0];
    // the reloaded extension injects again, now with a chat reader
    const reader = { id: "new", matches: () => true, extract: async () => ({ url: location.href, title: "ny", units: [{ kind: "turn", role: "user", content: "fra den NYE læser", position: 0 }] }) };
    runContentScript([reader], rt);
    expect(live.size).toBe(1);
    expect(live.has(first!)).toBe(false);
    const reply = await new Promise<{ ok: boolean; clip?: { title: string } }>((resolve) => [...live][0]!({ action: CONTENT_EXTRACT_MESSAGE }, {}, resolve as never));
    expect(reply.clip?.title).toBe("ny");
    // an old context whose runtime is gone (removeListener throws) does not stop the new one
    const dead = { onMessage: { addListener: () => {}, removeListener: () => { throw new Error("Extension context invalidated."); } } };
    (globalThis as { __brobergWebClipper?: unknown }).__brobergWebClipper = { rt: dead, listener: () => {} };
    expect(() => runContentScript([reader], rt)).not.toThrow();
  });

  it("a chrome:// page is refused with a reason the popup can show", async () => {
    await expect(clipActiveTab(CONTENT_SCRIPT_PATH, { tabs: { query: async () => [{ id: 1, url: "chrome://extensions/" }], sendMessage: async () => undefined }, scripting: { executeScript: async () => {} } }))
      .rejects.toMatchObject({ name: "ClipTabError", reason: "restricted_page" });
    expect(ClipTabError).toBeTypeOf("function");
  });
});

describe("F099.13 / 0.8.3 — a file bigger than one extension message (Chrome caps at 64 MiB) travels in parts", () => {
  const bigClip = (size: number) => ({
    id: "big", matches: () => true,
    extract: async () => ({ url: location.href, title: "stor", units: [{ kind: "turn" as const, role: "assistant" as const, content: "[Fil: film.mp4]", position: 0,
      assets: [{ type: "file" as const, id: "f", name: "film.mp4", mime: "video/mp4", size, encoding: "base64" as const, content: "A".repeat(size - 1) + "Z" }, { type: "file" as const, name: "lille.md", content: "# hej" }] }] }),
  });
  const wire = (onPart?: (msg: { ref: string; start: number }) => void) => {
    let listener: ((m: unknown, s: unknown, r: (x: unknown) => void) => boolean | void) | undefined;
    delete (globalThis as { __brobergWebClipper?: unknown }).__brobergWebClipper;
    return {
      run: (reader: ReturnType<typeof bigClip>) => runContentScript([reader], { onMessage: { addListener: (fn) => { listener = fn as never; } } }),
      tabs: {
        query: async () => [{ id: 7, url: location.href }],
        sendMessage: (_id: number, msg: unknown) => new Promise((resolve) => {
          const m = msg as { action: string; ref: string; start: number };
          if (m.action === PART_MESSAGE) onPart?.(m);
          // every single message must stay under the cap
          listener!(msg, {}, (r: unknown) => { expect(JSON.stringify(r).length).toBeLessThan(PART_CHARS + 1000); resolve(r); });
        }),
      },
    };
  };

  it("the part literals are the same on both sides (they must not share a module)", () => {
    expect(CONTENT_PART_MESSAGE).toBe(PART_MESSAGE);
    expect(CONTENT_PART_CHARS).toBe(PART_CHARS);
  });

  it("a 2.5-part file arrives whole and byte-identical; a small file rides along unchanged", async () => {
    const size = Math.floor(PART_CHARS * 2.5);
    const parts: number[] = [];
    const w = wire((m) => parts.push(m.start));
    w.run(bigClip(size));
    const clip = await clipActiveTab(CONTENT_SCRIPT_PATH, { tabs: w.tabs as never, scripting: { executeScript: async () => {} } });
    const [film, small] = clip.units[0]!.assets!;
    expect(film!.content!.length).toBe(size);
    expect(film!.content!.endsWith("AZ")).toBe(true);
    expect(film).not.toHaveProperty("contentRef");
    expect(small).toStrictEqual({ type: "file", name: "lille.md", content: "# hej" });
    expect(parts).toStrictEqual([0, PART_CHARS, PART_CHARS * 2]);
    expect(clip.completeness).toBeUndefined();
  });

  it("NEGATIVE CONTROL: a part that cannot be fetched → the file is left out AND named (missing files), never a cut-off file", async () => {
    const w = wire();
    w.run(bigClip(PART_CHARS + 10));
    let first = true;
    const tabs = { ...w.tabs, sendMessage: (id: number, msg: unknown) => {
      const m = msg as { action: string };
      if (m.action === PART_MESSAGE && !first) return Promise.resolve({ ok: false, error: "gone", name: "PartGone" });
      if (m.action === PART_MESSAGE) first = false;
      return w.tabs.sendMessage(id, msg);
    } };
    const clip = await clipActiveTab(CONTENT_SCRIPT_PATH, { tabs: tabs as never, scripting: { executeScript: async () => {} } });
    expect(clip.units[0]!.assets!.map((a) => a.name)).toStrictEqual(["lille.md"]);
    expect(clip.completeness).toMatchObject({ complete: false, missing: "files", missingFiles: [{ name: "film.mp4", why: "network" }] });
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
