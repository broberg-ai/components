import { defineConfig } from "tsup";

export default defineConfig([
  {
    // dist is cleaned ONCE by the `build` script (F061), never per config.
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
  },
  {
    entry: { hono: "src/hono.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: ["hono"],
  },
]);
