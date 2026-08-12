import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/server.ts", "src/preact.ts", "src/react.ts", "src/hono.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // Every framework is the HOST's, never bundled. react joins the list for the
  // adapter fd-sundhed asked for; without it the bundler would inline a second
  // copy of React and the hook would break in ways that look like a hooks-order
  // bug rather than a packaging one.
  external: ["hono", "preact", "preact/hooks", "react"],
});
