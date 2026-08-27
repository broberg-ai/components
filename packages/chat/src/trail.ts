/**
 * @broberg/chat/trail — knowledge from Trail, as a TOOL (F079.2).
 *
 * Christian, 2026-08-27: "ALLE CHATS SKAL anvende trail — det er IKKE til
 * diskussion." So this is the fleet's one knowledge path, and everything below
 * is shaped by that: a defect here is a defect in every chat at once.
 *
 * THE WIRE SHAPE IS MEASURED, NOT DOCUMENTED. sanne probed the deployed engine
 * from inside production and sent back the real request and the real response
 * keys — including two (`images`, `userNote`) that their own TypeScript type
 * did not declare and had therefore been silently discarding. A type is not a
 * contract test. So the parsing here is written against a recorded response and
 * pinned by one.
 *
 * THE FAILURE THIS FILE EXISTS TO AVOID IS ALSO sanne's, and they found it in
 * their own code while answering us. Their TOOL distinguishes four outcomes —
 * no hits, non-2xx, network down, missing key — and then their PROMPT merges
 * them again: one instruction for "returns nothing OR fails", telling the model
 * to answer from its own general training knowledge and never to say it cannot
 * answer. So when Trail is down, a zone-therapy clinic's assistant answers
 * HEALTH questions from generic training knowledge, in the practitioner's own
 * voice, and nobody can see the knowledge base was never asked.
 *
 * That is the Eir shop incident one storey down. The cure is not a better
 * sentence in a prompt: it is that "I could not ask" and "there is nothing"
 * must not be the same VALUE. A prompt cannot merge two states it receives as
 * different data — so this returns a typed result, never a string.
 *
 * And errors never travel in the content channel: a model handed
 * "[error] HTTP 500 …" reads an error message as knowledge.
 */
import { defineTool, type ChatTool } from "./index.js";

/** One passage of knowledge. A projection of Trail's chunk, with a ceiling. */
export interface TrailPassage {
  title: string;
  /** Trail's own path for the neuron — what makes a citation possible at all. */
  path?: string;
  breadcrumb?: string;
  content: string;
}

/**
 * Freshness, stated even when it is unknown.
 *
 * MEASURED by sanne across all five top-level and all eight chunk keys of a
 * real response: Trail reports no `updatedAt`, `createdAt` or `version`
 * anywhere. fd-sundhed's objection — their prose answers are DECISIONS that
 * change, one of which flipped twice in four hours — therefore cannot be
 * answered from a retrieve response today.
 *
 * So the field is present and says so. An absent date must never be read as
 * "current"; an absence read as a verdict is a failure this fleet has now
 * measured in both directions.
 */
export interface TrailFreshness {
  known: false;
  note: string;
}

export type TrailResult =
  | {
      status: "hit";
      passages: TrailPassage[];
      freshness: TrailFreshness;
      /** Present only when OUR ceiling dropped something. Never silent. */
      truncated?: { droppedPassages: number; reason: "max_passages" | "max_chars" };
    }
  | { status: "empty"; freshness: TrailFreshness; note: string }
  | {
      status: "unavailable";
      /**
       * A short machine reason. NEVER the provider's body — see the file header.
       *
       * `unauthorized` is separate from `http_error` on purpose. Trail answers a
       * key used against the WRONG HOST with 401 "Invalid or revoked API key" —
       * a message that blames the key. Measured by trail: the same key returns
       * 200 on app.trailmem.com and 401 on engine.trailmem.com. Folding that
       * into a generic http_error would leave a consumer rotating a key that
       * was never the problem.
       */
      reason: "timeout" | "network" | "unauthorized" | "http_error" | "bad_response";
      note: string;
    };

export interface TrailRetrieverOptions {
  /** e.g. https://engine.trailmem.com */
  baseUrl: string;
  /**
   * The ONE knowledge base this tool may read.
   *
   * Configuration, never an argument: it does not appear in the schema the
   * model sees, and a `kb` arriving in the model's arguments is ignored. If it
   * were an argument, a model could be talked into another tenant's knowledge —
   * and trail's own code comment records that an older version resolved on id
   * alone, without a tenant check. fd-sundhed alone is getting two knowledge
   * bases, written for readers with different rights.
   */
  kbId: string;
  /** Trail bearer token. Read inside run(), never placed on a frame. */
  token: string;
  /**
   * The tenant slug, sent as `X-Trail-Tenant`. REQUIRED on the app route.
   *
   * THERE ARE TWO HOSTS AND ONE KEY DOES NOT FIT BOTH — measured by trail on a
   * live call, and they fell into it themselves while answering us:
   *
   *   app.trailmem.com     the admin proxy. Takes an APP key + X-Trail-Tenant,
   *                        looks the tenant up and forwards with the tenant's
   *                        OWN bearer. This is the route to use unless someone
   *                        has handed you a tenant key.
   *   engine.trailmem.com  wants the TENANT key directly. sanne call this one
   *                        because they were given that key.
   *
   * The same key returns 200 on the first and 401 "Invalid or revoked API key"
   * on the second — an error that blames the key rather than the address.
   *
   * NOTE ON ISOLATION: an app key can be scoped to several tenants, and
   * `X-Trail-Tenant` chooses between them. A partner scope bound to ONE
   * knowledge base is carded at trail (F205.1) but NOT BUILT — so until it is,
   * the configuration lock here is the real barrier, not theirs.
   */
  tenant?: string;
  /** Required, like every tool in this package. There is no default. */
  permission: string;
  /** Injected — so every state below is provable with no network and no key. */
  fetch?: typeof globalThis.fetch;
  name?: string;
  /** What the model is told this knowledge covers. */
  description?: string;
  audience?: string;
  /** Trail's own budget. */
  maxChars?: number;
  topK?: number;
  timeoutMs?: number;
  /**
   * OUR ceiling, on top of Trail's.
   *
   * sanne pass Trail's `formattedContext` through untouched and cap nothing
   * themselves — so the day Trail stops honouring `maxChars`, they have no
   * ceiling at all. cms measured the adjacent version of this: a 6,619-token
   * prompt, 56% schema, no ceiling, rebuilt every message.
   */
  maxPassages?: number;
  maxTotalChars?: number;
}

