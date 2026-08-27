import { defineConfig } from "tsup";

export default defineConfig([
  {
    // All three entries in ONE config, so there is no sibling to race.
    // NOTE: no `clean` here — a per-config clean in a tsup ARRAY races its
    // siblings and can wipe freshly emitted .d.ts (F061; it shipped
    // @broberg/pwa 0.2.1 without react.d.ts and blocked a consumer's adoption).
    // dist is cleaned ONCE by the `build` script, then verify-exports.mjs
    // proves every declared export target actually exists.
    entry: { index: "src/index.ts", next: "src/next.ts", hono: "src/hono.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    // Optional peers: a consumer of the core must never be made to install
    // either, and neither may end up inside our bundle.
    external: ["next", "next/server", "hono"],
  },
]);
