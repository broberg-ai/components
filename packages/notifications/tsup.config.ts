import { defineConfig } from "tsup";

// F061 — clean is done ONCE by the build script (rm -rf dist), never per-config:
// a per-config `clean:true` in a tsup array non-deterministically wipes a
// sibling's .d.ts (measured on pwa 0.2.1 and auth 0.1.2). verify-exports seals it.
const base = { format: ["esm", "cjs"] as const, dts: true, clean: false, sourcemap: true, treeshake: true };

export default defineConfig([
  // The CORE builds against tsconfig.json — no DOM lib, on purpose (moovyy runs
  // it headlessly). Only the wrappers get DOM + JSX.
  { ...base, entry: ["src/index.ts", "src/types.ts", "src/shell.ts"] },
  {
    ...base,
    entry: ["src/react.tsx"],
    tsconfig: "tsconfig.react.json",
    external: ["react", "react-dom", "@broberg/ui-controls-core"],
  },
  {
    // F074.4 — the same wrapper, re-pointed at Preact. tsup externalises every
    // peerDependency BEFORE esbuild's alias or a resolve plugin can act (both
    // measured: `from 'react'` survived), so the specifiers are rewritten after
    // the build by preact-rewrite.mjs, which also REFUSES if any react import
    // survives. One implementation, not two.
    ...base,
    entry: ["src/preact.tsx"],
    tsconfig: "tsconfig.react.json",
    external: ["preact", "preact/compat", "preact/hooks", "preact/jsx-runtime", "@broberg/ui-controls-core"],
  },
]);
