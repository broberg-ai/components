import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts", "src/sw.ts", "src/types.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // web-push is a runtime dependency the consumer installs — never bundle it
  // (keeps it out of the browser-clean ./client + ./sw subpaths too).
  external: ["web-push"],
});
