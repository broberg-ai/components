import { describe, it, expect } from "vitest";
import { scaffoldMcpJson, starterServerSource } from "../src/scaffold";

describe("scaffoldMcpJson", () => {
  it("emits a stdio entry with command/args (fleet convention)", () => {
    const out = scaffoldMcpJson({ name: "my-mcp", transport: "stdio", command: "bun", args: ["server.ts"] });
    expect(out).toEqual({
      mcpServers: { "my-mcp": { command: "bun", args: ["server.ts"] } },
    });
  });

  it("emits an http entry with type/url/headers", () => {
    const out = scaffoldMcpJson({
      name: "remote",
      transport: "http",
      url: "https://x/mcp",
      headers: { Authorization: "Bearer pa_x" },
    });
    expect(out.mcpServers.remote).toEqual({
      type: "http",
      url: "https://x/mcp",
      headers: { Authorization: "Bearer pa_x" },
    });
  });

  it("defaults stdio command + http url when omitted", () => {
    expect((scaffoldMcpJson({ name: "a", transport: "stdio" }).mcpServers.a as any).command).toBe("node");
    expect((scaffoldMcpJson({ name: "b", transport: "sse" }).mcpServers.b as any).type).toBe("sse");
  });
});

describe("starterServerSource", () => {
  it("uses the right toolkit factory per transport", () => {
    expect(starterServerSource({ name: "s", transport: "stdio" })).toContain("createStdioMcpServer");
    expect(starterServerSource({ name: "s", transport: "http" })).toContain("createHttpMcpHandler");
    expect(starterServerSource({ name: "s", transport: "sse" })).toContain("toSseRoutes");
  });

  it("embeds the server name and a defineTool stub", () => {
    const src = starterServerSource({ name: "my-mcp", transport: "stdio" });
    expect(src).toContain('"my-mcp"');
    expect(src).toContain("defineTool");
  });
});
