import { defineConfig } from "tsup";

// ONE config with splitting (F084.155's lesson): /ui imports /transport, and two
// separate bundles would each carry their own copy of a class. Vite and the crx
// plugin are the CONSUMER's build tools — never bundled.
export default defineConfig({
  entry: {
    core: "src/core.ts",
    extract: "src/extract.ts",
    transport: "src/transport.ts",
    auth: "src/auth.ts",
    content: "src/content.ts",
    extension: "src/extension.ts",
    vite: "src/vite.ts",
    ui: "src/ui.tsx",
  },
  format: ["esm", "cjs"],
  splitting: true,
  dts: true,
  sourcemap: true,
  treeshake: true,
  external: ["preact", "preact/hooks", "preact/jsx-runtime", "vite", "@crxjs/vite-plugin", "@preact/preset-vite"],
  esbuildOptions(options) {
    options.jsx = "automatic";
    options.jsxImportSource = "preact";
  },
});
