import { defineConfig } from "tsup";

const SHARED_EXTERNAL = [
  "better-auth",
  "better-auth/*",
  "@better-auth/passkey",
  "drizzle-orm",
  "@broberg/mail",
  "hono",
  "next",
  "next/*",
];

export default defineConfig([
  {
    // NB: no per-config `clean` — with a multi-config array it races the DTS
    // emit of sibling entries and non-deterministically wipes their .d.ts
    // (dropped hono.d.ts from the 0.1.2 build). dist is cleaned ONCE up front
    // in the build script (`rm -rf dist && tsup`), and verify-exports.mjs seals it.
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: SHARED_EXTERNAL,
  },
  {
    // Stack B (Hono) mount helper — no next import.
    entry: { hono: "src/hono.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: SHARED_EXTERNAL,
  },
  {
    // Stack A (Next.js) route-handler factory — no hono import.
    entry: { next: "src/next.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: SHARED_EXTERNAL,
  },
]);
