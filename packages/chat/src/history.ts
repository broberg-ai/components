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
import type { ChatMessage, ToolSpec } from "./index.js";

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
  /**
   * Anything ELSE that goes out with every call and is neither a message nor a
   * tool schema — a provider preamble, a prefix your gateway injects. Optional.
   *
   * The tool schemas are NOT this: they are counted from the specs themselves
   * (see `prepareHistory`'s fourth argument), because a number you have to
   * remember to keep in step with your tool list is a number that goes stale
   * the first time somebody adds a tool.
   */
  fixedOverheadTokens?: number;
}

/**
 * The machine-readable half of a failure. Named so it can travel — F079.12: the
 * loop used to drop it, leaving a consumer nothing to switch on but our English
 * prose, and one of them passed that prose straight to a customer.
 */
export type HistoryFailureReason = "compaction_failed" | "cannot_reduce" | "overhead_exceeds_limit";

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
       *
       * `overhead_exceeds_limit` is the THIRD, added in F079.10 for the same
       * reason: the fixed cost that goes out with every call (tool schemas +
       * system prompt) does not fit on its own, so no amount of shortening the
       * conversation can help. Folded into `cannot_reduce` it would tell the
       * consumer to trim a message that is not the problem — the fix is fewer
       * tools or a higher limit, and only a distinct state can say so.
       */
      reason: HistoryFailureReason;
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

/**
 * The text a tool set actually costs on the wire: name, description and the
 * full JSON Schema for the arguments, for every tool the caller may use.
 *
 * cms measured their own 64 tools on the day they adopted this package:
 * names 967 chars, descriptions 8,543, input schemas 18,756 — 28,266 characters,
 * about 8,300 tokens, ON EVERY CALL. Two thirds of it is schema rather than
 * prose, and it grows every time somebody adds a tool.
 */
export function toolSchemaText(tools: readonly ToolSpec[]): string {
  let text = "";
  for (const t of tools) text += `${t.name}\n${t.description}\n${JSON.stringify(t.parameters)}\n`;
  return text;
}

/**
 * What the tool schemas cost, counted with the SAME estimator as everything
 * else — so a consumer who injects a tokenizer calibrated for their language
 * gets one rate applied to the whole payload, not their rate on the messages
 * and ours on the schemas.
 *
 * The text is handed over as the `system` argument because that is what a tool
 * set is from the counter's point of view: fixed text prepended to every call,
 * belonging to no turn in the conversation.
 */
export function estimateToolTokens(
  tools: readonly ToolSpec[],
  estimate: (messages: ChatMessage[], system?: string) => number = estimateTokens,
): number {
  if (!tools.length) return 0;
  return estimate([], toolSchemaText(tools));
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
  if (config.fixedOverheadTokens !== undefined) {
    // Same refusal as the spend cap: a value that arrived as a string off an
    // env var, or as NaN from a failed parse, LOOKS configured and counts
    // nothing. Absent is a legitimate answer; present-and-not-a-number is not.
    if (!Number.isFinite(config.fixedOverheadTokens) || config.fixedOverheadTokens < 0) {
      throw new TypeError(
        "history: `fixedOverheadTokens` must be a non-negative number when present. Leave it out if there is no extra " +
          "fixed cost — do not pass a string, NaN, or a negative, which would silently under-count what you send.",
      );
    }
  }
  return config;
}

/**
 * Decide what to SEND. Never mutates `messages`.
 *
 * `tools` — THE FOURTH ARGUMENT — is the fix F079.10 exists for. Until it
 * existed this function counted only the messages and the system prompt, so
 * for any consumer with a real tool set the number it compared against the
 * limit was systematically LOW by the whole cost of the tool schemas. Low is
 * the green direction: the guard reports room while the provider is already
 * over, and the conversation dies in the exact way this module was written to
 * prevent — on the consumer who did everything we asked.
 *
 * `createChat` passes the caller's ALLOWED tools automatically, so nothing has
 * to be remembered there. Pass them yourself if you call this directly.
 */
