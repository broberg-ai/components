import { defineConfig } from "tsup";

export default defineConfig({
  entry: { core: "src/core.ts", extract: "src/extract.ts", transport: "src/transport.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  treeshake: true,
});
