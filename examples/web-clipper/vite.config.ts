// F099.6 — a whole clipper extension from the shared build: the manifest from a
// few lines, the Vite config from one call. `pnpm --filter web-clipper-example build`
// → dist/, which Chrome loads unpacked (chrome://extensions → Developer mode → Load unpacked).
import { defineConfig } from "vite";
import { defineClipperManifest } from "@broberg/web-clipper/extension";
import { clipperViteConfig } from "@broberg/web-clipper/vite";

export default defineConfig(
  clipperViteConfig({
    manifest: defineClipperManifest({ name: "Web Clipper Example", version: "0.1.0", description: "@broberg/web-clipper example — invented destination." }),
  }),
);
