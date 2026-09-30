import { defineConfig } from "vitest/config";

// F080.7 — this package's test files run ONE AT A TIME.
//
// Measured 30/9 on a Mac shared with other sessions (load 6–12), not guessed:
//
//   files in parallel (vitest's default)   red 4 of 4 runs — 13 two-factor tests over 5 s
//   one file at a time                     green 147/147, and in two shuffled orders
//   the two-factor file on its own          green, but each test up to 3.3 s
//
// Every two-factor test hashes a password twice at production strength (sign-up,
// then enableTwoFactor re-checks it). Raw scrypt at Better Auth's parameters took
// 1.75 s on that host. Several files doing that at once — secret-guard spawns node
// processes at the same moment — pushed the two-factor tests past 5 s. Order does
// not matter (two shuffled seeds, both green), so it is not a leaking mock; it is
// the package competing with ITSELF for CPU.
//
// Cost: 148 s vs 134 s on the same host (~10%). Not a longer timeout and not a
// retry: those would make it rarer, not gone.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
