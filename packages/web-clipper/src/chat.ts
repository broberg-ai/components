// @broberg/web-clipper/extract — F099.9. Chat readers for ChatGPT and Claude.
//
// WHY NOT THE DOM. Both sites ship an almost empty page and draw the
// conversation with JavaScript from data they fetch (a saved .html has no
// content), and a long thread keeps only ~8 messages on screen at a time
// (measured by trail 13/10, Lens flow-run 19a890e5). So a reader that copies
// the screen gets the bottom of a long conversation and nothing else.
//
// WHAT WE DO. The content script runs inside the page, signed in as the user,
// and asks the page's OWN backend for the conversation — the same request the
// page makes. That answer holds every turn however long it is. It is a TREE
// (edits and regenerations are branches); we walk from the node the user is
// looking at up to the root, so the clip is the thread on screen, nothing else.
//
// WHEN THAT FAILS. These are not public APIs. A failed request or ANY shape we
// do not recognise falls back to what is on screen, and the clip says
// complete: false with the reason. A clip is complete: true only when the
// whole conversation was read from the data. Never the other way round.
import { htmlToMarkdown, NothingToClipError, type Clip, type Completeness, type Extractor, type Unit } from "./extract";

type Fetch = typeof fetch;
export interface ChatReaderOptions {
  /** Default: the page's fetch (same origin, the user's own login). */
  fetch?: Fetch;
}

/** The data answered, but not in a shape we know — never guess, fall back. */
class ShapeError extends Error {}

interface Turn { role: "user" | "assistant"; text: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Consecutive parts by the same speaker are one turn (an answer split around a tool call). */
function toUnits(turns: Turn[]): Unit[] {
  const merged: Turn[] = [];
  for (const t of turns) {
    const text = t.text.trim();
    if (!text) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.text += `\n\n${text}`;
    else merged.push({ role: t.role, text });
  }
  return merged.map((t, position) => ({ kind: "turn", role: t.role, content: t.text, position }));
}

async function getJson(f: Fetch, url: string, init?: RequestInit): Promise<unknown> {
  const res = await f(url, { credentials: "include", ...init });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

/** Read a clip from the data; on any failure, from the screen — and say which. */
async function dataOrScreen(
  fromData: () => Promise<{ title: string; units: Unit[] }>,
  fromScreen: () => { title: string; units: Unit[] },
  url: URL,
  base: { anchor: string; shareUrl?: string },
): Promise<Clip> {
  try {
    const d = await fromData();
    if (!d.units.length) throw new ShapeError("the conversation data holds no turns");
    return { url: url.href, title: d.title, ...base, units: d.units, completeness: { complete: true, source: "data" } };
  } catch (e) {
    const s = fromScreen();
    if (!s.units.length) throw new NothingToClipError(url.href);
    const reason = `Kun det der er synligt på skærmen blev klippet — samtalen kunne ikke hentes i sin helhed (${e instanceof Error ? e.message : String(e)}).`;
    const completeness: Completeness = { complete: false, source: "dom", reason };
    return { url: url.href, title: s.title, ...base, units: s.units, completeness };
  }
}

// ── ChatGPT ──────────────────────────────────────────────────────────────────

const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
/** /c/<id> or /g/<gpt>/c/<id> → the conversation; /share/<id> → a shared one. */
function chatgptIds(url: URL): { conversation?: string; share?: string } {
  const c = url.pathname.match(/\/c\/([0-9a-f-]{8,})/i);
  if (c) return { conversation: c[1] };
  const s = url.pathname.match(/^\/share\/([0-9a-f-]{8,})/i);
  return s ? { share: s[1] } : {};
}

/** The thread on screen, from ChatGPT's conversation answer. Exported for tests. */
export function chatgptTurns(data: unknown): { title: string; turns: Turn[] } {
  if (!isObj(data) || !isObj(data.mapping) || typeof data.current_node !== "string") throw new ShapeError("unexpected conversation shape");
  const mapping = data.mapping;
  const path: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let id: unknown = data.current_node; typeof id === "string"; ) {
    if (seen.has(id)) throw new ShapeError("the conversation tree has a cycle");
    seen.add(id);
    const node = mapping[id];
    if (!isObj(node)) throw new ShapeError(`node ${id} is missing`);
    path.push(node);
    id = node.parent;
  }
  const turns: Turn[] = [];
  for (const node of path.reverse()) {
    const m = node.message;
    if (!isObj(m)) continue; // the root has no message
    const role = isObj(m.author) ? m.author.role : undefined;
    if (role !== "user" && role !== "assistant") continue; // system, tool, …
    if (isObj(m.metadata) && m.metadata.is_visually_hidden_from_conversation) continue;
    if (role === "assistant" && m.recipient !== undefined && m.recipient !== "all") continue; // a call to a tool, not words to the user
    const content = m.content;
    if (!isObj(content) || (content.content_type !== "text" && content.content_type !== "multimodal_text")) continue; // code runs, search results, thoughts
    if (!Array.isArray(content.parts)) throw new ShapeError("message content has no parts");
    const text = content.parts.filter((p): p is string => typeof p === "string").join("\n\n");
    turns.push({ role, text });
  }
  return { title: typeof data.title === "string" && data.title ? data.title : "ChatGPT", turns };
}

/**
 * F099.9/0.5.1 — React Router's «turbo-stream», the format a server-rendered
 * ChatGPT page embeds its data in: ONE flat JSON array, where every object key
 * and every value is an INDEX into that array ({"_12": 34} = key arr[12], value
 * arr[34]), negative numbers are fixed constants, and an array that starts with
 * a string is a typed value (date, promise, …). Measured 13/10 on a real share
 * page: the whole conversation (150 nodes) is in the first chunk, while the
 * screen shows ~8 messages. Exported for tests.
 */
export function decodeTurboStream(chunk: string): unknown {
  const arr: unknown = JSON.parse(chunk);
  if (!Array.isArray(arr) || !arr.length) throw new ShapeError("not a turbo-stream chunk");
  const SPECIAL: Record<number, unknown> = { [-1]: undefined, [-2]: NaN, [-3]: -Infinity, [-4]: -0, [-5]: null, [-6]: Infinity, [-7]: undefined };
  const memo = new Map<number, unknown>();
  const at = (i: unknown): unknown => {
    if (typeof i !== "number" || !Number.isInteger(i)) throw new ShapeError("turbo-stream reference is not an index");
    if (i < 0) return SPECIAL[i];
    if (memo.has(i)) return memo.get(i);
    if (i >= arr.length) throw new ShapeError("turbo-stream reference out of range");
    const v = arr[i];
    if (v === null || typeof v !== "object") {
      memo.set(i, v);
      return v;
    }
    if (Array.isArray(v)) {
      // A typed value (["D", …] date, ["P", …] promise, …) — nothing a conversation needs.
      if (v.length && typeof v[0] === "string") {
        memo.set(i, undefined);
        return undefined;
      }
      const out: unknown[] = [];
      memo.set(i, out);
      for (const x of v) out.push(at(x));
      return out;
    }
    const out: Record<string, unknown> = {};
    memo.set(i, out);
    for (const [k, x] of Object.entries(v)) {
      const key = at(Number(k.slice(1)));
      if (typeof key !== "string") throw new ShapeError("turbo-stream key is not a string");
      out[key] = at(x);
    }
    return out;
  };
  return at(0);
}

/** The conversation a server-rendered ChatGPT page carries in its own <script> data. */
function chatgptEmbedded(doc: Document): unknown {
  const re = /__reactRouterContext\.streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g;
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    for (const m of (script.textContent ?? "").matchAll(re)) {
      const chunk = JSON.parse(m[1]!) as unknown;
      if (typeof chunk !== "string" || !chunk.startsWith("[")) continue; // promise chunks ("P12:…")
      const root = decodeTurboStream(chunk);
      const loaderData = isObj(root) && isObj(root.loaderData) ? root.loaderData : null;
      for (const route of Object.values(loaderData ?? {})) {
        const data = isObj(route) && isObj(route.serverResponse) ? route.serverResponse.data : undefined;
        if (isObj(data) && isObj(data.mapping) && typeof data.current_node === "string") return data;
      }
    }
  }
  throw new Error("the page carries no conversation data");
}

