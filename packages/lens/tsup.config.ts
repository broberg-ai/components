import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/next.ts", "src/hono.ts", "src/next-auth.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ["hono", "next-auth", "next-auth/jwt"],
});