export async function prepareHistory(
  messages: ChatMessage[],
  config: HistoryConfig,
  system?: string,
  tools: readonly ToolSpec[] = [],
): Promise<HistoryOutcome> {
  const estimate = config.estimate ?? estimateTokens;
  const limit = config.maxInputTokens;
  // Fixed: it rides along with every candidate payload, so it is added to each
  // one rather than compared once and forgotten.
  const overhead = estimateToolTokens(tools, estimate) + (config.fixedOverheadTokens ?? 0);
  const before = estimate(messages, system) + overhead;

  // Checked BEFORE any shortening. If the fixed cost alone is over the limit,
  // every candidate below is over it too, and reporting that as "this turn is
  // too large" would point the consumer at the wrong thing entirely.
  if (overhead > limit) {
    return {
      status: "failed",
      reason: "overhead_exceeds_limit",
      messages,
      estimatedTokens: before,
      note:
        `The tool definitions and fixed prompt come to about ${overhead} tokens, which is already over the ${limit}-token limit ` +
        "before a single message is added. Shortening the conversation cannot help — offer this caller fewer tools, or raise the limit.",
    };
  }

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
      const size = estimate(kept, system) + overhead;
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
    const size = estimate(compacted, system) + overhead;
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

// ---------------------------------------------------------------------------
// profiles — the question a person can actually answer (F079.10)
// ---------------------------------------------------------------------------

/**
 * `{ strategy, maxInputTokens }` is two numbers. The question a person actually
 * decides is: *what happens when the conversation gets too long, and how long
 * may it get?* — and that has a different answer when someone authors content
 * for hours than when a visitor asks three questions.
 *
 * cms put it to Christian in these words and he answered in two seconds. It
 * could not have been asked in tokens. So the translation lives here, once,
 * instead of in every consumer.
 */
export type HistoryProfile = "visitor-qa" | "standard" | "long-authoring";

export interface HistoryProfileSpec {
  strategy: HistoryStrategy;
  maxInputTokens: number;
  keepRecent: number;
  /** What this profile is FOR, in the words the decision is made in. */
  describes: string;
  /** True when it cannot be used without a `summarise` you supply. */
  requiresSummarise: boolean;
}

/**
 * THESE NUMBERS ARE DERIVED, NOT MEASURED, and the difference is on the record.
 *
 * They are chosen to sit comfortably inside a 128k-token context even with a
 * large tool set and a full-length answer — deliberately conservative, because
 * we cannot hold a key for every model in every repo and a ceiling table
 * without dates rots. They are a safe floor to start from, not the most your
 * model can take: measure yours, then raise it with the object form.
 *
 * cms could not run the empirical ceiling test either (no Mistral key outside
 * production), and said so rather than presenting a derivation as a
 * measurement. Same standard here.
 */
export const HISTORY_PROFILES: Record<HistoryProfile, HistoryProfileSpec> = {
  "visitor-qa": {
    strategy: "window",
    maxInputTokens: 8_000,
    keepRecent: 8,
    describes:
      "A stranger asks a handful of questions and leaves. Short by nature, so the oldest turns are simply dropped — there is no long-lived instruction to lose, and dropping costs nothing and takes no time.",
    requiresSummarise: false,
  },
  standard: {
    strategy: "window",
    maxInputTokens: 24_000,
    keepRecent: 10,
    describes:
      "An ordinary back-and-forth. The oldest turns are dropped when it runs long. Free and instant — but see the warning on `window`: what goes first is usually the opening instruction.",
    requiresSummarise: false,
  },
  "long-authoring": {
    strategy: "compact",
    maxInputTokens: 60_000,
    keepRecent: 12,
    describes:
      "Someone works in the chat for hours and refers back to things agreed early on. The oldest turns are summarised rather than dropped, so the thread survives; it costs one extra model call each time it fires.",
    requiresSummarise: true,
  },
};

/**
 * Resolve a named profile to a real `HistoryConfig`. The object form still
 * works everywhere a profile does — a profile is a starting point you can
 * steer, never a replacement for the numbers.
 */
export function resolveHistoryProfile(
  profile: HistoryProfile,
  overrides?: Partial<HistoryConfig>,
): HistoryConfig {
  const spec = HISTORY_PROFILES[profile];
  if (!spec) {
    // No fallback to a default. Picking one silently would be us making a
    // decision about somebody's bill and about which of their turns survive,
    // on the strength of a typo.
    throw new TypeError(
      `history: "${String(profile)}" is not a profile. Valid profiles are ${Object.keys(HISTORY_PROFILES)
        .map((p) => `"${p}"`)
        .join(", ")} — or pass the full { strategy, maxInputTokens } object.`,
    );
  }

  const config: HistoryConfig = {
    strategy: spec.strategy,
    maxInputTokens: spec.maxInputTokens,
    keepRecent: spec.keepRecent,
    ...overrides,
  };

  if (config.strategy === "compact" && typeof config.summarise !== "function") {
    // The doc IS the error. A profile that quietly fell back to dropping turns
    // would take the user's opening instruction with it and look completely
    // normal doing so — which is the hidden cost this profile exists to avoid.
    throw new TypeError(
      `history: profile "${profile}" summarises the oldest turns so the thread survives, and a summary is a model call ` +
        `this package does not make. Pass your own: resolveHistoryProfile("${profile}", { summarise }). If you would rather ` +
        `DROP the oldest turns instead — free and instant, but it usually takes the user's opening instruction (tone, ` +
        `language, role) with it — use the "standard" profile.`,
    );
  }

  return assertHistoryConfig(config)!;
}
