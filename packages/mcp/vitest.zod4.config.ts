import { defineConfig } from "vitest/config";

/**
 * A SECOND test run in which the package's own `zod` import resolves to zod 4.
 *
 * This reproduces what a Zod 4 consumer (beacon) actually gets: pnpm resolves a
 * single `zod` for the peer dependency, so `src/tools.ts`'s `import { z } from
 * "zod"` IS the consumer's zod 4 — while `zod-to-json-schema@3` still cannot
 * read it. Without this run we could only test the zod 3 path and would be
 * guessing about the one that broke.
 *
 * The files here are named `*.zod4-test.ts` so the DEFAULT (zod 3) run does not
 * pick them up.
 */
export default defineConfig({
  resolve: {
    alias: { zod: "zod4" },
  },
  test: {
    include: ["test/**/*.zod4-test.ts"],
  },
});
