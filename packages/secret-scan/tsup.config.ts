import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // index.js must stay ONE self-contained file: the repo pre-commit hook (and its
  // test) loads dist/index.js alone. Two entries would otherwise share a chunk.
  splitting: false,
});
