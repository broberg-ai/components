#!/usr/bin/env node
/// <reference types="node" />
// F021.9 — the `pwa-icons` entry point; the logic lives in cli.ts so tests can call it.
import { main } from "./cli.js";

main(process.argv.slice(2)).then((code) => process.exit(code));