function chatgptScreen(doc: Document): { title: string; units: Unit[] } {
  const turns: Turn[] = [];
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[data-message-author-role]"))) {
    const role = el.getAttribute("data-message-author-role");
    if (role === "user" || role === "assistant") turns.push({ role, text: htmlToMarkdown(el.innerHTML) });
  }
  return { title: doc.title || "ChatGPT", units: toUnits(turns) };
}

export function createChatgptReader(o: ChatReaderOptions = {}): Extractor {
  return {
    id: "chatgpt",
    matches: (url) => CHATGPT_HOSTS.has(url.hostname) && Object.keys(chatgptIds(url)).length > 0,
    async extract(doc, url) {
      const f = o.fetch ?? fetch.bind(globalThis);
      const ids = chatgptIds(url);
      const anchor = (ids.conversation ?? ids.share)!;
      return dataOrScreen(
        async () => {
          if (!ids.conversation) {
            // A shared link: the whole conversation is in the page itself (no login needed).
            const { title, turns } = chatgptTurns(chatgptEmbedded(doc));
            return { title, units: toUnits(turns) };
          }
          const session = await getJson(f, `${url.origin}/api/auth/session`);
          const token = isObj(session) && typeof session.accessToken === "string" ? session.accessToken : null;
          if (!token) throw new Error("not signed in to ChatGPT");
          const data = await getJson(f, `${url.origin}/backend-api/conversation/${ids.conversation}`, { headers: { authorization: `Bearer ${token}` } });
          const { title, turns } = chatgptTurns(data);
          return { title, units: toUnits(turns) };
        },
        () => chatgptScreen(doc),
        url,
        { anchor, ...(ids.share ? { shareUrl: url.href } : {}) },
      );
    },
  };
}

// ── Claude ───────────────────────────────────────────────────────────────────

