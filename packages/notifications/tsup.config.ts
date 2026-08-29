import { defineConfig } from "tsup";

// F061 — ONE config, clean once. A per-config `clean:true` in a tsup array
// non-deterministically wipes a sibling's .d.ts (measured on pwa 0.2.1 and auth
// 0.1.2). The verify-exports seal is wired into `pnpm build` (F061.1).
export default defineConfig({
  entry: ["src/index.ts", "src/types.ts", "src/shell.ts"],
  format: ["esm", "cjs"],
  dts: true,
  // clean is done ONCE by the build script (rm -rf dist), not per-config.
  clean: false,
  sourcemap: true,
  treeshake: true,
});