const NO_FRESHNESS: TrailFreshness = {
  known: false,
  note: "Trail does not report when this knowledge was last updated, so it may be out of date. Say so if the answer depends on a decision that could have changed.",
};

const DEFAULT_DESCRIPTION =
  "Look this up in the knowledge base before answering. Call it for ANY question about this organisation, its rules, its services or its decisions — the knowledge base takes precedence over what you already know.";

export function trailRetriever<Ctx = unknown>(opts: TrailRetrieverOptions): ChatTool<Ctx> {
  const {
    baseUrl,
    kbId,
    token,
    permission,
    fetch: fetchImpl,
    name = "knowledge_lookup",
    description = DEFAULT_DESCRIPTION,
    audience = "tool",
    maxChars = 4000,
    topK = 8,
    timeoutMs = 15_000,
    maxPassages = 8,
    maxTotalChars = 8_000,
  } = opts;

  if (!baseUrl) throw new TypeError("trailRetriever: `baseUrl` is required");
  if (!kbId) throw new TypeError("trailRetriever: `kbId` is required — a retriever without one knowledge base has no isolation");
  if (!token) throw new TypeError("trailRetriever: `token` is required");

  const doFetch = fetchImpl ?? globalThis.fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    ...(opts.tenant ? { "x-trail-tenant": opts.tenant } : {}),
  };
  const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/retrieve`;

  return defineTool<Ctx>({
    name,
    description,
    permission,
    mutates: false,
    parameters: {
      type: "object",
      // NOTE what is absent: no `kb`, no `tenant`, no `token`. The model cannot
      // name the knowledge base it wants, so it cannot be talked into another.
      properties: {
        query: {
          type: "string",
          description: "What to look up, in the user's own words.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async run(args): Promise<TrailResult> {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return { status: "empty", freshness: NO_FRESHNESS, note: "No query was given, so nothing was looked up." };
      }

      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ query, audience, maxChars, topK }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // COULD NOT ASK. Not "there is nothing". The reason is a short token,
        // never the thrown message — a model reads text in this field as
        // knowledge, and a stack or a URL here would be both a leak and a lie.
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        return unavailable(timedOut ? "timeout" : "network");
      }

      if (response.status === 401 || response.status === 403) return unavailable("unauthorized");
      if (!response.ok) return unavailable("http_error");

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return unavailable("bad_response");
      }

      const parsed = readTrailBody(body);
      if (!parsed) return unavailable("bad_response");
      if (!parsed.length) {
        return {
          status: "empty",
          freshness: NO_FRESHNESS,
          note: "The knowledge base was searched and contained nothing about this. This is NOT the same as the answer being no — say only that the knowledge base has nothing on it.",
        };
      }

      // OUR ceiling. What it drops is reported, never silently absent.
      const kept: TrailPassage[] = [];
      let chars = 0;
      let reason: "max_passages" | "max_chars" = "max_passages";
      for (const passage of parsed) {
        if (kept.length >= maxPassages) break;
        if (chars + passage.content.length > maxTotalChars) {
          reason = "max_chars";
          break;
        }
        kept.push(passage);
        chars += passage.content.length;
      }

      const dropped = parsed.length - kept.length;
      return {
        status: "hit",
        passages: kept,
        freshness: NO_FRESHNESS,
        ...(dropped > 0 ? { truncated: { droppedPassages: dropped, reason } } : {}),
      };
    },
  });
}

function unavailable(reason: "timeout" | "network" | "unauthorized" | "http_error" | "bad_response"): TrailResult {
  return {
    status: "unavailable",
    reason,
    // The instruction, not an error message. sanne's own prompt merged "nothing
    // found" with "lookup failed" into one branch that told the model to answer
    // from general training knowledge instead — on health questions.
    note: "The knowledge base could NOT BE REACHED, so nothing was checked. Tell the user you could not look it up. Do NOT answer from your own general knowledge, and do NOT treat this as the knowledge base having no answer.",
  };
}

/**
 * Read a measured Trail response.
 *
 * Tolerant on purpose, and in a specific direction: sanne's own declared type
 * had drifted from the live engine (it knew nothing of `images` or `userNote`),
 * so this reads the fields it needs, ignores the rest, and falls back to
 * `formattedContext` when `chunks` is absent rather than reporting an empty
 * knowledge base — which would be the exact confusion this file is about.
 *
 * Returns null only when the body is not a Trail response at all.
 */
function readTrailBody(body: unknown): TrailPassage[] | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  if (Array.isArray(b.chunks)) {
    const passages: TrailPassage[] = [];
    for (const raw of b.chunks) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as Record<string, unknown>;
      const content = typeof c.content === "string" ? c.content : "";
      if (!content) continue;
      passages.push({
        title: typeof c.title === "string" ? c.title : "",
        ...(typeof c.neuronPath === "string" ? { path: c.neuronPath } : {}),
        ...(typeof c.headerBreadcrumb === "string" ? { breadcrumb: c.headerBreadcrumb } : {}),
        content,
      });
    }
    return passages;
  }

  if (typeof b.formattedContext === "string") {
    const text = b.formattedContext.trim();
    return text ? [{ title: "", content: text }] : [];
  }

  // hitCount alone is enough to know it IS a Trail response that found nothing.
  if (typeof b.hitCount === "number") return [];

  return null;
}
