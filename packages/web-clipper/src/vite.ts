// @broberg/web-clipper/vite — F099.6. The shared build: one function turns a
// manifest + two entries into the Vite config every clipper uses.
//
// Lifted from Trail's apps/web-clipper/vite.config.ts (F208): the content
// script is NOT declared in the manifest (that would run it on every page);
// it is built as its own entry at a FIXED path and injected on click. No
// content hashes — an extension is loaded from disk, so a hash buys nothing
// and costs stable paths.
import type { Plugin, UserConfig } from "vite";

import { CONTENT_SCRIPT_PATH } from "./extension";

// Re-exported for build scripts; the popup imports it from ./extension, never
// from here (this module pulls in the build tools).
export { CONTENT_SCRIPT_PATH };

export interface ClipperViteOptions {
  /** From defineClipperManifest(). */
  manifest: Record<string, unknown>;
  /** The content-script entry that calls runContentScript(). Default "src/content.ts". */
  contentScript?: string;
  /** The popup HTML. Default "popup.html". */
  popup?: string;
  outDir?: string;
  /** Extra Vite plugins (e.g. Tailwind). The crx and Preact plugins are added for you. */
  plugins?: Plugin[];
}

export async function clipperViteConfig(o: ClipperViteOptions): Promise<UserConfig> {
  // Imported here, not at the top: they are the CONSUMER's build tools (peer
  // dependencies), and nothing else in this package may require them.
  const [{ crx }, { default: preact }] = await Promise.all([import("@crxjs/vite-plugin"), import("@preact/preset-vite")]);
  const content = o.contentScript ?? "src/content.ts";
  return {
    plugins: [preact(), crx({ manifest: o.manifest as never }), contentScriptStandsAlone(), ...(o.plugins ?? [])],
    build: {
      outDir: o.outDir ?? "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: { popup: o.popup ?? "popup.html", "web-clipper-content": content },
        output: {
          entryFileNames: (chunk: { name: string }) => (chunk.name === "web-clipper-content" ? CONTENT_SCRIPT_PATH : "assets/[name].js"),
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
  };
}

/**
 * Fails the build when the content script imports another chunk. A file
 * injected with chrome.scripting.executeScript runs as a classic script: an
 * `import` there is a syntax error in the user's tab, discovered only when they
 * click. That happens when the content script and the popup share a module and
 * the bundler splits it out — so it is caught here, at build time, instead.
 */
export function contentScriptStandsAlone(): Plugin {
  return {
    name: "broberg-web-clipper:content-script-stands-alone",
    generateBundle(_opts, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || chunk.fileName !== CONTENT_SCRIPT_PATH) continue;
        const shared = [...chunk.imports, ...chunk.dynamicImports];
        if (shared.length) {
          this.error(
            `${CONTENT_SCRIPT_PATH} imports ${shared.join(", ")} — an injected content script cannot import. ` +
              "Something the popup imports is also imported by the content script; import only @broberg/web-clipper/content (and your extractors) there.",
          );
        }
      }
    },
  };
}
