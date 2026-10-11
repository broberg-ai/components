import { describe, expect, it } from "vitest";
import { createWebMCPTester, WEBMCP_LAUNCH_ARGS, type CdpSessionLike, type WebMCPTool } from "../src/testing";

// A fake CDP session shaped like the published protocol (domain WebMCP):
// enable fires toolsAdded AFTER it returns; invokeTool returns an invocationId,
// and the result comes later as toolResponded.
const LIST: WebMCPTool = { name: "list_services", description: "Lists services", inputSchema: { type: "object" }, annotations: { readOnly: true }, frameId: "F1" };
const BOOK: WebMCPTool = { name: "start_booking", description: "Opens the confirmation", annotations: { consequential: true }, frameId: "F1" };

function fakeCdp(opts: { tools?: WebMCPTool[]; respond?: "none" | "other-first" | "before-return" } = {}) {
  const handlers = new Map<string, Set<(p: any) => void>>();
  const sent: { method: string; params?: Record<string, unknown> }[] = [];
  const emit = (ev: string, p: unknown) => handlers.get(ev)?.forEach((h) => h(p));
  let n = 0;
  const cdp: CdpSessionLike = {
    on: (ev, h) => void (handlers.get(ev) ?? handlers.set(ev, new Set()).get(ev)!).add(h),
    off: (ev, h) => void handlers.get(ev)?.delete(h),
    async send(method, params) {
      sent.push({ method, params });
      if (method === "WebMCP.enable") {
        setTimeout(() => emit("WebMCP.toolsAdded", { tools: opts.tools ?? [LIST, BOOK] }), 5);
        return {};
      }
      if (method === "WebMCP.invokeTool") {
        const id = `inv-${++n}`;
        const answer = { invocationId: id, status: "Completed", output: { echo: params?.toolName, input: params?.input } };
        if (opts.respond === "before-return") emit("WebMCP.toolResponded", answer);
        else if (opts.respond !== "none") {
          setTimeout(() => {
            if (opts.respond === "other-first") emit("WebMCP.toolResponded", { invocationId: "someone-else", status: "Error", errorText: "not yours" });
            emit("WebMCP.toolResponded", answer);
          }, 5);
        }
        return { invocationId: id };
      }
      return {};
    },
  };
  return { cdp, sent, handlers };
}

describe("F098.6 — @broberg/webmcp/testing", () => {
  it("the launch flag is exactly --enable-features=WebMCP", () => {
    expect(WEBMCP_LAUNCH_ARGS).toEqual(["--enable-features=WebMCP"]);
  });

  it("listTools enables the domain and returns what toolsAdded reported", async () => {
    const { cdp, sent } = fakeCdp();
    const tools = await createWebMCPTester(cdp).listTools();
    expect(sent.map((s) => s.method)).toEqual(["WebMCP.enable"]);
    expect(tools).toEqual([LIST, BOOK]);
  });

  it("a page with no tools returns [] after the settle time instead of hanging", async () => {
    const { cdp } = fakeCdp({ tools: [] });
    expect(await createWebMCPTester(cdp).listTools({ settleMs: 30 })).toEqual([]);
  });

  it("invokeTool sends the tool's frame and input and returns ITS response", async () => {
    const { cdp, sent } = fakeCdp();
    const r = await createWebMCPTester(cdp).invokeTool("list_services", { q: 1 });
    expect(sent.find((s) => s.method === "WebMCP.invokeTool")!.params).toEqual({ frameId: "F1", toolName: "list_services", input: { q: 1 } });
    expect(r).toEqual({ status: "Completed", output: { echo: "list_services", input: { q: 1 } }, errorText: undefined });
  });

  it("a response for ANOTHER invocation is ignored", async () => {
    const { cdp } = fakeCdp({ respond: "other-first" });
    const r = await createWebMCPTester(cdp).invokeTool("list_services");
    expect(r.status).toBe("Completed");
  });

  it("a response that arrives before invokeTool returns is still matched", async () => {
    const { cdp } = fakeCdp({ respond: "before-return" });
    expect((await createWebMCPTester(cdp).invokeTool("list_services")).status).toBe("Completed");
  });

  it("a tool not marked readOnly is refused without mutates — nothing is sent", async () => {
    const { cdp, sent } = fakeCdp();
    const t = createWebMCPTester(cdp);
    await expect(t.invokeTool("start_booking", { service: "kort" })).rejects.toThrow('WebMCP tool "start_booking" is not marked readOnly, so it may change state; pass { mutates: true } to call it');
    expect(sent.some((s) => s.method === "WebMCP.invokeTool")).toBe(false);
    expect((await t.invokeTool("start_booking", { service: "kort" }, { mutates: true })).status).toBe("Completed");
  });

  it("an unknown tool is refused with the registered names", async () => {
    const { cdp } = fakeCdp();
    await expect(createWebMCPTester(cdp).invokeTool("nope")).rejects.toThrow('WebMCP tool "nope" is not registered on this page; registered: list_services, start_booking');
  });

  it("a timeout cancels the invocation and throws", async () => {
    const { cdp, sent } = fakeCdp({ respond: "none" });
    await expect(createWebMCPTester(cdp).invokeTool("list_services", {}, { timeoutMs: 30 })).rejects.toThrow('WebMCP tool "list_services" did not respond within 30 ms; the invocation was cancelled');
    expect(sent.at(-1)).toEqual({ method: "WebMCP.cancelInvocation", params: { invocationId: "inv-1" } });
  });

  it("close disables the domain and detaches every listener", async () => {
    const { cdp, sent, handlers } = fakeCdp();
    const t = createWebMCPTester(cdp);
    await t.listTools();
    await t.close();
    expect(sent.at(-1)!.method).toBe("WebMCP.disable");
    expect([...handlers.values()].every((s) => s.size === 0)).toBe(true);
  });
});
