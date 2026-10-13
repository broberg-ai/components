// @broberg/web-clipper/extract — F099.3. The extraction plug-in point and the
// generic article extractor (contract F099.1, docs/features/F099-web-clipper.md).
//
//  - An Extractor turns a page into a Clip: url, title and its units. A chat
//    reader (Jam) yields one unit per turn; the article extractor yields one
//    "page" unit.
//  - Consumers register their own extractors; pickExtractor tries them in the
//    order given and falls back to articleExtractor, so a chatgpt.com reader
//    wins on chatgpt.com and every other page still clips.
//  - DETERMINISTIC (jam #2983): the same DOM must give byte-identical
//    markdown, or a plain reload of a chat turns into a false branch in the
//    fingerprint engine. Every extractor, base or consumer, is held to this.
//
// articleExtractor is Trail's apps/web-clipper/src/content/extractor.ts
// (broberg-ai/trail f5ce8ba) lifted unchanged — Readability + turndown with the
// same options and rules — except that it takes the document as a parameter
// instead of reading the global, so it can run in a test or a worker.
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import type { Unit as CoreUnit } from "./core";

/**
 * One piece of a clip: the fingerprinted identity from ./core (kind, role,
 * content, position) plus what is carried along but never fingerprinted.
 */
export interface Unit extends CoreUnit {
  parent?: number;
  html?: string;
  blocks?: Block[];
  assets?: Asset[];
  links?: string[];
}
export type Block = { type: "code"; lang?: string; text: string } | { type: "table"; head: string[]; rows: string[][] };
/**
 * A file or image that belongs to a unit. Either a `url` to fetch, or (F099.10,
 * a chat artifact) the `content` itself — the destination stores it (uploadAsset).
 */
export interface Asset {
  type: "image" | "file";
  url?: string;
  alt?: string;
  /** F099.10 — a stable id (a Claude artifact's id) so versions of one file group together. */
  id?: string;
  /** File name / title, e.g. "Markedsplan". */
  name?: string;
  /** e.g. "text/markdown", "text/html", "application/vnd.ant.code". */
  mime?: string;
  /** Programming language, for code. */
  language?: string;
  /** The file's text as of this unit (an update is already applied to the previous version). */
  content?: string;
  /** 1 for the first version of `id`, then 2, 3 … */
  version?: number;
  /** F099.13 — "base64": `content` is the file's bytes in base64 (an image, a zip, a video). Absent: `content` is text. */
  encoding?: "base64";
  /** F099.13 — the file's size in bytes, for a fetched file. */
  size?: number;
}
export interface Clip {
  url: string;
  title: string;
  /** Conversation id from the URL (chat readers); absent for a plain page. */
  anchor?: string;
  shareUrl?: string;
  units: Unit[];
  /**
   * F099.9 — did this clip get EVERYTHING? Only a reader that fetched the whole
   * conversation sets complete: true. A clip read from what happens to be on
   * screen is complete: false with a reason, and the popup says so: an
   * incomplete clip must never look complete (owner, 13/10). Absent = not
   * known (a plain page).
   */
  completeness?: Completeness;
}
/** A file the conversation shows that the clip does not carry, and why. */
export interface MissingFile {
  /** The file's name (for unknown_tool: the tool's name). */
  name: string;
  /**
   * no_url: there is no address to fetch it from (an upload without a preview, a shared link) ·
   * http: the address answered an error (`status`) · network: the browser refused the request (CORS, offline) ·
   * no_download_url: the site gave no download address · too_large: over the per-file limit ·
   * clip_limit: the clip's total file budget was used up · unknown_tool: a tool call the reader does not know
   * (it may have made files — `tool`) · unapplied: an artifact change that could not be applied.
   */
  why: "no_url" | "http" | "network" | "no_download_url" | "too_large" | "clip_limit" | "unknown_tool" | "unapplied";
  status?: number;
  tool?: string;
}

export interface Completeness {
  complete: boolean;
  /** "data": the page's own conversation data. "dom": what was rendered on screen. */
  source: "data" | "dom";
  /** Why it is not complete, in words the popup can show. */
  reason?: string;
  /**
   * F099.13 — WHAT is missing when complete is false. "files": every turn was read whole, only a file
   * (an artifact, a tool's output) is not in the clip — keep the turns. "turns": the turns themselves are
   * not whole (read from the screen, or a part that may hold words was not understood).
   */
  missing?: "files" | "turns";
  /**
   * F099.13 / 0.8.2 — every file that is NOT in the clip, as data (owner 13/10: «send en fejlbesked til
   * klienten, så kan I selv style eller bruge meddelelsen»). All of them, never the first few.
   */
  missingFiles?: MissingFile[];
  /** F099.13 / 0.8.1 — every problem, one per entry (a file that could not be fetched, a part not understood). `reason` names them all too. */
  problems?: string[];
}

export interface Extractor {
  id: string;
  matches(url: URL): boolean;
  extract(doc: Document, url: URL): Promise<Clip>;
}

/** Thrown when a page yields nothing to clip — Readability found no article. */
export class NothingToClipError extends Error {
  constructor(url: string) {
    super(`nothing to clip on ${url}`);
    this.name = "NothingToClipError";
  }
}

/**
 * Trail's extraction, unchanged: { title, markdown } or null when Readability
 * finds no article. Readability mutates the document it parses, so it gets a clone.
 */
export function extractArticle(doc: Document): { title: string; markdown: string } | null {
  const article = new Readability(doc.cloneNode(true) as Document, {
    keepClasses: false,
    charThreshold: 0,
  }).parse();
  if (!article) return null;
  return {
    title: article.title || doc.title || "Untitled",
    markdown: htmlToMarkdown(article.content ?? ""),
  };
}

/**
 * F099.9 — HTML to markdown with exactly the article extractor's Turndown
 * setup (moved here unchanged), so a consumer's own reader converts the same
 * way and never rolls a copy. Deterministic: the same HTML gives the same bytes.
 */
export function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  turndown.addRule("remove-scripts", {
    filter: ["script", "style", "noscript", "iframe", "nav", "footer", "header"],
    replacement: () => "",
  });
  return turndown.turndown(html);
}

/** The generic extractor: matches every page, yields one "page" unit. */
export const articleExtractor: Extractor = {
  id: "article",
  matches: () => true,
  async extract(doc, url) {
    const a = extractArticle(doc);
    if (!a) throw new NothingToClipError(url.href);
    return { url: url.href, title: a.title, units: [{ kind: "page", content: a.markdown, position: 0 }] };
  },
};

/** The first of `extractors` that matches `url`; articleExtractor when none does. */
export function pickExtractor(url: URL, extractors: readonly Extractor[] = []): Extractor {
  return extractors.find((e) => e.matches(url)) ?? articleExtractor;
}

/** Pick and run in one step. */
export function extractClip(doc: Document, url: URL, extractors: readonly Extractor[] = []): Promise<Clip> {
  return pickExtractor(url, extractors).extract(doc, url);
}

// F099.9 — the chat readers live in ./chat and are part of /extract.
export { chatgptReader, claudeReader, createChatgptReader, createClaudeReader, chatReaders } from "./chat";
