import { defineConfig } from "tsup";

export default defineConfig({
  // ONE config with both entries and code splitting (F084.155). Two separate
  // configs each inlined src/client.ts, so the SsoReauthError that getAccessToken
  // (from /hono) throws was a different class from the one an app imports from
  // the root, and `e instanceof SsoReauthError` was false (appkit #2498, measured
  // on 0.14.1). Splitting puts the shared code in one chunk both entries import.
  // `splitting` is on for cjs too (tsup's experimental cjs splitting) — without
  // it the cjs builds keep their duplicate classes. test/dist-identity.test.ts
  // holds this against the built dist.
  //
  // NO `clean` here — dist is cleaned ONCE by the `build` script, and
  // verify-exports.mjs refuses to ship an incomplete one (F061).
  entry: { index: "src/index.ts", hono: "src/hono.ts" },
  format: ["esm", "cjs"],
  splitting: true,
  dts: true,
  sourcemap: true,
  treeshake: true,
  external: ["hono"],
});
