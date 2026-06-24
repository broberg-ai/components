import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // sharp + heic-convert are native/heavy server deps — keep them external,
  // never bundle them into dist (they resolve from the consumer's node_modules).
  external: ["sharp", "heic-convert"],
});
