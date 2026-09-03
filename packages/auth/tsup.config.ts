import { defineConfig } from "tsup";

const SHARED_EXTERNAL = [
  "better-auth",
  "better-auth/*",
  "@better-auth/passkey",
  "uqr",
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
    // F008.10 — two-factor lives behind its own subpath for the same reason as
    // passkey: `uqr` (the QR encoder) must not be in the core import graph. A
    // consumer without 2FA never installs it.
    entry: { "two-factor": "src/two-factor.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: SHARED_EXTERNAL,
  },
  {
    // F008.9 — passkey lives behind its own subpath so @better-auth/passkey is
    // NOT in the core import graph. A consumer without passkeys never needs it.
    entry: { passkey: "src/passkey.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: SHARED_EXTERNAL,
  },
  {
    // F008.9 — same reason: the Drizzle adapter pulls drizzle-orm, and a
    // consumer on bun:sqlite must not be forced to install it.
    entry: { drizzle: "src/drizzle.ts" },
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
