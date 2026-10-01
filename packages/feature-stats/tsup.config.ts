import { defineConfig } from "tsup";

export default defineConfig([
  {
    // All entries in ONE config — a per-config clean in a tsup array races its
    // siblings (F061). dist is cleaned once by `build`, then verify-exports.mjs
    // proves every declared export target exists.
    entry: { index: "src/index.ts", hono: "src/hono.ts", next: "src/next.ts", client: "src/client.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: ["hono"],
  },
]);
