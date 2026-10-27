import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/webhook.ts", "src/verify.ts", "src/hono.ts", "src/next.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
