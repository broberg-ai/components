// F074.4 AC#17 — `labels` is REQUIRED BY THE TYPE. This file is never run; it is
// compiled by `pnpm typecheck` (tsc includes test/). If `labels` ever becomes
// optional, the @ts-expect-error below becomes an UNUSED directive, which tsc
// reports as an error — so the typecheck goes red.
import { createBellShell } from "../src/shell.js";

// @ts-expect-error — a shell without labels must not compile.
export const noLabels = createBellShell({ countUnseen: async () => 0, markAllSeen: async () => [] });
