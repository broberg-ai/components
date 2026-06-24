import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/oauth.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ["@modelcontextprotocol/sdk", "zod", "zod-to-json-schema", "express", "jose"],
});
