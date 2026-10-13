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
import { htmlToMarkdown, NothingToClipError, type Asset, type Clip, type Completeness, type Extractor, type Unit } from "./extract";

type Fetch = typeof fetch;
export interface ChatReaderOptions {
  /** Default: the page's fetch (same origin, the user's own login). */
  fetch?: Fetch;
}

/** The data answered, but not in a shape we know — never guess, fall back. */
class ShapeError extends Error {}

interface Turn { role: "user" | "assistant"; text: string; assets?: Asset[]; refs?: FileRef[] }

// ── Files that live behind a link (F099.13) ────────────────────────────────
// A file the conversation SHOWS but does not carry: a Claude file in the
// Artifacts panel, an upload, a ChatGPT image or a code-tool file. The content
// script fetches it with the page's own session — the receiving server never
// has to log in to claude.ai or chatgpt.com — and it travels as a file asset:
// text as text, anything else as base64. A file that cannot be fetched (or is
// too big to carry) is named in the reason and the clip says missing:"files".

/** A file to fetch. `indirect`: the url answers JSON { download_url } and the file is there (ChatGPT). */
interface FileRef { id: string; name: string; mime?: string; url: string; indirect?: boolean; headers?: Record<string, string> }

/** Per file, and for the whole clip — a clip crosses chrome.runtime as one message. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_CLIP_FILE_BYTES = 60 * 1024 * 1024;
const TEXT_MIME = /^text\/|[+/](json|xml|javascript)$|^image\/svg\+xml$/;
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function download(f: Fetch, ref: FileRef, budget: number): Promise<Asset> {
  let res = await f(ref.url, { credentials: "include", ...(ref.headers ? { headers: ref.headers } : {}) });
  if (!res.ok) throw new Error(`«${ref.name}» kunne ikke hentes (${res.status})`);
  if (ref.indirect) {
    const j: unknown = await res.json();
    const to = isObj(j) && typeof j.download_url === "string" ? j.download_url : undefined;
    if (!to) throw new Error(`«${ref.name}» gav ingen download-adresse`);
    res = await f(to, { credentials: "omit" });
    if (!res.ok) throw new Error(`«${ref.name}» kunne ikke hentes (${res.status})`);
  }
  const limit = Math.min(MAX_FILE_BYTES, budget);
  const declared = Number(res.headers.get("content-length"));
  if (declared > limit) throw new Error(`«${ref.name}» er ${mb(declared)} — over grænsen på ${mb(limit)}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > limit) throw new Error(`«${ref.name}» er ${mb(bytes.length)} — over grænsen på ${mb(limit)}`);
  const mime = ref.mime ?? res.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
  const body = TEXT_MIME.test(mime) ? { content: new TextDecoder().decode(bytes) } : { encoding: "base64" as const, content: toBase64(bytes) };
  return { type: "file", id: ref.id, name: ref.name, mime, size: bytes.length, ...body };
}

/** Fetch every turn's refs into assets, one at a time; returns what could not be fetched. */
async function fetchRefs(f: Fetch, turns: Turn[]): Promise<string[]> {
  const problems: string[] = [];
  let budget = MAX_CLIP_FILE_BYTES;
  for (const t of turns) {
    for (const ref of t.refs ?? []) {
      try {
        const a = await download(f, ref, budget);
        budget -= a.size ?? 0;
        t.assets = [...(t.assets ?? []), a];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // A network refusal (CORS, offline) says only «Failed to fetch» — name the file it was.
        problems.push(msg.includes(`«${ref.name}»`) ? msg : `«${ref.name}» kunne ikke hentes (${msg})`);
      }
    }
    delete t.refs;
  }
  return problems;
}

/** A file presented more than once (a newer version each time) is fetched once, on its LAST turn — the download is the current file. */
function lastRefOnly(turns: Turn[]): void {
  const seen = new Set<string>();
  for (let i = turns.length - 1; i >= 0; i--) {
    const refs = turns[i]!.refs;
    if (!refs) continue;
    turns[i]!.refs = refs.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  }
}

