/**
 * @broberg/chat — the fleet's AI-chat core (F079.1).
 *
 * A conversation loop with a tool registry, streaming typed frames. Framework-
 * free, storage-free, and with the MODEL INJECTED rather than imported.
 *
 * THE LINE THIS PACKAGE EXISTS TO MAKE UNWRITABLE, measured by the cms session
 * in their own 64-tool chat, 2026-08-27:
 *
 *     tools.filter(t => !t.permission || hasPermission(user, t.permission))
 *
 * `!t.permission ||` — a tool that declared no permission PASSED. 60 of their 64
 * declared none, so a read-only user was handed 61 tools, 30 of them mutating.
 * It reads exactly like a permission check. It IS one, for the four tools that
 * declared something. For the rest the default pointed the wrong way.
 *
 * So `permission` is required, enforced twice: the type rejects a literal
 * without it, and `defineTool()` throws — because a registry built at runtime
 * has no compiler.
 */

/** The bot's name, in ONE place. Override per site with CHAT_BOT_NAME. */
export const DEFAULT_BOT_NAME = "Aidan";

/**
 * The name this assistant answers to.
 *
 * One value, one place, trickling down — a site that wants something else sets
 * a single environment variable rather than editing a prompt in five repos.
 */
export function botName(env?: Record<string, string | undefined>): string {
  const source = env ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const name = source?.CHAT_BOT_NAME?.trim();
  return name ? name : DEFAULT_BOT_NAME;
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

/** What the model is shown about a tool. Never includes `run` or `permission`. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. Passed through to the model verbatim. */
  parameters: Record<string, unknown>;
}

export interface ChatTool<Ctx = unknown> extends ToolSpec {
  /**
   * REQUIRED. The permission a caller must hold. There is no default and no
   * fallback: a tool that does not declare one cannot be registered.
   */
  permission: string;
  /**
   * Does this tool CHANGE anything? Declared so a consumer can assert that a
   * read-only caller was offered nothing mutating — fd-sundhed's roles make
   * that a real test rather than a label.
   */
  mutates?: boolean;
  /**
   * Do the work.
   *
   * `ctx` is whatever the CONSUMER passed to `run()` and nothing else. The core
   * never hands a tool a database, an engine or a client — so the consumer's
   * own routes stay the authorization boundary.
   *
   * sanne's rule, and the reason acting is safe at all: A TOOL THAT CAN ACT
   * MUST NOT DECIDE WHETHER IT MAY. Their `book_appointment` calls an endpoint
   * that answers `consent_required`. cms's defect was the mirror image — their
   * tools called the engine directly and skipped every HTTP permission gate.
   */
  run(args: Record<string, unknown>, ctx: Ctx): Promise<unknown> | unknown;
}

/**
 * Register a tool. Throws unless it declares a permission.
 *
 * The type already forbids omitting it; this covers the paths a compiler cannot
 * — a JS consumer, a registry built from config, a tool assembled at runtime.
 * That is exactly where cms's 60 permission-less tools came from.
 */
export function defineTool<Ctx = unknown>(tool: ChatTool<Ctx>): ChatTool<Ctx> {
  if (!tool || typeof tool !== "object") throw new TypeError("defineTool: expected a tool object");
  const { name, permission, run } = tool;
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("defineTool: `name` is required");
  }
  if (typeof permission !== "string" || permission.trim() === "") {
    throw new TypeError(
      `defineTool: tool "${name}" declares no \`permission\`. This is required and has no default — ` +
        "a tool without one is DENIED, never allowed. (A filter written as " +
        "`!t.permission || hasPermission(...)` handed a read-only user 30 mutating tools.)",
    );
  }
  if (typeof run !== "function") throw new TypeError(`defineTool: tool "${name}" has no \`run\` function`);
  return tool;
}

/**
 * Does this caller hold this permission?
 *
 * Async because a real answer is a lookup, not a list. fd-sundhed measured why
 * that matters: their role is not the gate on its own — `access_revoked_at`
 * sits beside it, and an admin whose access had been revoked got in until a
 * guard checked BOTH. So the core asks the consumer rather than matching roles.
 */
export type Can<Caller = unknown> = (permission: string, caller: Caller) => boolean | Promise<boolean>;