function claudeIds(url: URL): { conversation?: string; share?: string } {
  const c = url.pathname.match(/^\/chat\/([0-9a-f-]{8,})/i);
  if (c) return { conversation: c[1] };
  const s = url.pathname.match(/^\/share\/([0-9a-f-]{8,})/i);
  return s ? { share: s[1] } : {};
}

/** The thread on screen, from Claude's conversation answer. Exported for tests. */
export function claudeTurns(data: unknown): { title: string; turns: Turn[] } {
  if (!isObj(data) || !Array.isArray(data.chat_messages)) throw new ShapeError("unexpected conversation shape");
  const byId = new Map<string, Record<string, unknown>>();
  for (const m of data.chat_messages) if (isObj(m) && typeof m.uuid === "string") byId.set(m.uuid, m);
  const leaf = data.current_leaf_message_uuid;
  let path: Record<string, unknown>[];
  if (typeof leaf === "string") {
    path = [];
    const seen = new Set<string>();
    for (let id: unknown = leaf; typeof id === "string" && byId.has(id); ) {
      if (seen.has(id)) throw new ShapeError("the conversation tree has a cycle");
      seen.add(id);
      const m = byId.get(id)!;
      path.push(m);
      id = m.parent_message_uuid;
    }
    path.reverse();
    if (!path.length) throw new ShapeError("the current message is not in the conversation");
  } else {
    // No tree answer: a linear list is the thread only when nothing branches.
    const parents = data.chat_messages.map((m) => (isObj(m) ? m.parent_message_uuid : undefined));
    if (new Set(parents).size !== parents.length) throw new ShapeError("branched conversation without a current leaf");
    path = data.chat_messages.filter(isObj);
  }
  const turns: Turn[] = [];
  for (const m of path) {
    const role = m.sender === "human" ? "user" : m.sender === "assistant" ? "assistant" : null;
    if (!role) continue;
    let text: string;
    if (Array.isArray(m.content)) {
      // Words only: thinking, tool calls and tool results are not the conversation.
      text = m.content.filter((b): b is { type: string; text: string } => isObj(b) && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n\n");
    } else if (typeof m.text === "string") text = m.text;
    else throw new ShapeError("message has neither content nor text");
    turns.push({ role, text });
  }
  return { title: typeof data.name === "string" && data.name ? data.name : "Claude", turns };
}

function claudeScreen(doc: Document): { title: string; units: Unit[] } {
  const turns: Turn[] = [];
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="user-message"], .font-claude-response, .font-claude-message'))) {
    if (el.parentElement?.closest('[data-testid="user-message"], .font-claude-response, .font-claude-message')) continue; // nested match
    turns.push({ role: el.matches('[data-testid="user-message"]') ? "user" : "assistant", text: htmlToMarkdown(el.innerHTML) });
  }
  return { title: doc.title || "Claude", units: toUnits(turns) };
}

/** lastActiveOrg cookie first (the org on screen), then every org the user is in. */
async function claudeOrgs(f: Fetch, doc: Document, origin: string): Promise<string[]> {
  const fromCookie = doc.cookie.match(/(?:^|;\s*)lastActiveOrg=([0-9a-f-]+)/i)?.[1];
  const list = await getJson(f, `${origin}/api/organizations`).catch(() => []);
  const all = Array.isArray(list) ? list.map((o) => (isObj(o) && typeof o.uuid === "string" ? o.uuid : null)).filter((x): x is string => !!x) : [];
  return [...new Set([...(fromCookie ? [fromCookie] : []), ...all])];
}

export function createClaudeReader(o: ChatReaderOptions = {}): Extractor {
  return {
    id: "claude",
    matches: (url) => url.hostname === "claude.ai" && Object.keys(claudeIds(url)).length > 0,
    async extract(doc, url) {
      const f = o.fetch ?? fetch.bind(globalThis);
      const ids = claudeIds(url);
      const anchor = (ids.conversation ?? ids.share)!;
      return dataOrScreen(
        async () => {
          if (!ids.conversation) throw new Error("a shared link is read from the screen");
          const orgs = await claudeOrgs(f, doc, url.origin);
          if (!orgs.length) throw new Error("not signed in to Claude");
          let last: unknown;
          for (const org of orgs) {
            try {
              const data = await getJson(f, `${url.origin}/api/organizations/${org}/chat_conversations/${ids.conversation}?tree=True&rendering_mode=messages&render_all_tools=true`);
              const { title, turns } = claudeTurns(data);
              return { title, units: toUnits(turns) };
            } catch (e) {
              if (e instanceof ShapeError) throw e; // the right org, a shape we do not know — do not try the next
              last = e;
            }
          }
          throw last instanceof Error ? last : new Error("the conversation was not found in any of your organisations");
        },
        () => claudeScreen(doc),
        url,
        { anchor, ...(ids.share ? { shareUrl: url.href } : {}) },
      );
    },
  };
}

export const chatgptReader: Extractor = createChatgptReader();
export const claudeReader: Extractor = createClaudeReader();
/** Both, ready for runContentScript(chatReaders). */
export const chatReaders: readonly Extractor[] = [chatgptReader, claudeReader];
