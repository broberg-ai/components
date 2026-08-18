import { defineConfig } from "tsup";

// F061 — ONE config, clean once. A per-config `clean:true` in a tsup array
// non-deterministically wipes a sibling's .d.ts (measured on pwa 0.2.1 and auth
// 0.1.2). Add the verify-exports seal alongside any future second entry.
export default defineConfig({
  entry: ["src/index.ts", "src/types.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
