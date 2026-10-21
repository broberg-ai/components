import { defineConfig } from "vitest/config";
// livekit-server-sdk / livekit-client take seconds to import under load (mutation
// runs, CI shards); the default 5 s timeout made the first test of a file fail
// for a reason unrelated to the mutation, which reads as a WRONG RED.
export default defineConfig({ test: { environment: "node", testTimeout: 30_000 } });
