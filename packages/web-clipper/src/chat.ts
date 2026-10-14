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
// looking at up to the root — that is the clip's main line — and every other
// leaf becomes a line of its own in clip.branches (F099.21, owner 14/10).
//
// WHEN THAT FAILS. These are not public APIs. A failed request or ANY shape we
// do not recognise falls back to what is on screen, and the clip says
// complete: false with the reason. A clip is complete: true only when the
// whole conversation was read from the data. Never the other way round.
import { holdStream } from "./streams";
import { htmlToMarkdown, NothingToClipError, type MissingFile, type Asset, type Clip, type Completeness, type Extractor, type Unit } from "./extract";

type Fetch = typeof fetch;
export interface ChatReaderOptions {
  /** Default: the page's fetch (same origin, the user's own login). */
  fetch?: Fetch;
  /** Per-file cap in bytes (default MAX_FILE_BYTES). */
  maxFileBytes?: number;
  /** Cap for all files in one clip (default MAX_CLIP_FILE_BYTES). */
  maxClipFileBytes?: number;
  /**
   * F099.20 — files bigger than this many bytes are NOT put in the clip: they come as
   * `{ transfer: "stream", streamRef, size }` and you stream them to storage with `streamAsset`.
   * Off by default (everything up to maxFileBytes rides in the clip). Jam sets 25 MB.
   */
  streamOverBytes?: number;
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
// 0.8.3 (owner 13/10: «for stort accepterer jeg ikke som årsag»): a file bigger than one extension
// message now travels in parts (content.ts/extension.ts), so the caps are memory caps, not message caps.
// Files beyond these are for streaming straight to storage (next step), not for the clip.
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_CLIP_FILE_BYTES = 300 * 1024 * 1024;
const TEXT_MIME = /^text\/|[+/](json|xml|javascript)$|^image\/svg\+xml$/;
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A file problem: the words for a person, the data for a client. */
interface FileIssue { text: string; file: MissingFile }
class FileProblem extends Error {
  constructor(text: string, readonly file: MissingFile) { super(text); }
}

async function download(f: Fetch, ref: FileRef, budget: number, maxFile: number, streamOver?: number): Promise<Asset> {
  let lastInit: RequestInit = { credentials: "include", ...(ref.headers ? { headers: ref.headers } : {}) };
  let lastUrl = ref.url;
  let res = await f(ref.url, { credentials: "include", ...(ref.headers ? { headers: ref.headers } : {}) });
  if (!res.ok) throw new FileProblem(`«${ref.name}» kunne ikke hentes (${res.status})`, { name: ref.name, why: "http", status: res.status });
  if (ref.indirect) {
    const j: unknown = await res.json();
    const to = isObj(j) && typeof j.download_url === "string" ? j.download_url : undefined;
    if (!to) throw new FileProblem(`«${ref.name}» gav ingen download-adresse`, { name: ref.name, why: "no_download_url" });
    // jam 13/10, 0.8.0: BOTH ChatGPT files answered 403 — the download address is ChatGPT's own
    // /backend-api/estuary/content, which needs the same login as the first call. Same origin →
    // send the session; another host (a signed CDN URL) → send nothing.
    const target = new URL(to, ref.url);
    const same = target.origin === new URL(ref.url).origin;
    lastInit = same ? { credentials: "include", ...(ref.headers ? { headers: ref.headers } : {}) } : { credentials: "omit" };
    lastUrl = target.href;
    res = await f(target.href, lastInit);
    if (!res.ok) throw new FileProblem(`«${ref.name}» kunne ikke hentes (${res.status} fra download-adressen)`, { name: ref.name, why: "http", status: res.status });
  }
  const limit = Math.min(maxFile, budget);
  const tooBig = (n: number) =>
    new FileProblem(`«${ref.name}» er ${mb(n)} — over grænsen på ${mb(limit)}`, { name: ref.name, why: n > maxFile ? "too_large" : "clip_limit" });
  const declared = Number(res.headers.get("content-length"));
  if (streamOver !== undefined && declared > streamOver) {
    // Too big for the clip: leave the bytes in the page and hand out a handle to stream them.
    await res.body?.cancel().catch(() => undefined);
    const served = res.headers.get("content-type")?.split(";")[0]?.trim();
    const mime = ref.mime ?? (served && served !== "application/octet-stream" ? served : undefined) ?? EXT_MIME[ref.name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
    const streamRef = holdStream({ name: ref.name, url: lastUrl, init: lastInit, size: declared, fetch: f });
    return { type: "file", id: ref.id, name: ref.name, mime, size: declared, transfer: "stream", streamRef };
  }
  if (declared > limit) throw tooBig(declared);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > limit) throw tooBig(bytes.length);
  const served = res.headers.get("content-type")?.split(";")[0]?.trim();
  const byExt = EXT_MIME[ref.name.split(".").pop()?.toLowerCase() ?? ""];
  const mime = ref.mime ?? (served && served !== "application/octet-stream" ? served : undefined) ?? byExt ?? "application/octet-stream";
  const body = TEXT_MIME.test(mime) ? { content: new TextDecoder().decode(bytes) } : { encoding: "base64" as const, content: toBase64(bytes) };
  return { type: "file", id: ref.id, name: ref.name, mime, size: bytes.length, ...body };
}

/** Fetch every turn's refs into assets, one at a time; returns what could not be fetched. */
async function fetchRefs(f: Fetch, turns: Turn[], o: ChatReaderOptions = {}): Promise<FileIssue[]> {
  const problems: FileIssue[] = [];
  const maxFile = o.maxFileBytes ?? MAX_FILE_BYTES;
  let budget = o.maxClipFileBytes ?? MAX_CLIP_FILE_BYTES;
  for (const t of turns) {
    for (const ref of t.refs ?? []) {
      try {
        const a = await download(f, ref, budget, maxFile, o.streamOverBytes);
        if (a.transfer !== "stream") budget -= a.size ?? 0;
        t.assets = [...(t.assets ?? []), a];
      } catch (e) {
        if (e instanceof FileProblem) problems.push({ text: e.message, file: e.file });
        // A network refusal (CORS, offline) says only «Failed to fetch» — name the file it was.
        else problems.push({ text: `«${ref.name}» kunne ikke hentes (${e instanceof Error ? e.message : String(e)})`, file: { name: ref.name, why: "network" } });
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
interface Incomplete { reason: string; missing: "files" | "turns"; problems: string[]; missingFiles?: MissingFile[] }
function incompleteFrom(skipped: string[], files: FileIssue[]): Incomplete | undefined {
  // jam 13/10: «2 talt, 1 navngivet» — every problem is named, none is cut to the first three.
  const problems = [...new Set([...skipped, ...files.map((x) => x.text)])];
  if (!problems.length) return undefined;
  const seen = new Set<string>();
  const missingFiles = files.map((x) => x.file).filter((m) => (seen.has(`${m.why}:${m.name}`) ? false : (seen.add(`${m.why}:${m.name}`), true)));
  return {
    reason: `${problems.length} ${problems.length === 1 ? "del" : "dele"} af samtalen kunne ikke læses: ${problems.join("; ")}`,
    missing: skipped.length ? "turns" : "files",
    problems,
    ...(missingFiles.length ? { missingFiles } : {}),
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

// ── Branches (F099.21) ───────────────────────────────────────────────────────
// Owner 14/10: «Tag alle grene med». A conversation is a tree (an edit, a «try again»): the thread on
// screen is the main line, and every other leaf ends a line of its own, root → leaf. Measured by jam
// on 0.8.3: KAI kept 51 turns of 77 messages (25 on an older branch), «Cardmem» 148 of 154 — and
// both said «all turns saved».

/** The messages root → leaf. */
function lineTo<N>(byId: Map<string, N>, parentOf: (n: N) => unknown, leaf: string): N[] {
  const out: N[] = [];
  const seen = new Set<string>();
  for (let id: unknown = leaf; typeof id === "string" && byId.has(id); ) {
    if (seen.has(id)) throw new ShapeError("the conversation tree has a cycle");
    seen.add(id);
    const n = byId.get(id)!;
    out.push(n);
    id = parentOf(n);
  }
  return out.reverse();
}

/** Every leaf except `main`, oldest first. */
function otherLeaves<N>(byId: Map<string, N>, parentOf: (n: N) => unknown, order: (n: N) => number, main: string): string[] {
  const parents = new Set([...byId.values()].map(parentOf));
  return [...byId.keys()].filter((id) => id !== main && !parents.has(id)).sort((a, b) => order(byId.get(a)!) - order(byId.get(b)!));
}

/**
 * Reads each message ONCE however many lines it is on, so a shared stretch is the same Turn objects
 * (one fetch per file) and units in it fingerprint the same. `state` is what a line carries forward
 * (Claude's artifact versions): a message is read with the state of ITS OWN ancestors.
 */
function lineReader<N, S>(read: (n: N, state: S) => Turn | undefined, fresh: () => S, copy: (s: S) => S): (line: N[]) => Turn[] {
  const memo = new Map<N, { turn?: Turn; after: S }>();
  return (line) => {
    let state = fresh();
    const out: Turn[] = [];
    for (const n of line) {
      let hit = memo.get(n);
      if (hit) state = copy(hit.after);
      else {
        const turn = read(n, state);
        hit = { ...(turn ? { turn } : {}), after: copy(state) };
        memo.set(n, hit);
      }
      if (hit.turn) out.push(hit.turn);
    }
    return out;
  };
}

/** Every turn once, side lines first and the main line last — lastRefOnly then fetches a file shown on both on the main line. */
function uniqueTurns(main: Turn[], lines: Turn[][]): Turn[] {
  const onMain = new Set(main);
  return [...new Set(lines.flat())].filter((t) => !onMain.has(t)).concat(main);
}

/**
 * The side lines as units, minus a line that adds nothing the lines before it hold (a failed answer
 * that was retried leaves an empty leaf). "Holds" = the same unit at the same place after the same
 * prefix — what an equal chain fingerprint means — tracked as a trie of prefixes, without importing
 * ./core: the content script must not share a module with the popup (jam #3274, 0.10.0 failed to build).
 */
function branchUnits(main: Unit[], lines: Turn[][]): Unit[][] {
  const trie = new Map<string, number>();
  const walk = (units: Unit[], add: boolean): boolean => {
    let node = 0;
    let fresh = false;
    for (const u of units) {
      const key = `${node}\u0000${JSON.stringify([u.kind, u.role ?? "", u.position, u.content])}`;
      let next = trie.get(key);
      if (next === undefined) {
        fresh = true;
        if (!add) return true;
        next = trie.size + 1;
        trie.set(key, next);
      }
      node = next;
    }
    return fresh;
  };
  walk(main, true);
  const out: Unit[][] = [];
  for (const line of lines) {
    const units = toUnits(line);
    if (!walk(units, false)) continue;
    walk(units, true);
    out.push(units);
  }
  return out;
}

async function getJson(f: Fetch, url: string, init?: RequestInit): Promise<unknown> {
  const res = await f(url, { credentials: "include", ...init });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

/** Read a clip from the data; on any failure, from the screen — and say which. */
async function dataOrScreen(
  fromData: () => Promise<{ title: string; units: Unit[]; branches?: Unit[][]; incomplete?: Incomplete }>,
  fromScreen: () => { title: string; units: Unit[] },
  url: URL,
  base: { anchor: string; shareUrl?: string },
): Promise<Clip> {
  try {
    const d = await fromData();
    if (!d.units.length) throw new ShapeError("the conversation data holds no turns");
    // Read from the data, but something in it was not understood: still the whole thread, not the whole content.
    const completeness: Completeness = d.incomplete ? { complete: false, source: "data", ...d.incomplete } : { complete: true, source: "data" };
    return { url: url.href, title: d.title, ...base, units: d.units, ...(d.branches?.length ? { branches: d.branches } : {}), completeness };
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
export function chatgptTurns(data: unknown, links?: ChatgptLinks): { title: string; turns: Turn[]; branches: Turn[][]; filesSkipped: FileIssue[] } {
  if (!isObj(data) || !isObj(data.mapping) || typeof data.current_node !== "string") throw new ShapeError("unexpected conversation shape");
  const mapping = data.mapping;
  const byId = new Map<string, Record<string, unknown>>();
  for (const [id, node] of Object.entries(mapping)) if (isObj(node)) byId.set(id, node);
  const parentOf = (n: Record<string, unknown>) => n.parent;
  const order = (n: Record<string, unknown>) => (isObj(n.message) && typeof n.message.create_time === "number" ? n.message.create_time : 0);
  const path = lineTo(byId, parentOf, data.current_node);
  // A parent the mapping does not hold is a broken tree, not the root — never clip half a thread.
  const missing = path.length ? path[0]!.parent : data.current_node;
  if (typeof missing === "string") throw new ShapeError(`node ${missing} is missing`);
  const filesSkipped: FileIssue[] = [];
  const ref = (r: Omit<FileRef, "url" | "indirect" | "headers">, url: (l: ChatgptLinks) => string): FileRef | undefined => {
    if (links) return { ...r, url: url(links), indirect: true, headers: links.headers };
    filesSkipped.push({ text: `«${r.name}» kan ikke hentes fra et delt link`, file: { name: r.name, why: "no_url" } });
    return undefined;
  };
  const read = (node: Record<string, unknown>): Turn | undefined => {
    const m = node.message;
    if (!isObj(m)) return undefined; // the root has no message
    const role = isObj(m.author) ? m.author.role : undefined;
    if (isObj(m.metadata) && m.metadata.is_visually_hidden_from_conversation) return undefined;
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
        // image_gen_title is the image's own title; serialization_title is a generic label
        // («Image Generation metadata» — jam 13/10), never a name.
        const title = (isObj(m.metadata) ? str(m.metadata.image_gen_title) : undefined) ?? fileId;
        const name = /\.[a-z0-9]{2,5}$/i.test(title) ? title : `${title}.${EXT_OF[mime ?? ""] ?? "png"}`;
        marks.push(`[Billede: ${name}]`);
        const r = ref({ id: fileId, name, ...(mime ? { mime } : {}) }, (l) => l.file(fileId));
        if (r) images.push(r);
      }
    }
    if (role !== "user" && role !== "assistant") {
      // system / tool: not words — but a tool's image belongs to the answer it is part of.
      return images.length ? { role: "assistant", text: marks.join("\n\n"), refs: images } : undefined;
    }
    if (role === "assistant" && m.recipient !== undefined && m.recipient !== "all") return undefined; // a call to a tool, not words to the user
    if (!isObj(content) || (content.content_type !== "text" && content.content_type !== "multimodal_text")) return undefined; // code runs, search results, thoughts
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
    return { role, text: [...marks, text].filter(Boolean).join("\n\n"), ...(refs.length ? { refs } : {}) };
  };
  const readLine = lineReader(read, () => undefined, () => undefined);
  const turns = readLine(path);
  // F099.21 — every other line of the tree (an edited prompt, a regenerated answer), each read once.
  const branches = otherLeaves(byId, parentOf, order, data.current_node).map((id) => readLine(lineTo(byId, parentOf, id)));
  return { title: typeof data.title === "string" && data.title ? data.title : "ChatGPT", turns, branches, filesSkipped };
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
            const { title, turns, branches, filesSkipped } = chatgptTurns(data);
            const incomplete = incompleteFrom([], filesSkipped);
            const units = toUnits(turns);
            return { title, units, branches: branchUnits(units, branches), ...(incomplete ? { incomplete } : {}) };
          }
          const session = await getJson(f, `${url.origin}/api/auth/session`);
          const token = isObj(session) && typeof session.accessToken === "string" ? session.accessToken : null;
          if (!token) throw new Error("not signed in to ChatGPT");
          const headers = { authorization: `Bearer ${token}` };
          const data = await getJson(f, `${url.origin}/backend-api/conversation/${ids.conversation}`, { headers });
          const conv = ids.conversation;
          const { title, turns, branches, filesSkipped } = chatgptTurns(data, {
            file: (id) => `${url.origin}/backend-api/files/download/${encodeURIComponent(id)}`,
            interpreter: (messageId, sandboxPath) =>
              `${url.origin}/backend-api/conversation/${conv}/interpreter/download?message_id=${encodeURIComponent(messageId)}&sandbox_path=${encodeURIComponent(sandboxPath)}`,
            headers,
          });
          const all = uniqueTurns(turns, branches);
          lastRefOnly(all);
          const incomplete = incompleteFrom([], [...filesSkipped, ...(await fetchRefs(f, all, o))]);
          const units = toUnits(turns);
          return { title, units, branches: branchUnits(units, branches), ...(incomplete ? { incomplete } : {}) };
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
const EXT_MIME: Record<string, string> = { md: "text/markdown", markdown: "text/markdown", html: "text/html", htm: "text/html", svg: "image/svg+xml", json: "application/json", csv: "text/csv", txt: "text/plain", tsx: "text/tsx", jsx: "text/jsx", ts: "text/typescript", js: "text/javascript", py: "text/x-python", mermaid: "text/vnd.mermaid", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", zip: "application/zip", mp4: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav", pdf: "application/pdf" };
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

interface ArtifactState { title: string; mime?: string; language?: string; content: string; version: number }

/** Apply one artifact tool call; returns the asset for this turn, or a problem to report. */
function artifactOp(name: string, input: Record<string, unknown>, files: Map<string, ArtifactState>): { asset?: Asset; title?: string; problem?: FileIssue; ignore?: true } {
  const unapplied = (text: string, file: string): { problem: FileIssue } => ({ problem: { text, file: { name: file, why: "unapplied" } } });
  const emit = (id: string, st: ArtifactState): { asset: Asset; title: string } => ({
    title: st.title,
    asset: { type: "file", id, name: st.title, ...(st.mime ? { mime: st.mime } : {}), ...(st.language ? { language: st.language } : {}), content: st.content, version: st.version },
  });
  if (name === "artifacts") {
    const id = str(input.id);
    const command = str(input.command) ?? "create";
    if (!id) return unapplied("an artifact without an id", "?");
    const prev = files.get(id);
    if (command === "create" || command === "rewrite") {
      const content = str(input.content);
      if (content === undefined) return unapplied(`artifact «${str(input.title) ?? id}» has no content`, str(input.title) ?? id);
      const st: ArtifactState = { title: str(input.title) ?? prev?.title ?? id, mime: str(input.type) ?? prev?.mime, language: str(input.language) ?? prev?.language, content, version: (prev?.version ?? 0) + 1 };
      files.set(id, st);
      return emit(id, st);
    }
    if (command === "update") {
      const oldStr = str(input.old_str), newStr = str(input.new_str);
      if (!prev || oldStr === undefined || newStr === undefined || !prev.content.includes(oldStr)) return unapplied(`a change to artifact «${prev?.title ?? id}» could not be applied`, prev?.title ?? id);
      const st: ArtifactState = { ...prev, content: prev.content.replace(oldStr, () => newStr), version: prev.version + 1 };
      files.set(id, st);
      return emit(id, st);
    }
    return unapplied(`unknown artifact command «${command}»`, prev?.title ?? id);
  }
  if (name === "create_file") {
    const path = str(input.path), content = str(input.file_text) ?? str(input.content);
    if (!path || content === undefined) return unapplied("a created file without path or content", path ?? "?");
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
    if (!path || !prev || oldStr === undefined || !prev.content.includes(oldStr)) return unapplied(`a change to file «${path ?? "?"}» could not be applied`, path?.split("/").pop() ?? "?");
    const st: ArtifactState = { ...prev, content: prev.content.replace(oldStr, () => newStr), version: prev.version + 1 };
    files.set(path, st);
    return emit(path, st);
  }
  // An MCP tool ("DNS Manager:simply_check") acts outside the conversation; its result is not a file in it.
  if (CLAUDE_TOOLS_NO_FILES.has(name) || name.includes(":")) return { ignore: true }; // reads, searches, or runs — never a file the conversation holds
  // F099.13: any other tool may have made files (a code tool that writes DESIGN.md or renders a PNG —
  // jam 13/10: «KAI», 3 of 28 files, and the clip said complete). Unknown is never read as nothing.
  return { problem: { text: `a tool «${name}» that may have made files the clip does not hold`, file: { name, why: "unknown_tool", tool: name } } };
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
export function claudeTurns(data: unknown, links?: ClaudeLinks): { title: string; turns: Turn[]; branches: Turn[][]; skipped: string[]; filesSkipped: FileIssue[] } {
  if (!isObj(data) || !Array.isArray(data.chat_messages)) throw new ShapeError("unexpected conversation shape");
  const byId = new Map<string, Record<string, unknown>>();
  for (const m of data.chat_messages) if (isObj(m) && typeof m.uuid === "string") byId.set(m.uuid, m);
  // 0.8.3 (jam 13/10: KAI gave 51 of 76 turns, «complete»): current_leaf_message_uuid can point at a
  // message that has replies after it. A leaf with children is not the end of the thread — follow the
  // newest reply down to the real end.
  const children = new Map<string, Record<string, unknown>[]>();
  for (const m of byId.values()) {
    const p = m.parent_message_uuid;
    if (typeof p === "string") children.set(p, [...(children.get(p) ?? []), m]);
  }
  const order = (m: Record<string, unknown>) => (typeof m.created_at === "string" ? Date.parse(m.created_at) : NaN) || (typeof m.index === "number" ? m.index : 0);
  let leaf = data.current_leaf_message_uuid;
  for (let guard = 0; typeof leaf === "string" && children.get(leaf)?.length && guard < byId.size; guard++) {
    leaf = [...children.get(leaf)!].sort((x, y) => order(y) - order(x))[0]!.uuid;
  }
  const parentOf = (m: Record<string, unknown>) => m.parent_message_uuid;
  let path: Record<string, unknown>[];
  if (typeof leaf === "string") {
    path = lineTo(byId, parentOf, leaf);
    if (!path.length) throw new ShapeError("the current message is not in the conversation");
  } else {
    // No tree answer: a linear list is the thread only when nothing branches.
    const parents = data.chat_messages.map((m) => (isObj(m) ? m.parent_message_uuid : undefined));
    if (new Set(parents).size !== parents.length) throw new ShapeError("branched conversation without a current leaf");
    path = data.chat_messages.filter(isObj);
  }
  const skipped: string[] = [];
  const filesSkipped: FileIssue[] = [];
  const read = (m: Record<string, unknown>, files: Map<string, ArtifactState>): Turn | undefined => {
    const role = m.sender === "human" ? "user" : m.sender === "assistant" ? "assistant" : null;
    if (!role) return undefined;
    if (!Array.isArray(m.content)) {
      if (typeof m.text !== "string") throw new ShapeError("message has neither content nor text");
      return { role, text: m.text };
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
      else filesSkipped.push({ text: `uploadet «${name}» har ingen adresse at hente fra`, file: { name, why: "no_url" } });
    }
    for (const b of m.content) {
      if (!isObj(b)) continue;
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
      else if (b.type === "tool_use" && b.name === "present_files") {
        // F099.13 / 0.8.1 — the INPUT is the full list of files handed over (jam 13/10: KAI showed
        // 28 in the panel, the tool results named ~15). The result only adds mime/name when it has them.
        const input = isObj(b.input) ? b.input : {};
        for (const path of Array.isArray(input.filepaths) ? input.filepaths : []) {
          if (typeof path !== "string" || !path) continue;
          const name = path.split("/").pop()!;
          parts.push(`[Fil: ${name}]`);
          if (links) refs.push({ id: path, name, url: links.output(path) });
          else filesSkipped.push({ text: `«${name}» har ingen adresse at hente fra`, file: { name, why: "no_url" } });
        }
      } else if (b.type === "tool_use" && typeof b.name === "string") {
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
          const known = refs.find((r) => r.id === item.file_path);
          const mime = str(item.mime_type);
          if (known) {
            if (mime) known.mime = mime;
            continue;
          }
          // in the result but not in the input — still a file the person was shown
          const name = str(item.name) ?? item.file_path.split("/").pop()!;
          parts.push(`[Fil: ${name}]`);
          if (links) refs.push({ id: item.file_path, name, ...(mime ? { mime } : {}), url: links.output(item.file_path) });
        }
      } else if (typeof b.type === "string" && CLAUDE_SKIP.has(b.type)) continue;
      else skipped.push(`a message part of type «${String(b.type)}»`);
    }
    return { role, text: parts.join("\n\n"), ...(assets.length ? { assets } : {}), ...(refs.length ? { refs } : {}) };
  };
  const readLine = lineReader(read, () => new Map<string, ArtifactState>(), (st) => new Map(st));
  const turns = readLine(path);
  // F099.21 — every other line of the tree (an older version, a retried answer), each read once.
  const branches = typeof leaf === "string" ? otherLeaves(byId, parentOf, order, leaf).map((id) => readLine(lineTo(byId, parentOf, id))) : [];
  return { title: typeof data.name === "string" && data.name ? data.name : "Claude", turns, branches, skipped, filesSkipped };
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
              const { title, turns, branches, skipped, filesSkipped } = claudeTurns(data, {
                output: (path) => `${base}/wiggle/download-file?path=${encodeURIComponent(path)}`,
                upload: (rel) => new URL(rel, url.origin).href,
              });
              const all = uniqueTurns(turns, branches);
              lastRefOnly(all);
              const incomplete = incompleteFrom(skipped, [...filesSkipped, ...(await fetchRefs(f, all, o))]);
              const units = toUnits(turns);
              return { title, units, branches: branchUnits(units, branches), ...(incomplete ? { incomplete } : {}) };
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
