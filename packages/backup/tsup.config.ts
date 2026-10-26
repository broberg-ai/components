import { defineConfig } from "tsup";

// F061 — ONE config, clean once (the build script's rm -rf dist).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: false,
  sourcemap: true,
  treeshake: true,
});
