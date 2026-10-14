// @broberg/web-clipper/extension — F099.6. The extension skeleton: an MV3
// manifest from a few lines, and the popup half that asks the active tab for a
// clip. The content-script half is @broberg/web-clipper/content.
//
//  - No broad host permission: the page is reached through activeTab +
//    scripting, injected on demand when the user clicks — the same shape
//    Trail's clipper already ships with.
//  - Chrome first (Edge, Brave, Arc for free); `geckoId` adds Firefox.
//  - `key` pins the extension id, which pins the redirect URI BID matches
//    character for character (https://<id>.chromiumapp.org/).
import type { Asset, Clip } from "./extract";

export interface ClipperManifestOptions {
  name: string;
  version: string;
  description?: string;
  /** The popup HTML, relative to the extension root. Default "popup.html". */
  popup?: string;
  /** The background service worker. Default "src/background.ts". */
  background?: string;
  icons?: Record<string, string>;
  /** The public key that fixes the extension id (and with it BID's redirect URI). */
  key?: string;
  /** Firefox: browser_specific_settings.gecko.id, e.g. "trail-clipper@broberg.ai". */
  geckoId?: string;
  /** Hosts the BACKGROUND may call (your destination's API), e.g. ["https://app.trailmem.com/*"]. Never page hosts. */
  apiHosts?: string[];
  /**
   * BrobergID's issuer — the same value you give createBidAuth, e.g. "https://id.broberg.ai".
   * Its origin is added to host_permissions: BID's token endpoint sends no CORS
   * headers, so without it the browser blocks the login's code and ticket
   * exchange («BID did not answer: Failed to fetch», measured in Trail 12/10).
   */
  bidIssuer: string;
  /** Extra permissions on top of the base set. */
  permissions?: string[];
}

/** Where the content script lands in the built extension — what clipActiveTab() injects (clipperViteConfig builds it there). */
export const CONTENT_SCRIPT_PATH = "content/clipper.js";

/** The permissions every clipper needs: the active tab on click, injection, login, its own storage. */
export const BASE_PERMISSIONS = ["activeTab", "scripting", "identity", "storage"] as const;

export function defineClipperManifest(o: ClipperManifestOptions): Record<string, unknown> {
  if (!/^\d+(\.\d+){0,3}$/.test(o.version)) throw new Error(`web-clipper: manifest version "${o.version}" is not 1–4 dot-separated integers`);
  const permissions = [...new Set([...BASE_PERMISSIONS, ...(o.permissions ?? [])])];
  let bidOrigin: string;
  try {
    bidOrigin = new URL(o.bidIssuer).origin;
  } catch {
    throw new Error(`web-clipper: bidIssuer "${o.bidIssuer}" is not a URL — pass BID's issuer, the same as createBidAuth's`);
  }
  const hosts = [...new Set([...(o.apiHosts ?? []), `${bidOrigin}/*`])];
  return {
    manifest_version: 3,
    name: o.name,
    version: o.version,
    ...(o.description ? { description: o.description } : {}),
    ...(o.icons ? { icons: o.icons } : {}),
    action: { default_popup: o.popup ?? "popup.html", ...(o.icons ? { default_icon: o.icons } : {}) },
    background: { service_worker: o.background ?? "src/background.ts", type: "module" },
    permissions,
    host_permissions: hosts,
    ...(o.key ? { key: o.key } : {}),
    ...(o.geckoId ? { browser_specific_settings: { gecko: { id: o.geckoId } } } : {}),
  };
}

// The message the popup sends and the content script answers. The SAME literal
// lives in ./content.ts — deliberately not shared through an import, because a
// shared module would make the bundler split it into a chunk, and a content
// script injected with executeScript cannot import anything. A test holds the
// two literals equal.
export const EXTRACT_MESSAGE = "broberg-web-clipper:extract";
/** Must equal CONTENT_STREAM_MESSAGE in ./content.ts (held by a test). F099.20. */
export const STREAM_MESSAGE = "broberg-web-clipper:stream";
/** Must equal CONTENT_PART_MESSAGE / CONTENT_PART_CHARS in ./content.ts (held by a test). */
export const PART_MESSAGE = "broberg-web-clipper:part";
export const PART_CHARS = 8 * 1024 * 1024;
type Reply = { ok: true; clip: Clip } | { ok: false; error: string; name: string };
type PartReply = { ok: true; data: string } | { ok: false; error: string; name: string };

interface TabsLike { query(q: { active: true; currentWindow: true }): Promise<Array<{ id?: number; url?: string }>>; sendMessage(tabId: number, msg: unknown): Promise<Reply | undefined> }
interface ScriptingLike { executeScript(d: { target: { tabId: number }; files: string[] }): Promise<unknown> }

/** The page could not be clipped. `reason` tells the popup what to say. */
export class ClipTabError extends Error {
  constructor(readonly reason: "no_tab" | "restricted_page" | "nothing_to_clip" | "extract_failed", message: string) {
    super(message);
    this.name = "ClipTabError";
  }
}

/**
 * The popup half: inject the content script into the active tab and ask it
 * for a clip. `contentScript` is the BUILT path of your content-script entry
 * (clipperViteConfig builds it at CONTENT_SCRIPT_PATH).
 */
