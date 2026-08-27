/**
 * @broberg/chat/http — the framework-free HTTP half (F079.3).
 *
 * ONE implementation, driven by web-standard `Request`/`Response`, so Next's
 * App Router and Hono are thin wrappers over the SAME code rather than two
 * implementations that drift. "Fix one half of a pair" is a measured fleet
 * defect, not a hypothetical — three cases in two days, including a Turnstile
 * fix that shipped for the browser and left the server half in production.
 *
 * The adapter owns request parsing, caller resolution, SSE framing and abort.
 * It does NOT own the model: the model is still injected into `createChat()`,
 * so no subpath here takes a runtime dependency on @broberg/ai-sdk. F061.2
 * measured why that matters — @broberg/logger promised it "cannot leak a
 * secret" while shipping a secret-scan four minors stale, because a caret on
 * 0.x locks the MINOR. Every @broberg package is 0.x.
 */
import type { Chat, ChatFrame, ChatMessage } from "./index.js";

export interface ChatHandlerOptions<Ctx = unknown, Caller = unknown> {
  /** Built with `createChat()` — the model is injected there, not here. */
  chat: Chat<Ctx, Caller>;
  /**
   * REQUIRED. Resolve the caller server-side, per request, from whatever this
   * app already uses — a session cookie, a header, a re-read profile.
   *
   * There is no anonymous default, for the same reason `can` has no permissive
   * default in the core: it would look like configuration and behave like an
   * open door.
   *
   * Returning `null`/`undefined` is a 401 and the model is never touched.
   */
  getCaller: (req: Request) => Promise<Caller | null | undefined> | Caller | null | undefined;
  /**
   * Whatever the tools need — an API client, a scoped repository. It is handed
   * to `run()` untouched and never serialised onto the wire.
   */
  getCtx?: (req: Request, caller: Caller) => Promise<Ctx> | Ctx;
}

export type ChatHandler = (req: Request) => Promise<Response>;

const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  // nginx and some proxies buffer a response until it ends, which would turn a
  // streamed answer back into a 13-second blank screen.
  "x-accel-buffering": "no",
};

export function createChatHandler<Ctx = unknown, Caller = unknown>(
  opts: ChatHandlerOptions<Ctx, Caller>,
): ChatHandler {
  if (!opts || typeof opts.chat?.run !== "function") {
    throw new TypeError("createChatHandler: `chat` must be the object returned by createChat()");
  }
  if (typeof opts.getCaller !== "function") {
    throw new TypeError(
      "createChatHandler: `getCaller` is required and has no default. An anonymous caller would be " +
        "handed a chat nobody authorised — and an unauthenticated request is still an LLM bill.",
    );
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid_json" });
    }

    const messages = readMessages(body);
    if (!messages) return json(400, { error: "invalid_messages" });

    const caller = await opts.getCaller(req);
    // 401, NOT an empty tool list. A chat that answers strangers with no tools
    // still spends money on a surface where the stranger decides the volume —
    // and on an internal admin chat it is simply the wrong answer.
    if (caller === null || caller === undefined) return json(401, { error: "unauthenticated" });

    const ctx = opts.getCtx ? await opts.getCtx(req, caller) : (undefined as Ctx);

    return new Response(toSSE(opts.chat.run({ messages, caller, ctx }), req.signal), {
      status: 200,
      headers: SSE_HEADERS,
    });
  };
}

/**
 * Read the transcript, and ONLY the transcript.
 *
 * Every message is rebuilt from the three fields we know, so anything else the
 * browser attached — a role, a permission, a user id — is dropped rather than
 * carried. The caller is resolved server-side and can never arrive in the body;
 * reading it from there would be cms's filter defect moved onto the wire.
 *
 * WORTH KNOWING, and not a bug: the transcript itself is client-supplied, so a
 * caller can forge their OWN history, including a `tool` message. Anything that
 * matters must come from a tool call in THIS turn, never from history — the
 * same rule as "a tool that can act must not decide whether it may".
 */
function readMessages(body: unknown): ChatMessage[] | null {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw)) return null;
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const { role, content, toolCallId } = item as Record<string, unknown>;
    if (role !== "user" && role !== "assistant" && role !== "tool") return null;
    if (typeof content !== "string") return null;
    const msg: ChatMessage = { role, content };
    if (typeof toolCallId === "string") msg.toolCallId = toolCallId;
    out.push(msg);
  }
  return out;
}

/**
 * Frames → SSE bytes, written AS THEY ARRIVE.
 *
 * Demand-driven (`pull`), so the answer reaches the browser while the model is
 * still producing it. Batching would look identical in every other respect and
 * would put 13.1 measured seconds of blank screen back — which is why the test
 * for this asserts the FIRST event arrives before the run finishes, rather than
 * asserting that events came out at all.
 */
export function toSSE(frames: AsyncIterable<ChatFrame>, signal?: AbortSignal | null): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let iterator: AsyncIterator<ChatFrame> | undefined;

  const stop = async () => {
    try {
      await iterator?.return?.();
    } catch {
      /* a generator that refuses to close must not mask the real outcome */
    }
  };

  return new ReadableStream<Uint8Array>({
    start() {
      iterator = frames[Symbol.asyncIterator]();
    },
    async pull(controller) {
      // A closed tab stops the work. Checked before pulling, so an aborted
      // request does not pay for one more model round.
      if (signal?.aborted) {
        await stop();
        controller.close();
        return;
      }
      let next: IteratorResult<ChatFrame>;
      try {
        next = await iterator!.next();
      } catch {
        // The core turns model and tool failures into error frames itself, so
        // reaching here means the iterable is broken. Generic on purpose: a
        // thrown error's message may carry internals, and a stack must never
        // reach a browser.
        controller.enqueue(encoder.encode(sse({ type: "error", scope: "model", message: "the response stream failed" })));
        controller.close();
        return;
      }
      if (next.done || signal?.aborted) {
        await stop();
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(sse(next.value)));
    },
    async cancel() {
      await stop();
    },
  });
}

/**
 * One JSON object per event. The frame already carries its own `type`, so no
 * `event:` line is needed — and JSON escapes newlines, which is what makes a
 * multi-line answer (or one containing a blank line) survive a format whose
 * record separator IS a blank line.
 */
function sse(frame: ChatFrame): string {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
