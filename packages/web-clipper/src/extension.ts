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
import type { Clip } from "./extract";

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
  return {
    manifest_version: 3,
    name: o.name,
    version: o.version,
    ...(o.description ? { description: o.description } : {}),
    ...(o.icons ? { icons: o.icons } : {}),
    action: { default_popup: o.popup ?? "popup.html", ...(o.icons ? { default_icon: o.icons } : {}) },
    background: { service_worker: o.background ?? "src/background.ts", type: "module" },
    permissions,
    ...(o.apiHosts?.length ? { host_permissions: o.apiHosts } : {}),
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
type Reply = { ok: true; clip: Clip } | { ok: false; error: string; name: string };

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
  if (reply.ok) return reply.clip;
  throw new ClipTabError(reply.name === "NothingToClipError" ? "nothing_to_clip" : "extract_failed", reply.error);
}

function chromeApi(): Record<string, unknown> {
  const g = globalThis as { chrome?: Record<string, unknown>; browser?: Record<string, unknown> };
  const api = g.browser?.runtime ? g.browser : g.chrome;
  if (!api) throw new Error("web-clipper/extension: not running inside an extension (no chrome.* API)");
  return api;
}
