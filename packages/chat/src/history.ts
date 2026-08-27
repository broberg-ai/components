/**
 * @broberg/chat/history — keep a conversation alive past the model's limit (F079.9).
 *
 * THE DEFECT THIS EXISTS TO PREVENT, measured by cms in their own chat:
 * nothing truncates, so the client sends the WHOLE conversation on every
 * message; `maxTokens` on the route is the OUTPUT limit and nothing handles
 * input overflow; the provider 400s and the raw error text reaches the user.
 *
 * And the part that makes it serious: BECAUSE NOTHING TRUNCATES, A RETRY
 * RESENDS THE SAME OVERSIZED PAYLOAD. The conversation is not expensive, it is
 * DEAD — from the moment it tips, after a long session, which is precisely when
 * there is most to lose. So the test that matters is not "the message got
 * shorter"; it is that THE NEXT TURN ON THE SAME CONVERSATION SUCCEEDS.
 *
 * COMPACTION CHANGES WHAT THE MODEL SEES, NEVER WHAT THE USER CAN READ.
 * cms's rule, from a real user they are not: someone uses their admin chat as a
 * working tool and may expect to re-read a session word for word. This module
 * never mutates the array it is given — the caller keeps the original, always.
 */
import type { ChatMessage } from "./index.js";

/**
 * Chosen, never assumed.
 *
 * `rag` (store everything, retrieve only what is relevant) is deliberately NOT
 * in this union yet. Christian put it last — "vi skal have noget i drift med FD
 * Sundhed FØR vi har RAG klar" — and an option that exists and throws is worse
 * than one that does not exist: the first fails in production, the second fails
 * in the consumer's editor.
 */
export type HistoryStrategy = "window" | "compact";

export interface HistoryConfig {
  /** REQUIRED. There is no default — "none" is the state that kills conversations. */
  strategy: HistoryStrategy;
  /**
   * REQUIRED, and declared by YOU.
   *
   * Deliberately not read from @broberg/ai-sdk's registry: cms measured, and
   * ai-sdk confirmed, that a model object carries exactly
   * [id, alias, provider, available, status, note, source] — there is NO
   * context window on any of the 10 models. The only number that looks like one
   * is `maxTokens`, which is a per-call OUTPUT limit. Reading it as "the window"
   * yields a number for something else entirely, which is worse than no number
   * because it looks like an answer.
   */
  maxInputTokens: number;
  /**
   * How to count. The default is a rough heuristic (~4 characters per token)
   * and is documented as such — if you have a real tokenizer, inject it. An
   * estimate that is quietly treated as exact is how a limit gets crossed while
   * the number still looks fine.
   */
  estimate?: (messages: ChatMessage[], system?: string) => number;
  /** `window`: how many of the most recent messages to protect. Default 6. */
  keepRecent?: number;
  /**
   * `compact`: summarise the turns being removed. Yours, because only you know
   * what matters in this conversation — and because a summary is a model call,
   * which this package does not make.
   */
  summarise?: (older: ChatMessage[]) => Promise<string> | string;
  /** Warn at this fraction of the limit. Default 0.8. Set 0 to disable. */
  warnAt?: number;
}

export type HistoryOutcome =
  | { status: "unchanged"; messages: ChatMessage[]; estimatedTokens: number; warning?: string }
  | {
      status: "reduced";
      messages: ChatMessage[];
      estimatedTokens: number;
      /** How many messages left the transcript SENT to the model. Never silent. */
      dropped: number;
      strategy: HistoryStrategy;
    }
  | {
      status: "failed";
      /**
       * Two different things, and they must never be one.
       *
       * `compaction_failed` — the summariser threw. `cannot_reduce` — there was
       * nothing left to remove. sanne's rule, generalised: when a layer beneath
       * the chat can fail, the failure carries its own state all the way up and
       * never merges with "nothing found".
       */
      reason: "compaction_failed" | "cannot_reduce";
      /** UNCHANGED. A failure never returns a half-shortened transcript. */
      messages: ChatMessage[];
      estimatedTokens: number;
      note: string;
    };

const DEFAULT_KEEP_RECENT = 6;
const DEFAULT_WARN_AT = 0.8;

/** ~4 characters per token. An estimate, and it says so. */
export function estimateTokens(messages: ChatMessage[], system?: string): number {
  let chars = system ? system.length : 0;
  for (const m of messages) chars += m.content.length + m.role.length + 8;
  return Math.ceil(chars / 4);
}

