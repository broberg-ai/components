import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/authorize.ts", "src/next.ts", "src/hono.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ["hono"],
});