// ---------------------------------------------------------------------------
// the model, injected
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Present on `tool` messages — which call this answers. */
  toolCallId?: string;
}

export interface ModelRequest {
  system: string;
  messages: ChatMessage[];
  /** Only the tools this caller may actually use. A denied tool is never here. */
  tools: ToolSpec[];
}

export type ModelEvent =
  | { type: "text"; text: string }
  | { type: "tool-call"; id: string; name: string; args: Record<string, unknown> }
  /**
   * What this round cost. ADDITIVE (F079.5): a `ModelFn` that never yields it
   * keeps working exactly as before — but a chat configured with a spend cap
   * REFUSES rather than allowing when nothing arrives, because a ceiling that
   * treats silence as "within budget" can never be reached and never says why.
   *
   * Deliberately NOT forwarded to the browser as a frame. What a stranger's
   * question cost us is our number, not theirs; the consumer wrote this
   * `ModelFn` and already holds it.
   */
  | ({ type: "usage" } & UsageReport);

/**
 * The one thing the core needs from an LLM.
 *
 * Structural on purpose. Consumers call `@broberg/ai-sdk` (the fleet chokepoint
 * for cost-tracking and provider policy) and hand the result in. Two reasons,
 * and the second was bought the day this was written: the core is testable
 * against a fake model with no key and no network, AND it carries no version
 * pin. F061.2 found `@broberg/logger` promising it "cannot leak a secret" while
 * pinned to a `secret-scan` four minors stale, because a caret on 0.x locks the
 * minor. A core with zero dependencies cannot rot that way.
 */
export type ModelFn = (req: ModelRequest) => AsyncIterable<ModelEvent>;

// ---------------------------------------------------------------------------
// frames
// ---------------------------------------------------------------------------

import { assertHistoryConfig, prepareHistory, type HistoryConfig } from "./history.js";
import {
  assertSpendCapConfig,
  createSpendTracker,
  type SpendCapConfig,
  type SpendRefusalReason,
  type UsageReport,
} from "./guard.js";

export type ChatFrame =
  | { type: "text"; text: string }
  | { type: "tool-call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool-result"; id: string; name: string; result: unknown }
  | { type: "error"; scope: "tool" | "model"; name?: string; message: string }
  /**
   * What history management did before this round. Never silent: a user must
   * not be quietly answered from half a conversation.
   *
   * `warned` arrives while there is still room to act — cms's route passes the
   * provider's raw 400 to the user today, which is the behaviour this replaces.
   */
  | { type: "history"; action: "warned" | "reduced" | "failed"; note: string; dropped?: number }
  /**
   * The guard stopped the conversation. Reaching a ceiling is an ANSWER — the
   * visitor is told plainly, never with a provider error and never by the
   * stream simply ending.
   *
   * Its own frame, distinct from `error`, because "we are out of budget", "the
   * model failed" and "I could not look that up" are three different things and
   * merging them is what this epic's rule 6 forbids.
   */
  | { type: "limit"; reason: SpendRefusalReason; note: string }
  | { type: "done"; reason: "complete" | "max-rounds" | "too-large" | "limited" };

// ---------------------------------------------------------------------------
// the prompt fragment the core owns
// ---------------------------------------------------------------------------

/**
 * What the core contributes to the system prompt. The consumer owns everything
 * else — Eir's 391 lines are 100% Sanne and must never live in a package.
 *
 * The middle rule is the one bought with an incident. Christian asked Eir
 * whether Sanne sells anything and Eir said NO — confidently — because the shop
 * tool was missing. The model was not confused; it was blind and sounded
 * certain, and a missing capability became a false statement about a business.
 */
