/**
 * @broberg/chat/testing — a test double that REFUSES what a provider refuses
 * (F079.11).
 *
 * THIS FILE EXISTS BECAUSE OUR TESTS WERE TOO KIND. cms took their chat to
 * production on 0.3.0 and every question requiring a tool failed for ~40
 * minutes: the tool ran, the result came back, and the round that would have
 * turned it into a sentence was rejected by Mistral with
 * `Unexpected role 'tool' after role 'user'` (invalid_request_message_order,
 * code 3230).
 *
 * 181 tests here and 1,283 there were green throughout, and NEITHER SUITE COULD
 * HAVE CAUGHT IT: every one of them ran against a fake `ModelFn`, and a fake
 * accepts any message shape you hand it. cms named it better than we did —
 * "attrappen var tro mod GRÆNSEFLADEN og ikke mod VERDEN". The broken condition
 * belongs to the PROVIDER, and nothing in either repo had ever spoken to one.
 *
 * So this is not a mock of a model. It is the providers' documented ordering
 * rule, written down as an assertion, so a stub can disagree with you.
 *
 * ⚠️ IT IS NOT A MEASUREMENT. We have no provider key outside production, so
 * this encodes what Mistral, OpenAI and Anthropic DOCUMENT, not what they were
 * observed to do. A live tool round-trip against the cheapest model is still
 * the test that would have caught this first, and it remains outstanding.
 *
 * ⚠️⚠️ WHAT THIS DOES **NOT** COVER — read this before you conclude "tools are
 * tested". cms hit a SECOND crash minutes after adopting the fix above, and
 * `assertProviderTranscript` was **green through all of it**:
 *
 *     invalid_type · expected object · received undefined
 *     path: messages.1.toolCalls.0.arguments · "Required"
 *
 * We emit `toolCalls: [{ id, name, args }]`. The SDK they hand it to wants
 * `arguments`. This file validates OUR shape and the PROVIDERS' ordering rules
 * — **it knows nothing about the library you pass the result to.**
 *
 * > **A strict double is only strict about the contract it was TOLD about, and
 * > there is usually more than one.** The guard against "your stub agrees with
 * > you" is itself a stub for everything nobody described to it.
 *
 * So it covers exactly one seam: *your transcript ↔ the providers' rules*. The
 * seam *your code ↔ your own SDK* is yours, and no assertion here can see it.
 *
 * AND THE OBVIOUS WAY TO USE THIS WRONG, which looks entirely right — also cms,
 * reported against themselves: they handed `createStrictModel` straight to their
 * chat factory, so **their own translation layer never ran**. Mutating that layer
 * turned nothing red. The test proved our engine emits a valid stream and
 * NOTHING about their delivery — which is exactly where both crashes were.
 *
 * Point it at what YOU send:
 *
 * ```ts
 * // your named seam, so a mutation of it can go red
 * const payload = toProviderMessages(messages);
 * expect(payload[1].toolCalls[0].arguments).toEqual({ q: "x" });   // YOUR contract
 * assertProviderTranscript(messages);                             // ours + the provider's
 * ```
 *
 * (That line said `tool_calls` when 0.5.1 shipped — snake_case is what the
 * providers put on the WIRE, and @broberg/ai-sdk normalises to `toolCalls` at
 * the boundary. cms caught it within the hour. The example teaching people to
 * check field names had the wrong field name in it: verify the shape against the
 * type file, never against your memory of the API.)
 */
import type { ChatMessage, ModelEvent, ModelFn, ModelRequest } from "./index.js";

/** Thrown the way a provider 400s, so a test failure reads like the outage did. */
export class InvalidTranscriptError extends Error {
  readonly code = "invalid_request_message_order";
  constructor(message: string) {
    super(message);
    this.name = "InvalidTranscriptError";
  }
}

/**
 * The rule every major provider enforces and no stub does: a tool result must
 * answer an assistant turn that asked for it.
 *
 * Throws `InvalidTranscriptError` on the first violation. Returns nothing when
 * the transcript is one a provider would accept.
 */
export function assertProviderTranscript(messages: readonly ChatMessage[]): void {
  /** Call ids the most recent assistant turn asked for and that are still unanswered. */
  let outstanding = new Map<string, string>();

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;

    if (m.role === "assistant") {
      if (outstanding.size) {
        // A second assistant turn while calls are unanswered: the provider has
        // no result to reason from, and the pairing is broken in the other
        // direction.
        throw new InvalidTranscriptError(
          `message ${i}: an assistant turn arrived while ${outstanding.size} tool call(s) were still unanswered ` +
            `(${[...outstanding.values()].join(", ")}). Every call must be answered by a \`tool\` message before the next assistant turn.`,
        );
      }
      outstanding = new Map((m.toolCalls ?? []).map((c) => [c.id, c.name]));
      continue;
    }

    if (m.role === "tool") {
      if (!outstanding.size) {
        const before = i > 0 ? messages[i - 1]!.role : "nothing";
        throw new InvalidTranscriptError(
          `message ${i}: unexpected role 'tool' after role '${before}'. A tool result must answer an assistant turn that ` +
            "asked for it — the assistant turn is missing, or it carries no `toolCalls`.",
        );
      }
      if (m.toolCallId === undefined) {
        throw new InvalidTranscriptError(`message ${i}: a \`tool\` message has no \`toolCallId\`, so nothing can say which call it answers.`);
      }
      if (!outstanding.has(m.toolCallId)) {
        // NOT repaired, deliberately — cms's rule, adopted: an invented pairing
        // is a second wrong answer, and the provider's own error is more useful
        // than our guess.
        throw new InvalidTranscriptError(
          `message ${i}: \`toolCallId\` "${m.toolCallId}" answers no call in the preceding assistant turn ` +
            `(it asked for: ${[...outstanding.keys()].map((k) => `"${k}"`).join(", ") || "nothing"}).`,
        );
      }
      outstanding.delete(m.toolCallId);
      continue;
    }

    // role === "user"
    if (outstanding.size) {
      throw new InvalidTranscriptError(
        `message ${i}: a user turn arrived while ${outstanding.size} tool call(s) were still unanswered ` +
          `(${[...outstanding.values()].join(", ")}).`,
      );
    }
  }
}

/**
 * A `ModelFn` that validates the transcript before it answers — the same check
 * a real provider runs, in front of whatever your test wants the model to say.
 *
 * ```ts
 * const model = createStrictModel([
 *   [{ type: "tool-call", id: "c1", name: "search", args: {} }],   // round 1
 *   [{ type: "text", text: "48 posts" }],                          // round 2
 * ]);
 * ```
 *
 * Use it for any test that involves tools. A permissive stub cannot fail where
 * a provider would, so a suite built on one agrees with your code instead of
 * checking it.
 */
export function createStrictModel(rounds: ReadonlyArray<readonly ModelEvent[]>): ModelFn {
  let round = 0;
  return async function* strictModel(req: ModelRequest): AsyncIterable<ModelEvent> {
    assertProviderTranscript(req.messages);
    const events = rounds[round++] ?? [];
    for (const ev of events) yield ev;
  };
}