export async function clipActiveTab(contentScript: string, api: { tabs: TabsLike; scripting: ScriptingLike } = chromeApi() as never): Promise<Clip> {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new ClipTabError("no_tab", "no active tab");
  if (tab.url && !/^https?:/.test(tab.url)) throw new ClipTabError("restricted_page", `the browser does not let extensions read ${new URL(tab.url).protocol} pages`);
  try {
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: [contentScript] });
  } catch (e) {
    throw new ClipTabError("restricted_page", `could not read this page: ${e instanceof Error ? e.message : String(e)}`);
  }
  const reply = await api.tabs.sendMessage(tab.id, { action: EXTRACT_MESSAGE });
  if (!reply) throw new ClipTabError("extract_failed", "the page did not answer");
  if (reply.ok) return assembleParts(reply.clip, (ref, start) => api.tabs.sendMessage(tab.id!, { action: PART_MESSAGE, ref, start }) as Promise<PartReply | undefined>);
  throw new ClipTabError(reply.name === "NothingToClipError" ? "nothing_to_clip" : "extract_failed", reply.error);
}

/**
 * 0.8.3 — put back together every file that travelled in parts (Chrome caps one message at 64 MiB).
 * A file whose parts cannot be fetched is left out and NAMED in completeness, never silently dropped.
 */
async function assembleParts(clip: Clip, ask: (ref: string, start: number) => Promise<PartReply | undefined>): Promise<Clip> {
  if (!clip.units.some((u) => u.assets?.some((a) => a.contentRef))) return clip;
  const lost: string[] = [];
  const units = [];
  for (const u of clip.units) {
    if (!u.assets?.some((a) => a.contentRef)) {
      units.push(u);
      continue;
    }
    const assets = [];
    for (const a of u.assets) {
      if (!a.contentRef) {
        assets.push(a);
        continue;
      }
      const { contentRef, contentLength = 0, ...rest } = a;
      const parts: string[] = [];
      let got = 0;
      let failed = false;
      while (got < contentLength) {
        const r = await ask(contentRef, got);
        if (!r || !r.ok || !("data" in r) || !r.data) {
          failed = true;
          break;
        }
        parts.push(r.data);
        got += r.data.length;
      }
      if (failed || got !== contentLength) lost.push(rest.name ?? contentRef);
      else assets.push({ ...rest, content: parts.join("") });
    }
    if (assets.length) units.push({ ...u, assets });
    else {
      const { assets: _gone, ...bare } = u;
      units.push(bare);
    }
  }
  if (!lost.length) return { ...clip, units };
  const problems = lost.map((n) => `«${n}» kunne ikke overføres fra siden til udvidelsen`);
  const c = clip.completeness;
  return {
    ...clip,
    units,
    completeness: {
      complete: false,
      source: c?.source ?? "data",
      missing: c?.missing === "turns" ? "turns" : "files",
      problems: [...(c?.problems ?? []), ...problems],
      missingFiles: [...(c?.missingFiles ?? []), ...lost.map((name) => ({ name, why: "network" as const }))],
      reason: [c?.reason, ...problems].filter(Boolean).join("; "),
    },
  };
}

/** How many part addresses a streamed file needs at `partSize` bytes per part. */
export const partsNeeded = (size: number, partSize: number) => Math.max(1, Math.ceil(size / partSize));

/**
 * F099.20 — stream a `transfer: "stream"` asset from the page straight to YOUR storage. Get
 * `partsNeeded(asset.size, partSize)` presigned part addresses from your server first (e.g.
 * @broberg/media's `multipart.presignPart`); this returns each part's ETag in order for your server's
 * `complete`. On a thrown error, ABORT the upload on your server. Every part but the last must be at
 * least 5 MiB (S3 rule). The bytes never pass through the extension or sit in memory beyond one part.
 */
export async function streamAsset(
  asset: Pick<Asset, "streamRef" | "name">,
  upload: { partUrls: string[]; partSize: number },
  api: { tabs: Pick<TabsLike, "query"> & { sendMessage(tabId: number, msg: unknown): Promise<unknown> } } = chromeApi() as never,
): Promise<{ etags: string[]; size: number }> {
  if (!asset.streamRef) throw new Error(`«${asset.name ?? "fil"}» is not a streamed file`);
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new ClipTabError("no_tab", "no active tab");
  const r = (await api.tabs.sendMessage(tab.id, { action: STREAM_MESSAGE, ref: asset.streamRef, partUrls: upload.partUrls, partSize: upload.partSize })) as
    | { ok: true; etags: string[]; size: number }
    | { ok: false; error: string }
    | undefined;
  if (!r) throw new Error("the page did not answer");
  if (!r.ok) throw new Error(r.error);
  return { etags: r.etags, size: r.size };
}

function chromeApi(): Record<string, unknown> {
  const g = globalThis as { chrome?: Record<string, unknown>; browser?: Record<string, unknown> };
  const api = g.browser?.runtime ? g.browser : g.chrome;
  if (!api) throw new Error("web-clipper/extension: not running inside an extension (no chrome.* API)");
  return api;
}