export function corePrompt(name = botName()): string {
  return [
    `You are ${name}.`,
    "",
    "You have a limited set of tools. If no tool can answer a question, say plainly that you cannot look it up — DO NOT answer from assumption, and never turn a missing tool into a negative fact. \"I can't look that up\" and \"no\" are different answers, and only one of them is honest when you have no way to check.",
    "",
    "Never claim an action succeeded unless a tool result says so.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// the loop
// ---------------------------------------------------------------------------

export interface CreateChatOptions<Ctx = unknown, Caller = unknown> {
  model: ModelFn;
  tools?: ChatTool<Ctx>[];
  /** Required whenever there are tools: the core will not guess a permission. */
  can?: Can<Caller>;
  /** The consumer's own prompt. `corePrompt()` is prepended. */
  systemPrompt?: string;
  /** Bot name override; defaults to CHAT_BOT_NAME or "Aidan". */
  name?: string;
  /** Safety stop on tool→model→tool cycles. Default 6. */
  maxRounds?: number;
  /**
   * Keep the conversation under the model's input limit. Optional, but if you
   * pass it you must choose a strategy — there is no "none".
   *
   * WITHOUT IT this loop sends whatever it is given, which is what every chat
   * in the fleet does today and why an overflowing conversation dies rather
   * than degrades.
   */
  history?: HistoryConfig;
  /**
   * A ceiling on ONE conversation, in USD. Optional; if you pass it, it must be
   * a real number (there is no "off" that looks like a setting).
   *
   * It bounds a runaway tool->model->tool loop, which is the actual threat. It
   * never stops the FIRST answer — you cannot know what a call costs before you
   * have made it.
   */
  spend?: SpendCapConfig;
}

export interface RunInput<Ctx = unknown, Caller = unknown> {
  messages: ChatMessage[];
  caller: Caller;
  ctx: Ctx;
}

export interface Chat<Ctx = unknown, Caller = unknown> {
  /** The tools this caller may use — denied ones are absent, not flagged. */
  toolsFor(caller: Caller): Promise<ChatTool<Ctx>[]>;
  run(input: RunInput<Ctx, Caller>): AsyncIterable<ChatFrame>;
  /**
   * Whether a ceiling was configured. Read by `createChatHandler` so a PUBLIC
   * endpoint cannot be constructed over an uncapped chat — the handler owns the
   * door, the core owns the money, and neither can enforce the other's half
   * without being told.
   */
  readonly spendCapped: boolean;
}

export function createChat<Ctx = unknown, Caller = unknown>(
  opts: CreateChatOptions<Ctx, Caller>,
): Chat<Ctx, Caller> {
  const tools = (opts.tools ?? []).map((t) => defineTool(t));
  if (tools.length && typeof opts.can !== "function") {
    // Refusing here rather than defaulting to allow. An "everyone may use
    // everything" default is the same mistake as `!t.permission ||`, moved one
    // level up: it looks like configuration and behaves like an open door.
    throw new TypeError("createChat: `can` is required when tools are registered — there is no permissive default");
  }
  const can = opts.can;
  const maxRounds = opts.maxRounds ?? 6;
  const history = assertHistoryConfig(opts.history);
  // Refused at construction, not at 3am: a cap given "0", NaN, or a string
  // straight off an env var looks configured and enforces nothing.
  if (opts.spend !== undefined) assertSpendCapConfig(opts.spend);
  const spend = opts.spend;
  const name = opts.name ?? botName();
  const system = [corePrompt(name), opts.systemPrompt?.trim()].filter(Boolean).join("\n\n");

  async function toolsFor(caller: Caller): Promise<ChatTool<Ctx>[]> {
    if (!tools.length) return [];
    // `can` is asked ONCE PER TOOL, and the asks run concurrently rather than
    // in a queue. cms drove this: their chat has 64 tools, so a sequential loop
    // would be 64 round-trips stacked end to end before the model is even
    // called. Order is preserved because the verdicts are zipped back onto the
    // original list, not pushed as they resolve.
    //
    // NOTE FOR CONSUMERS WITH MANY TOOLS: this is N calls into YOUR `can`, so
    // memoise the underlying grants lookup per caller — otherwise concurrency
    // turns one slow lookup into N simultaneous ones.
    //
    // No `||`, no truthiness on the permission itself — the ONLY question is
    // whether the consumer says yes.
    const verdicts = await Promise.all(tools.map((t) => can!(t.permission, caller)));
    return tools.filter((_, i) => verdicts[i] === true);
  }

  async function* run(input: RunInput<Ctx, Caller>): AsyncIterable<ChatFrame> {
    // Per RUN, not per chat: the ceiling bounds one conversation. A shared
    // tracker would make the second visitor pay for the first one's loop.
    const tracker = spend ? createSpendTracker(spend) : null;
    const allowed = await toolsFor(input.caller);
    const byName = new Map(allowed.map((t) => [t.name, t]));
    const specs: ToolSpec[] = allowed.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    const messages = [...input.messages];

    for (let round = 0; round < maxRounds; round++) {
      const calls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
      let text = "";

      // Decide what to SEND. `messages` — the record of what actually happened
      // — is never rewritten; only the payload for this call is.
      let outgoing = messages;
      if (history) {
        const outcome = await prepareHistory(messages, history, system);
        if (outcome.status === "reduced") {
          outgoing = outcome.messages;
          yield {
            type: "history",
            action: "reduced",
            dropped: outcome.dropped,
            note: `${outcome.dropped} earlier message(s) were ${outcome.strategy === "compact" ? "summarised" : "left out"} to stay within the limit. The full conversation is unchanged.`,
          };
        } else if (outcome.status === "failed") {
          // Stop here rather than send a payload we know is too large. Sending
          // it is how cms's conversation dies: the provider 400s, and a retry
          // sends exactly the same thing again, for ever.
          yield { type: "history", action: "failed", note: outcome.note };
          yield { type: "done", reason: "too-large" };
          return;
        } else if (outcome.warning) {
          yield { type: "history", action: "warned", note: outcome.warning };
        }
      }

      try {
        for await (const ev of opts.model({ system, messages: outgoing, tools: specs })) {
          if (ev.type === "text") {
            text += ev.text;
            yield { type: "text", text: ev.text }; // streamed, not batched
          } else if (ev.type === "tool-call") {
            calls.push({ id: ev.id, name: ev.name, args: ev.args });
          } else {
            // Explicit rather than `else`. This used to be an else-branch over a
            // two-member union, so adding `usage` to it would have pushed a cost
            // report onto the call list as a tool named `undefined`.
            tracker?.record(ev);
          }
        }
      } catch (err) {
        yield { type: "error", scope: "model", message: messageOf(err) };
        yield { type: "done", reason: "complete" };
        return;
      }

      if (!calls.length) {
        yield { type: "done", reason: "complete" };
        return;
      }

      if (text) messages.push({ role: "assistant", content: text });

      for (const call of calls) {
        yield { type: "tool-call", id: call.id, name: call.name, args: call.args };
        const tool = byName.get(call.name);

        if (!tool) {
          // THE SECOND GATE. The name could only arrive here by the model
          // inventing it or a transcript being replayed — but in cms's case the
          // tool list WAS the only gate, so this one exists on purpose.
          const why = `no tool named "${call.name}" is available to you`;
          yield { type: "error", scope: "tool", name: call.name, message: why };
          messages.push({ role: "tool", toolCallId: call.id, content: `Error: ${why}` });
          continue;
        }

        try {
          const result = await tool.run(call.args, input.ctx);
          yield { type: "tool-result", id: call.id, name: call.name, result };
          messages.push({ role: "tool", toolCallId: call.id, content: serialise(result) });
        } catch (err) {
          // A broken tool degrades the ANSWER, never the conversation — the
          // model is told and can try something else. Same rule as the
          // device-stats middleware: a failing sub-part never takes the whole
          // request down.
          const why = messageOf(err);
          yield { type: "error", scope: "tool", name: call.name, message: why };
          messages.push({ role: "tool", toolCallId: call.id, content: `Error: ${why}` });
        }
      }

      // The ceiling is checked HERE — after a round that produced tool calls,
      // so another model call is about to happen, and never before the first
      // one. That ordering is the whole design: a single question is always
      // answered (the money is spent by the time an answer exists), and it is
      // the tool->model->tool loop that gets bounded.
      const verdict = tracker?.endRound();
      if (verdict?.status === "refused") {
        yield { type: "limit", reason: verdict.reason, note: verdict.note };
        yield { type: "done", reason: "limited" };
        return;
      }
    }

    // Distinct from "complete": the conversation was cut off mid-work, and a
    // caller that cannot tell those apart will report a truncated answer as a
    // finished one.
    yield { type: "done", reason: "max-rounds" };
  }

  return { toolsFor, run, spendCapped: spend !== undefined };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function serialise(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
