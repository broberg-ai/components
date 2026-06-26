import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", preact: "src/preact.tsx", sse: "src/sse.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ["preact"],
});
