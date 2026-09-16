import { defineConfig } from "tsup";

export default defineConfig([
  {
    // NO per-config `clean` — with several configs in this array it races the
    // sibling builds and can wipe a freshly emitted .d.ts. @broberg/pwa shipped
    // 0.2.1 without react.d.ts for exactly that reason. dist is cleaned ONCE by
    // the `build` script, and verify-exports.mjs refuses to ship an incomplete
    // one. (F061, applied from this package's first release rather than after
    // the first broken tarball.)
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
