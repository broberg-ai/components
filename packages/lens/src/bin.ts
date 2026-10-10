#!/usr/bin/env node
// F036.7 — the `testid-gaps` bin. Logic lives in cli.ts so tests import it without running it.
import { runTestidGaps } from "./cli.js";

process.exitCode = runTestidGaps(process.argv.slice(2));
