import { defineConfig } from "tsup";

// ONE config with splitting: server and client share the protocol module, and
// yjs must be a single copy at runtime (two copies break Yjs's own type checks).
export default defineConfig({
  entry: { protocol: "src/protocol.ts", server: "src/server.ts", client: "src/client.ts" },
  format: ["esm", "cjs"],
  splitting: true,
  dts: true,
  sourcemap: true,
  treeshake: true,
  external: ["yjs", "y-protocols", "lib0"],
});