/** The completeness note for a data read: words not understood outrank a missing file. */
function incompleteFrom(skipped: string[], filesSkipped: string[]): { reason: string; missing: "files" | "turns" } | undefined {
  const all = [...skipped, ...filesSkipped];
  if (!all.length) return undefined;
  return {
    reason: `${all.length} ${all.length === 1 ? "del" : "dele"} af samtalen kunne ikke læses: ${[...new Set(all)].slice(0, 3).join("; ")}`,
    missing: skipped.length ? "turns" : "files",
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Consecutive parts by the same speaker are one turn (an answer split around a tool call). */
function toUnits(turns: Turn[]): Unit[] {
  const merged: Turn[] = [];
  for (const t of turns) {
    const text = t.text.trim();
    if (!text) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) {
      last.text += `\n\n${text}`;
      if (t.assets?.length) last.assets = [...(last.assets ?? []), ...t.assets];
    } else merged.push({ role: t.role, text, ...(t.assets?.length ? { assets: [...t.assets] } : {}) });
  }
  return merged.map((t, position) => ({ kind: "turn", role: t.role, content: t.text, position, ...(t.assets ? { assets: t.assets } : {}) }));
}

async function getJson(f: Fetch, url: string, init?: RequestInit): Promise<unknown> {
  const res = await f(url, { credentials: "include", ...init });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

/** Read a clip from the data; on any failure, from the screen — and say which. */
async function dataOrScreen(
  fromData: () => Promise<{ title: string; units: Unit[]; incomplete?: { reason: string; missing: "files" | "turns" } }>,
  fromScreen: () => { title: string; units: Unit[] },
  url: URL,
  base: { anchor: string; shareUrl?: string },
): Promise<Clip> {
  try {
    const d = await fromData();
    if (!d.units.length) throw new ShapeError("the conversation data holds no turns");
    // Read from the data, but something in it was not understood: still the whole thread, not the whole content.
    const completeness: Completeness = d.incomplete ? { complete: false, source: "data", reason: d.incomplete.reason, missing: d.incomplete.missing } : { complete: true, source: "data" };
    return { url: url.href, title: d.title, ...base, units: d.units, completeness };
  } catch (e) {
    const s = fromScreen();
    if (!s.units.length) throw new NothingToClipError(url.href);
    const reason = `Kun det der er synligt på skærmen blev klippet — samtalen kunne ikke hentes i sin helhed (${e instanceof Error ? e.message : String(e)}).`;
    const completeness: Completeness = { complete: false, source: "dom", reason, missing: "turns" };
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

/** Where a ChatGPT file is fetched from — absent on a shared link (no login, nothing to fetch with). */
export interface ChatgptLinks {
  /** An image / upload: GET …/backend-api/files/download/<file id> → { download_url }. */
  file(fileId: string): FileRef["url"];
  /** A code-tool file: GET …/interpreter/download?message_id=…&sandbox_path=… → { download_url }. */
  interpreter(messageId: string, sandboxPath: string): FileRef["url"];
  headers: Record<string, string>;
}

const EXT_OF: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** The thread on screen, from ChatGPT's conversation answer. Exported for tests. */
export function chatgptTurns(data: unknown, links?: ChatgptLinks): { title: string; turns: Turn[]; filesSkipped: string[] } {
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
  const filesSkipped: string[] = [];
  const ref = (r: Omit<FileRef, "url" | "indirect" | "headers">, url: (l: ChatgptLinks) => string): FileRef | undefined => {
    if (links) return { ...r, url: url(links), indirect: true, headers: links.headers };
    filesSkipped.push(`«${r.name}» kan ikke hentes fra et delt link`);
    return undefined;
  };
  for (const node of path.reverse()) {
    const m = node.message;
    if (!isObj(m)) continue; // the root has no message
    const role = isObj(m.author) ? m.author.role : undefined;
    if (isObj(m.metadata) && m.metadata.is_visually_hidden_from_conversation) continue;
    const content = m.content;
    // F099.13 — an image is a part of its own (image_asset_pointer): a generated one sits on the image
    // TOOL's message (measured 13/10, jam: author "tool:…", multimodal_text), an upload on the user's.
    const images: FileRef[] = [];
    const marks: string[] = [];
    if (isObj(content) && content.content_type === "multimodal_text" && Array.isArray(content.parts)) {
      for (const p of content.parts) {
        if (!isObj(p) || p.content_type !== "image_asset_pointer" || typeof p.asset_pointer !== "string") continue;
        const fileId = p.asset_pointer.replace(/^[a-z-]+:\/\//i, "");
        const md = isObj(p.metadata) ? p.metadata : {};
        const gen = isObj(md.generation) ? md.generation : isObj(md.dalle) ? md.dalle : {};
        const mime = str(p.mime_type);
        const title = str(gen.serialization_title) ?? (isObj(m.metadata) ? str(m.metadata.image_gen_title) : undefined) ?? fileId;
        const name = /\.[a-z0-9]{2,5}$/i.test(title) ? title : `${title}.${EXT_OF[mime ?? ""] ?? "png"}`;
        marks.push(`[Billede: ${name}]`);
        const r = ref({ id: fileId, name, ...(mime ? { mime } : {}) }, (l) => l.file(fileId));
        if (r) images.push(r);
      }
    }
    if (role !== "user" && role !== "assistant") {
      // system / tool: not words — but a tool's image belongs to the answer it is part of.
      if (images.length) turns.push({ role: "assistant", text: marks.join("\n\n"), refs: images });
      continue;
    }
    if (role === "assistant" && m.recipient !== undefined && m.recipient !== "all") continue; // a call to a tool, not words to the user
    if (!isObj(content) || (content.content_type !== "text" && content.content_type !== "multimodal_text")) continue; // code runs, search results, thoughts
    if (!Array.isArray(content.parts)) throw new ShapeError("message content has no parts");
    const text = content.parts.filter((p): p is string => typeof p === "string").join("\n\n");
    // A code-tool file is a markdown link to sandbox:/mnt/data/… in the answer.
    const refs = [...images];
    if (role === "assistant") {
      for (const [, sandboxPath] of text.matchAll(/\(sandbox:(\/mnt\/data\/[^)\s]+)\)/g)) {
        const name = decodeURIComponent(sandboxPath!.split("/").pop()!);
        const r = typeof m.id === "string" ? ref({ id: sandboxPath!, name }, (l) => l.interpreter(m.id as string, sandboxPath!)) : undefined;
        if (r && !refs.some((x) => x.id === r.id)) refs.push(r);
      }
    }
    turns.push({ role, text: [...marks, text].filter(Boolean).join("\n\n"), ...(refs.length ? { refs } : {}) });
  }
  return { title: typeof data.title === "string" && data.title ? data.title : "ChatGPT", turns, filesSkipped };
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

/** The conversation a server-rendered ChatGPT page carries in its <script> data — from the live page's scripts or a fetched copy's HTML. */
function chatgptEmbedded(sources: string[]): unknown {
  const re = /__reactRouterContext\.streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g;
  for (const text of sources) {
    for (const m of text.matchAll(re)) {
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
            let data: unknown;
            try {
              data = chatgptEmbedded(Array.from(doc.querySelectorAll("script"), (x) => x.textContent ?? ""));
            } catch (inPage) {
              if (inPage instanceof ShapeError) throw inPage;
              // Not in this page's scripts (a signed-in view can be drawn in the browser instead):
              // the signed-OUT copy of the same link is server-rendered with the data — measured 13/10.
              const res = await f(url.href, { credentials: "omit", headers: { accept: "text/html" } });
              if (!res.ok) throw new Error(`the shared page answered ${res.status}`);
              data = chatgptEmbedded([await res.text()]);
            }
            const { title, turns, filesSkipped } = chatgptTurns(data);
            const incomplete = incompleteFrom([], filesSkipped);
            return { title, units: toUnits(turns), ...(incomplete ? { incomplete } : {}) };
          }
          const session = await getJson(f, `${url.origin}/api/auth/session`);
          const token = isObj(session) && typeof session.accessToken === "string" ? session.accessToken : null;
          if (!token) throw new Error("not signed in to ChatGPT");
          const headers = { authorization: `Bearer ${token}` };
          const data = await getJson(f, `${url.origin}/backend-api/conversation/${ids.conversation}`, { headers });
          const conv = ids.conversation;
          const { title, turns, filesSkipped } = chatgptTurns(data, {
            file: (id) => `${url.origin}/backend-api/files/download/${encodeURIComponent(id)}`,
            interpreter: (messageId, sandboxPath) =>
              `${url.origin}/backend-api/conversation/${conv}/interpreter/download?message_id=${encodeURIComponent(messageId)}&sandbox_path=${encodeURIComponent(sandboxPath)}`,
            headers,
          });
          lastRefOnly(turns);
          const incomplete = incompleteFrom([], [...filesSkipped, ...(await fetchRefs(f, turns))]);
          return { title, units: toUnits(turns), ...(incomplete ? { incomplete } : {}) };
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

// ── Claude artifacts (F099.10) ─────────────────────────────────────────────
// An artifact is not text in the message: it is a tool call (claude.ai's
// "artifacts" tool: create / rewrite / update, or the newer file tools
// create_file / str_replace). Each becomes a FILE on its turn, holding the
// artifact AS OF that turn, and the turn's text gets a short reference so the
// fingerprint is stable and a turn that is only an artifact is not dropped.

/** Content blocks that are known and deliberately not part of the conversation's words. */
const CLAUDE_SKIP = new Set(["thinking", "redacted_thinking", "tool_result", "server_tool_use", "web_search_tool_result", "web_fetch_tool_result", "token_budget"]);
const EXT_MIME: Record<string, string> = { md: "text/markdown", markdown: "text/markdown", html: "text/html", htm: "text/html", svg: "image/svg+xml", json: "application/json", csv: "text/csv", txt: "text/plain", tsx: "text/tsx", jsx: "text/jsx", ts: "text/typescript", js: "text/javascript", py: "text/x-python", mermaid: "text/vnd.mermaid" };
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

interface ArtifactState { title: string; mime?: string; language?: string; content: string; version: number }

/** Apply one artifact tool call; returns the asset for this turn, or a problem to report. */
function artifactOp(name: string, input: Record<string, unknown>, files: Map<string, ArtifactState>): { asset?: Asset; title?: string; problem?: string; ignore?: true } {
  const emit = (id: string, st: ArtifactState): { asset: Asset; title: string } => ({
    title: st.title,
    asset: { type: "file", id, name: st.title, ...(st.mime ? { mime: st.mime } : {}), ...(st.language ? { language: st.language } : {}), content: st.content, version: st.version },
  });
  if (name === "artifacts") {
    const id = str(input.id);
    const command = str(input.command) ?? "create";
    if (!id) return { problem: "an artifact without an id" };
    const prev = files.get(id);
    if (command === "create" || command === "rewrite") {
      const content = str(input.content);
      if (content === undefined) return { problem: `artifact «${str(input.title) ?? id}» has no content` };
      const st: ArtifactState = { title: str(input.title) ?? prev?.title ?? id, mime: str(input.type) ?? prev?.mime, language: str(input.language) ?? prev?.language, content, version: (prev?.version ?? 0) + 1 };
      files.set(id, st);
      return emit(id, st);
    }
    if (command === "update") {
      const oldStr = str(input.old_str), newStr = str(input.new_str);
      if (!prev || oldStr === undefined || newStr === undefined || !prev.content.includes(oldStr)) return { problem: `a change to artifact «${prev?.title ?? id}» could not be applied` };
      const st: ArtifactState = { ...prev, content: prev.content.replace(oldStr, () => newStr), version: prev.version + 1 };
      files.set(id, st);
      return emit(id, st);
    }
    return { problem: `unknown artifact command «${command}»` };
  }
  if (name === "create_file") {
    const path = str(input.path), content = str(input.file_text) ?? str(input.content);
    if (!path || content === undefined) return { problem: "a created file without path or content" };
    const base = path.split("/").pop() ?? path;
    const prev = files.get(path);
    const st: ArtifactState = { title: base, mime: EXT_MIME[base.split(".").pop()?.toLowerCase() ?? ""] ?? "text/plain", content, version: (prev?.version ?? 0) + 1 };
    files.set(path, st);
    return emit(path, st);
  }
  if (name === "str_replace" || name === "str_replace_based_edit_tool") {
    const path = str(input.path);
    const prev = path ? files.get(path) : undefined;
    const oldStr = str(input.old_str), newStr = str(input.new_str) ?? "";
    if (!path || !prev || oldStr === undefined || !prev.content.includes(oldStr)) return { problem: `a change to file «${path ?? "?"}» could not be applied` };
    const st: ArtifactState = { ...prev, content: prev.content.replace(oldStr, () => newStr), version: prev.version + 1 };
    files.set(path, st);
    return emit(path, st);
  }
  // An MCP tool ("DNS Manager:simply_check") acts outside the conversation; its result is not a file in it.
  if (CLAUDE_TOOLS_NO_FILES.has(name) || name.includes(":")) return { ignore: true }; // reads, searches, or runs — never a file the conversation holds
  // F099.13: any other tool may have made files (a code tool that writes DESIGN.md or renders a PNG —
  // jam 13/10: «KAI», 3 of 28 files, and the clip said complete). Unknown is never read as nothing.
  return { problem: `a tool «${name}» that may have made files the clip does not hold` };
}

/** Tools that only read or search — they never make a file, so skipping them loses nothing. Everything else is reported. */
// Measured on «KAI» 13/10 (jam's shape extract): the code tool (bash_tool) writes files, but what the
// person SEES is what present_files hands over — read from its tool_result below. A file the code tool
// wrote and never presented is not in the Artifacts panel either.
const CLAUDE_TOOLS_NO_FILES = new Set(["web_search", "web_fetch", "conversation_search", "recent_chats", "google_drive_search", "google_drive_fetch", "view", "bash_tool", "present_files", "tool_search", "memory_read", "Artifact"]);

/** Where a Claude file is fetched from. */
export interface ClaudeLinks {
  /** A file in the Artifacts panel (present_files): …/conversations/<id>/wiggle/download-file?path=… */
  output(path: string): string;
  /** An upload's preview, from files[].preview_url (relative to the origin). */
  upload(relative: string): string;
}

/** The thread on screen, from Claude's conversation answer. Exported for tests. */
/** `skipped`: parts that may hold words (the turns are not whole). `filesSkipped`: the turns are whole, a file is not (F099.13). */
export function claudeTurns(data: unknown, links?: ClaudeLinks): { title: string; turns: Turn[]; skipped: string[]; filesSkipped: string[] } {
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
  const skipped: string[] = [];
  const filesSkipped: string[] = [];
  const files = new Map<string, ArtifactState>();
  for (const m of path) {
    const role = m.sender === "human" ? "user" : m.sender === "assistant" ? "assistant" : null;
    if (!role) continue;
    if (!Array.isArray(m.content)) {
      if (typeof m.text !== "string") throw new ShapeError("message has neither content nor text");
      turns.push({ role, text: m.text });
      continue;
    }
    const parts: string[] = [];
    const assets: Asset[] = [];
    // Files the person attached: the text claude.ai extracted from them comes along as a file;
    // an image or other upload is named. Without this, a message that was only a file vanished
    // and its neighbours were merged into one turn (jam 13/10: «KAI», 74 of 79).
    for (const a of Array.isArray(m.attachments) ? m.attachments : []) {
      if (!isObj(a)) continue;
      const name = str(a.file_name) ?? "bilag";
      const content = str(a.extracted_content);
      parts.push(`[Bilag: ${name}]`);
      if (content !== undefined) assets.push({ type: "file", name, ...(str(a.file_type) ? { mime: str(a.file_type)! } : {}), content });
    }
    const refs: FileRef[] = [];
    const uploads = [...(Array.isArray(m.files_v2) ? m.files_v2 : Array.isArray(m.files) ? m.files : [])];
    for (const f of uploads) {
      if (!isObj(f)) continue;
      const name = str(f.file_name) ?? "fil";
      parts.push(`[Fil: ${name}]`);
      // F099.13 — the upload itself (measured: files[] = { file_uuid, file_name, preview_url, preview_asset{url} }).
      const rel = (isObj(f.preview_asset) ? str(f.preview_asset.url) : undefined) ?? str(f.preview_url);
      const id = str(f.file_uuid) ?? str(f.uuid) ?? name;
      if (rel && links) refs.push({ id, name, url: links.upload(rel) });
      else filesSkipped.push(`uploadet «${name}» har ingen adresse at hente fra`);
    }
    for (const b of m.content) {
      if (!isObj(b)) continue;
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
      else if (b.type === "tool_use" && typeof b.name === "string") {
        const r = artifactOp(b.name, isObj(b.input) ? b.input : {}, files);
        if (r.asset) {
          assets.push(r.asset);
          parts.push(`[Artefakt: ${r.title}]`);
        } else if (r.problem) filesSkipped.push(r.problem);
      } else if (b.type === "tool_result" && b.name === "present_files" && b.is_error !== true) {
        // F099.13 — what is in the Artifacts panel: present_files hands files over (measured on «KAI»:
        // content[] = { type, file_path, mime_type, name }). Named in the turn; fetched below.
        for (const item of Array.isArray(b.content) ? b.content : []) {
          if (!isObj(item) || typeof item.file_path !== "string") continue;
          const name = str(item.name) ?? item.file_path.split("/").pop()!;
          parts.push(`[Fil: ${name}]`);
          if (links) refs.push({ id: item.file_path, name, ...(str(item.mime_type) ? { mime: str(item.mime_type)! } : {}), url: links.output(item.file_path) });
        }
      } else if (typeof b.type === "string" && CLAUDE_SKIP.has(b.type)) continue;
      else skipped.push(`a message part of type «${String(b.type)}»`);
    }
    turns.push({ role, text: parts.join("\n\n"), ...(assets.length ? { assets } : {}), ...(refs.length ? { refs } : {}) });
  }
  return { title: typeof data.name === "string" && data.name ? data.name : "Claude", turns, skipped, filesSkipped };
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
              const base = `${url.origin}/api/organizations/${org}/conversations/${ids.conversation}`;
              const { title, turns, skipped, filesSkipped } = claudeTurns(data, {
                output: (path) => `${base}/wiggle/download-file?path=${encodeURIComponent(path)}`,
                upload: (rel) => new URL(rel, url.origin).href,
              });
              lastRefOnly(turns);
              const incomplete = incompleteFrom(skipped, [...filesSkipped, ...(await fetchRefs(f, turns))]);
              return { title, units: toUnits(turns), ...(incomplete ? { incomplete } : {}) };
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
