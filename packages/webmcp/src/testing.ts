// F098.6 — what a test harness (Lens, CI, a site's own tests) needs to drive a
// page's WebMCP tools the way an agent would.
//
// Two facts from Chromium, measured 12/10 2026:
//  - WebMCP is switched on with `--enable-features=WebMCP`
//    (content/child/runtime_features.cc: overriding kWebMCP controls both the
//    imperative and the declarative API). chrome://flags/#enable-webmcp-testing
//    is the UI for the same; the origin trial (Chrome 149+) needs no flag but
//    a token, which a headless test browser cannot rely on.
//  - The DevTools protocol already has a test door, domain `WebMCP`
//    (experimental): enable → toolsAdded for every registered tool;
//    invokeTool {frameId, toolName, input} → {invocationId}; the result arrives
//    later as toolResponded with the same invocationId.
// So this needs no browser dependency: it speaks CDP through any session with
// send/on — Playwright's CDPSession is one.

/** Launch args that switch WebMCP on in Chromium. Pass to chromium.launch({ args }). */
export const WEBMCP_LAUNCH_ARGS: readonly string[] = ["--enable-features=WebMCP"];

/** The part of a CDP session this needs (Playwright's CDPSession fits). */
export interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  on(event: string, handler: (params: any) => void): unknown;
  off?(event: string, handler: (params: any) => void): unknown;
}

/** Annotations as the DevTools protocol reports them (the page writes readOnlyHint etc.). */
export interface WebMCPAnnotations {
  readOnly?: boolean;
  consequential?: boolean;
  untrustedContent?: boolean;
  debugging?: boolean;
  autosubmit?: boolean;
}

export interface WebMCPTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: WebMCPAnnotations;
  frameId: string;
}

export interface WebMCPInvokeResult {
  status: "Completed" | "Canceled" | "Error";
  output?: unknown;
  errorText?: string;
}

export interface WebMCPInvokeOptions {
  /** Required to call a tool that is not annotated readOnly — the page may change state. */
  mutates?: boolean;
  /** Default 15 000 ms. On timeout the invocation is cancelled and the call throws. */
  timeoutMs?: number;
  /** Defaults to the frame the tool was registered in. */
  frameId?: string;
}

export interface WebMCPTester {
  /** Enables the domain and returns the tools the page has registered. */
  listTools(opts?: { settleMs?: number }): Promise<WebMCPTool[]>;
  /** Calls a registered tool and waits for ITS response (matched by invocationId). */
  invokeTool(name: string, input?: Record<string, unknown>, opts?: WebMCPInvokeOptions): Promise<WebMCPInvokeResult>;
  /** Disables the domain and detaches the listeners. */
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createWebMCPTester(cdp: CdpSessionLike): WebMCPTester {
  const tools = new Map<string, WebMCPTool>();
  // A response can arrive before its waiter is attached (the send promise and
  // the event are separate messages), so unclaimed responses are kept by id.
  const unclaimed = new Map<string, WebMCPInvokeResult>();
  const waiters = new Map<string, (r: WebMCPInvokeResult) => void>();
  let added: (() => void) | null = null;
  let enabled = false;

  const onAdded = (p: { tools?: WebMCPTool[] }) => {
    for (const t of p.tools ?? []) tools.set(t.name, t);
    added?.();
  };
  const onRemoved = (p: { tools?: { name: string }[] }) => {
    for (const t of p.tools ?? []) tools.delete(t.name);
  };
  const onResponded = (p: { invocationId: string; status: WebMCPInvokeResult["status"]; output?: unknown; errorText?: string }) => {
    const r: WebMCPInvokeResult = { status: p.status, output: p.output, errorText: p.errorText };
    const w = waiters.get(p.invocationId);
    if (w) {
      waiters.delete(p.invocationId);
      w(r);
    } else unclaimed.set(p.invocationId, r);
  };

  const enable = async () => {
    if (enabled) return;
    cdp.on("WebMCP.toolsAdded", onAdded);
    cdp.on("WebMCP.toolsRemoved", onRemoved);
    cdp.on("WebMCP.toolResponded", onResponded);
    await cdp.send("WebMCP.enable");
    enabled = true;
  };

  // Enabling fires toolsAdded for the tools already registered, but after the
  // enable call returns — wait for that event, or settleMs on a page with none.
  const listTools: WebMCPTester["listTools"] = async (opts = {}) => {
    const first = !enabled;
    const arrived = new Promise<void>((r) => (added = r));
    await enable();
    if (first && tools.size === 0) await Promise.race([arrived, sleep(opts.settleMs ?? 500)]);
    added = null;
    return [...tools.values()];
  };

  const invokeTool: WebMCPTester["invokeTool"] = async (name, input = {}, opts = {}) => {
    const known = await listTools();
    const tool = tools.get(name);
    if (!tool) {
      throw new Error(`WebMCP tool "${name}" is not registered on this page; registered: ${known.map((t) => t.name).join(", ") || "(none)"}`);
    }
    if (!tool.annotations?.readOnly && !opts.mutates) {
      throw new Error(`WebMCP tool "${name}" is not marked readOnly, so it may change state; pass { mutates: true } to call it`);
    }
    const { invocationId } = (await cdp.send("WebMCP.invokeTool", { frameId: opts.frameId ?? tool.frameId, toolName: name, input })) as { invocationId: string };
    const done = unclaimed.get(invocationId);
    if (done) {
      unclaimed.delete(invocationId);
      return done;
    }
    const timeoutMs = opts.timeoutMs ?? 15_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = new Promise<WebMCPInvokeResult>((r) => waiters.set(invocationId, r));
    const timedOut = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), timeoutMs)));
    const winner = await Promise.race([response, timedOut]);
    clearTimeout(timer);
    if (winner !== "timeout") return winner;
    waiters.delete(invocationId);
    let cancel = "";
    try {
      await cdp.send("WebMCP.cancelInvocation", { invocationId });
    } catch (e) {
      cancel = ` (cancelInvocation also failed: ${e instanceof Error ? e.message : String(e)})`;
    }
    throw new Error(`WebMCP tool "${name}" did not respond within ${timeoutMs} ms; the invocation was cancelled${cancel}`);
  };

  const close = async () => {
    if (!enabled) return;
    enabled = false;
    cdp.off?.("WebMCP.toolsAdded", onAdded);
    cdp.off?.("WebMCP.toolsRemoved", onRemoved);
    cdp.off?.("WebMCP.toolResponded", onResponded);
    await cdp.send("WebMCP.disable");
  };

  return { listTools, invokeTool, close };
}
