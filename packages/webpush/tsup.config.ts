import { defineConfig } from "tsup";

export default defineConfig([
  {
  entry: ["src/index.ts", "src/client.ts", "src/sw.ts", "src/types.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // web-push is a runtime dependency the consumer installs — never bundle it
  // (keeps it out of the browser-clean ./client + ./sw subpaths too).
    external: ["web-push"],
  },
  // F067 — a CLASSIC script (no import, no export) so an UNBUNDLED service
  // worker in public/ can use the shared handlers. IIFE, not esm: a static
  // sw.js registered the ordinary way cannot execute an export statement.
  {
    entry: { sw: "src/sw.global.ts" },
    format: ["iife"],
    dts: false,
    clean: false,
    sourcemap: true,
    external: ["web-push"],
  },
]);
