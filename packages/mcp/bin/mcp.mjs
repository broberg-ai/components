#!/usr/bin/env node
// broberg-mcp — scaffold a .mcp.json entry + a starter server on @broberg/mcp.
// Thin fs shim over scaffoldMcpJson / starterServerSource (the tested core).
//
//   npx broberg-mcp <name> --transport stdio|http|sse [--command ...] [--url ...] [--out server.ts]

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { scaffoldMcpJson, starterServerSource } from "../dist/index.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    transport: { type: "string", default: "stdio" },
    command: { type: "string" },
    url: { type: "string" },
    out: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

const name = positionals[0];
if (values.help || !name) {
  console.log(
    "Usage: broberg-mcp <name> --transport stdio|http|sse [--command <cmd>] [--url <url>] [--out <file>]",
  );
  process.exit(name ? 0 : 1);
}

const transport = /** @type {"stdio"|"http"|"sse"} */ (values.transport);
if (!["stdio", "http", "sse"].includes(transport)) {
  console.error(`Unknown transport: ${transport} (expected stdio|http|sse)`);
  process.exit(1);
}

const opts = { name, transport, command: values.command, url: values.url };

// 1 — merge the fragment into ./.mcp.json (create if missing).
const mcpPath = resolve(process.cwd(), ".mcp.json");
let existing = { mcpServers: {} };
try {
  existing = JSON.parse(await readFile(mcpPath, "utf8"));
} catch {
  /* no .mcp.json yet — create one */
}
const fragment = scaffoldMcpJson(opts);
existing.mcpServers = { ...existing.mcpServers, ...fragment.mcpServers };
await writeFile(mcpPath, JSON.stringify(existing, null, 2) + "\n");
console.log(`✓ ${mcpPath} — added server "${name}"`);

// 2 — write the starter server source.
const outPath = resolve(process.cwd(), values.out ?? `${name}-mcp.ts`);
await writeFile(outPath, starterServerSource(opts));
console.log(`✓ ${outPath} — starter ${transport} server`);
