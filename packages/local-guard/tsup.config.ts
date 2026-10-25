import { defineConfig } from "tsup";

// ONE config with two entries, not an array of configs — an array's per-config
// `clean` races and drops a sibling's .d.ts (F061).
export default defineConfig({
  entry: ["src/index.ts", "src/hono.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ["hono"],
});
