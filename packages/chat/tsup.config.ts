import { defineConfig } from "tsup";

export default defineConfig([
  {
    // ALL entries in ONE config object. A per-config `clean` in a tsup ARRAY
    // races its siblings and can wipe freshly emitted .d.ts (F061) — that is
    // how @broberg/pwa 0.2.1 shipped without react.d.ts. dist is cleaned once
    // by the build script, then verify-exports.mjs proves every target exists.
    entry: {
      index: "src/index.ts",
      http: "src/http.ts",
      next: "src/next.ts",
      hono: "src/hono.ts",
      client: "src/client.ts",
      trail: "src/trail.ts",
      history: "src/history.ts",
      guard: "src/guard.ts",
      public: "src/public.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
  },
]);
