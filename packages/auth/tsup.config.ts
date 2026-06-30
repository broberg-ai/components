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
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
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
