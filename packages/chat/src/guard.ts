/**
 * @broberg/chat/guard — the spend ceiling (F079.5).
 *
 * A public chat is an open LLM-spend faucet on a surface where strangers decide
 * the volume. This is the ceiling. It is deliberately NOT a ledger: no billing,
 * no per-tenant accounting, no invoice — one number, and a refusal when it is
 * reached.
 *
 * THE FIRST THING MEASURED WHEN THIS WAS WRITTEN was that the core had no cost
 * channel at all: `ModelEvent` yielded `text` and `tool-call` and nothing else,
 * so the number a cap reads was discarded one layer below the guard that would
 * read it. `usage` was added to that union in the same change.
 */

/** What a `ModelFn` reports about one model round. */
export interface UsageReport {
  /** Lower-cased provider id as @broberg/ai-sdk reports it: "mistral", "gemini", … */
  provider: string;
  model: string;
  /**
   * What this round actually cost, in USD.
   *
   * OPTIONAL, and that is the dangerous part rather than a convenience: every
   * `ModelFn` in the fleet today reports nothing at all. See `endRound()`.
   */
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export type SpendRefusalReason = "spend_cap" | "unmeasurable_cost" | "untrusted_provider";

export type SpendVerdict =
  | { status: "ok"; spentUsd: number }
  | { status: "refused"; reason: SpendRefusalReason; note: string; spentUsd: number };

/**
 * Providers whose reported cost we are willing to enforce a ceiling on.
 *
 * `openai` and `deepseek` are ABSENT ON PURPOSE. ai-sdk's F040 audit found that
 * both cache automatically — no money is lost, the provider gives the discount
 * — but the SDK's reported price was too high because it neither read their
 * cache figures nor held cache prices for them. That figure is exactly what a
 * budget guard reads, so a cap built on it trips early, on a bill nobody ran up.
 * gemini and vertex were corrected in 0.32.0 against Google's own published
 * rates, measured live; openai and deepseek could not be measured because there
 * was no key for either, and ai-sdk wrote nothing rather than writing it from
 * memory. Add a provider here when its cost has been MEASURED, not when it
 * feels safe.
 */
export const TRUSTED_COST_PROVIDERS: readonly string[] = ["mistral", "anthropic", "gemini", "vertex"];

export interface SpendCapConfig {
  /** The ceiling for ONE conversation, in USD. Required — there is no default. */
  limitUsd: number;
  /** Override the allowlist above. An empty array refuses everything, by design. */
  trustedProviders?: readonly string[];
}

/**
 * Refuse a cap that cannot do its job, at construction, rather than at 3am.
 *
 * Same shape as `can` in the core and the strategy in F079.9: a configuration
 * that looks set and behaves absent is the failure mode this whole epic exists
 * to remove.
 */
export function assertSpendCapConfig(cfg: SpendCapConfig | undefined): asserts cfg is SpendCapConfig {
  if (!cfg || typeof cfg !== "object") {
    throw new TypeError("spend: a spend cap must be an object with `limitUsd`.");
  }
  const { limitUsd } = cfg;
  if (typeof limitUsd !== "number" || !Number.isFinite(limitUsd) || limitUsd <= 0) {
    throw new TypeError(
      "spend.limitUsd must be a finite number greater than 0. A ceiling of 0 (or NaN, or a string " +
        'read straight from an env var) is not "no spending" — it is a cap that refuses every ' +
        "conversation or none, depending on which comparison runs first.",
    );
  }
  if (cfg.trustedProviders !== undefined && !Array.isArray(cfg.trustedProviders)) {
    throw new TypeError("spend.trustedProviders, when given, must be an array of provider ids.");
  }
}

export interface SpendTracker {
  /** Record one `usage` event from the model. */
  record(usage: UsageReport): void;
  /**
   * Decide whether the conversation may continue into ANOTHER round.
   *
   * Called after a round finishes, never before the first one — you cannot know
   * what a call costs until you have made it. So the ceiling bounds a runaway
   * tool->model->tool loop, which is the actual threat, and a single question is
   * always answered.
   */
  endRound(): SpendVerdict;
  readonly spentUsd: number;
}

export function createSpendTracker(cfg: SpendCapConfig): SpendTracker {
  assertSpendCapConfig(cfg);
  const trusted = new Set((cfg.trustedProviders ?? TRUSTED_COST_PROVIDERS).map((p) => String(p).toLowerCase()));

  let spentUsd = 0;
  let sawUsage = false;
  /** Sticky: once we know the number is untrustworthy, later good rounds do not redeem it. */
  let poisoned: { reason: SpendRefusalReason; note: string } | null = null;

  return {
    get spentUsd() {
      return spentUsd;
    },

    record(usage: UsageReport): void {
      const provider = String(usage?.provider ?? "").toLowerCase();
      if (!trusted.has(provider)) {
        poisoned ??= {
          reason: "untrusted_provider",
          note:
            `the cost reported by "${usage?.provider}" is not one this cap is allowed to enforce on, so it ` +
            "refuses rather than allowing. An unanswerable question reads as unanswered, never as within budget.",
        };
        return;
      }
      const cost = usage.costUsd;
      if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
        poisoned ??= {
          reason: "unmeasurable_cost",
          note:
            "the model reported a round with no usable cost, so the ceiling has nothing to count. A cap that " +
            "treats no number as within budget is a cap that can never be reached and never says why.",
        };
        return;
      }
      // Only what was ACTUALLY billed. Gemini's implicit caching is
      // opportunistic — in ai-sdk's live run only call 2 hit while 3-6 missed on
      // an identical prefix — so a discount is counted when it arrives and never
      // assumed. A saving you report correctly is not a saving you promise.
      spentUsd += cost;
      sawUsage = true;
    },

    endRound(): SpendVerdict {
      if (poisoned) return { status: "refused", ...poisoned, spentUsd };
      if (!sawUsage) {
        return {
          status: "refused",
          reason: "unmeasurable_cost",
          note:
            "this round reported no usage at all, so the ceiling is blind. Every ModelFn in the fleet reported " +
            "nothing when this was written, which is why silence refuses instead of passing.",
          spentUsd,
        };
      }
      if (spentUsd >= cfg.limitUsd) {
        return {
          status: "refused",
          reason: "spend_cap",
          note: `this conversation has reached its ceiling of $${cfg.limitUsd}.`,
          spentUsd,
        };
      }
      sawUsage = false;
      return { status: "ok", spentUsd };
    },
  };
}
