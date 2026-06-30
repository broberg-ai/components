import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    external: ["better-auth", "better-auth/*", "@better-auth/passkey", "drizzle-orm", "@broberg/mail"],
  },
]);