export function assertHistoryConfig(config: HistoryConfig | undefined): HistoryConfig | undefined {
  if (config === undefined) return undefined;
  // No silent default. "none" is exactly the state cms is in, and it is what
  // costs the conversation.
  if (config.strategy !== "window" && config.strategy !== "compact") {
    throw new TypeError(
      'history: `strategy` must be "window" or "compact". There is no default — an unbounded ' +
        "conversation dies at the limit and a retry resends the same oversized payload.",
    );
  }
  if (!Number.isFinite(config.maxInputTokens) || config.maxInputTokens <= 0) {
    throw new TypeError(
      "history: `maxInputTokens` is required and must be a positive number. It is NOT read from the " +
        "model registry — there is no context window in it, and the number that looks like one is an " +
        "output limit.",
    );
  }
  if (config.strategy === "compact" && typeof config.summarise !== "function") {
    throw new TypeError('history: strategy "compact" requires a `summarise` function — this package makes no model calls of its own.');
  }
  return config;
}

/**
 * Decide what to SEND. Never mutates `messages`.
 */
export async function prepareHistory(
  messages: ChatMessage[],
  config: HistoryConfig,
  system?: string,
): Promise<HistoryOutcome> {
  const estimate = config.estimate ?? estimateTokens;
  const limit = config.maxInputTokens;
  const before = estimate(messages, system);

  if (before <= limit) {
    const warnAt = config.warnAt ?? DEFAULT_WARN_AT;
    const warning =
      warnAt > 0 && before >= limit * warnAt
        ? `This conversation is using about ${before} of ${limit} tokens. Older turns will start being ${config.strategy === "compact" ? "summarised" : "dropped"} soon.`
        : undefined;
    return { status: "unchanged", messages, estimatedTokens: before, ...(warning ? { warning } : {}) };
  }

  const keepRecent = Math.max(1, config.keepRecent ?? DEFAULT_KEEP_RECENT);

  if (config.strategy === "window") {
    for (let keep = Math.min(keepRecent, messages.length); keep >= 1; keep--) {
      const kept = trimLeadingToolMessages(messages.slice(messages.length - keep));
      if (!kept.length) continue;
      const size = estimate(kept, system);
      if (size <= limit) {
        return { status: "reduced", messages: kept, estimatedTokens: size, dropped: messages.length - kept.length, strategy: "window" };
      }
    }
    return cannotReduce(messages, before);
  }

  // compact
  //
  // `keepRecent` is a CEILING, not a fixed size — the same step-down the window
  // strategy uses. A single fixed value would report "cannot reduce" on a
  // conversation that fits perfectly well one message shorter, which is a
  // conversation killed by an off-by-one.
  const older = messages.slice(0, Math.max(0, messages.length - keepRecent));
  if (!older.length) return cannotReduce(messages, before);

  let summary: string;
  try {
    summary = await config.summarise!(older);
  } catch (err) {
    // NOT "cannot_reduce", and NOT a shortened transcript. A summariser that
    // failed must be visible as a failure, or people's history disappears in
    // good faith.
    return {
      status: "failed",
      reason: "compaction_failed",
      messages,
      estimatedTokens: before,
      note: `The earlier turns could not be summarised (${err instanceof Error ? err.message : String(err)}). Nothing was removed.`,
    };
  }

  if (typeof summary !== "string" || !summary.trim()) {
    return {
      status: "failed",
      reason: "compaction_failed",
      messages,
      estimatedTokens: before,
      note: "The summariser returned nothing usable. Nothing was removed.",
    };
  }

  // Marked explicitly so nobody — model or reader — mistakes a summary for
  // something the assistant actually said in the conversation.
  const head: ChatMessage = { role: "assistant", content: `[Summary of earlier turns] ${summary.trim()}` };

  for (let keep = keepRecent; keep >= 0; keep--) {
    const recent = trimLeadingToolMessages(messages.slice(messages.length - keep));
    const compacted: ChatMessage[] = [head, ...recent];
    const size = estimate(compacted, system);
    if (size <= limit) {
      return {
        status: "reduced",
        messages: compacted,
        estimatedTokens: size,
        dropped: messages.length - recent.length,
        strategy: "compact",
      };
    }
  }
  // Even the summary alone is over the limit.
  return cannotReduce(messages, before);
}

function cannotReduce(messages: ChatMessage[], estimatedTokens: number): HistoryOutcome {
  return {
    status: "failed",
    reason: "cannot_reduce",
    messages,
    estimatedTokens,
    note: "This turn is too large on its own and cannot be shortened by removing older ones.",
  };
}

/**
 * A `tool` message answers a call in the message before it. Left at the front
 * of a transcript it refers to something the model can no longer see.
 */
function trimLeadingToolMessages(messages: ChatMessage[]): ChatMessage[] {
  let i = 0;
  while (i < messages.length && messages[i]!.role === "tool") i++;
  return messages.slice(i);
}
