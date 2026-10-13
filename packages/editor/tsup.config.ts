import { defineConfig } from "tsup";

// One config with splitting: the editor and /server share schema + markdown, and
// TipTap must be ONE copy at runtime (two copies of prosemirror break each other).
export default defineConfig({
  entry: { index: "src/index.ts", server: "src/server.ts", react: "src/react.ts", preact: "src/preact.ts" },
  format: ["esm", "cjs"],
  splitting: true,
  dts: true,
  sourcemap: true,
  treeshake: true,
  external: [/^@tiptap\//, "marked", "react", "react-dom", "preact", "preact/hooks"],
});
