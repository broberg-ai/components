import { defineConfig } from "tsup";

// stripe stays external — it's a peer the consumer provides (one pinned version).
const EXTERNAL = ["stripe"];

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    external: EXTERNAL,
  },
  {
    // Web-standard Request/Response route factory (named /next, but runtime-agnostic).
    entry: { next: "src/next.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: EXTERNAL,
  },
]);
