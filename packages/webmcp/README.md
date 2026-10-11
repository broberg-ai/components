# @broberg/webmcp

WebMCP for the fleet: letting a customer's own AI find and use a site's booking, shop or order tools. Epic F098 in broberg-ai/components.

## `@broberg/webmcp/testing` (0.1.0)

What a test harness (Lens, CI, a site's own tests) needs to drive a page's WebMCP tools the way an agent would. No browser dependency: it speaks the DevTools protocol through any session with `send`/`on`. Playwright's `CDPSession` is one.

```ts
import { WEBMCP_LAUNCH_ARGS, createWebMCPTester } from "@broberg/webmcp/testing";

const browser = await chromium.launch({ args: [...WEBMCP_LAUNCH_ARGS] });   // --enable-features=WebMCP
const page = await browser.newPage();
await page.goto("https://discovery.broberg.ai/webmcp-lab");
const mcp = createWebMCPTester(await page.context().newCDPSession(page));
const tools = await mcp.listTools();                                       // [{ name, description, inputSchema, annotations, frameId }]
const r = await mcp.invokeTool("list_services", {});                       // { status: "Completed", output }
await mcp.invokeTool("start_booking", { service: "kort", date: "2026-10-20", time: "10:00" }, { mutates: true });
await mcp.close();
```

- **Switching it on:** `--enable-features=WebMCP` (Chromium `content/child/runtime_features.cc`: kWebMCP controls both the imperative and the declarative API). Same as chrome://flags/#enable-webmcp-testing.
- **How it talks:** DevTools protocol domain `WebMCP` (experimental): `enable` → `toolsAdded`; `invokeTool` → `invocationId`; the result arrives as `toolResponded` with that id, and only that id is accepted.
- **Safety:** a tool not annotated `readOnly` (the page writes `readOnlyHint`) is refused before anything is sent unless you pass `{ mutates: true }`. An unknown name is refused with the registered names. A timeout (default 15 s) sends `cancelInvocation` and throws.
- **Lens test page:** https://discovery.broberg.ai/webmcp-lab registers `list_services` (read-only) and `start_booking` (changes state). Its server log shows each tool call.

**Not yet proven in a real browser.** The tests drive a fake session shaped exactly like the published protocol. Whether Playwright's headless shell honours `--enable-features=WebMCP` is measured when Lens wires this in (cardmem F074.109).
