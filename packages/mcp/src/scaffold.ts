// scaffoldMcpJson + a starter server source. The reusable, testable core of the
// `broberg-mcp` CLI (bin/mcp.mjs is the thin fs shim over these).

export type McpTransport = "stdio" | "http" | "sse";

export interface ScaffoldOptions {
  name: string;
  transport: McpTransport;
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http / sse */
  url?: string;
  headers?: Record<string, string>;
}

/**
 * Build a `.mcp.json` fragment ({ mcpServers: { [name]: entry } }) in the fleet
 * convention: stdio = command/args/env; http & sse = type/url/headers. Merge it
 * into an existing `.mcp.json`'s `mcpServers`.
 */
export function scaffoldMcpJson(opts: ScaffoldOptions): { mcpServers: Record<string, unknown> } {
  const entry =
    opts.transport === "stdio"
      ? {
          command: opts.command ?? "node",
          args: opts.args ?? ["dist/server.js"],
          ...(opts.env ? { env: opts.env } : {}),
        }
      : {
          type: opts.transport,
          url: opts.url ?? "http://127.0.0.1:3000/mcp",
          ...(opts.headers ? { headers: opts.headers } : {}),
        };
  return { mcpServers: { [opts.name]: entry } };
}

/** A minimal, runnable starter server on @broberg/mcp for the chosen transport. */
export function starterServerSource(opts: ScaffoldOptions): string {
  const head =
    `import { defineTool } from "@broberg/mcp";\n` +
    `import { z } from "zod";\n\n` +
    `const tools = [\n` +
    `  defineTool({\n` +
    `    name: "ping",\n` +
    `    description: "Health check",\n` +
    `    inputSchema: { msg: z.string() },\n` +
    `    handler: ({ msg }) => \`pong: \${msg}\`,\n` +
    `  }),\n` +
    `];\n\n`;

  if (opts.transport === "stdio") {
    return (
      head +
      `import { createStdioMcpServer } from "@broberg/mcp";\n\n` +
      `const { start } = createStdioMcpServer({\n` +
      `  name: ${JSON.stringify(opts.name)},\n` +
      `  version: "0.1.0",\n` +
      `  tools,\n` +
      `});\n` +
      `await start();\n`
    );
  }
  if (opts.transport === "http") {
    return (
      head +
      `import { createHttpMcpHandler } from "@broberg/mcp";\n\n` +
      `// A Web (Request) => Response handler — stateless per request.\n` +
      `export const handler = createHttpMcpHandler({\n` +
      `  name: ${JSON.stringify(opts.name)},\n` +
      `  version: "0.1.0",\n` +
      `  tools,\n` +
      `});\n` +
      `// Next App Router:  export const POST = handler;\n` +
      `// Hono / Bun:       app.all("/mcp", (c) => handler(c.req.raw));\n`
    );
  }
  return (
    head +
    `import { createWebSseMcpHandler, toSseRoutes } from "@broberg/mcp";\n\n` +
    `const mcp = createWebSseMcpHandler({\n` +
    `  name: ${JSON.stringify(opts.name)},\n` +
    `  version: "0.1.0",\n` +
    `  tools,\n` +
    `});\n` +
    `// Next App Router route.ts:\n` +
    `export const { GET, POST } = toSseRoutes(mcp);\n`
  );
}
