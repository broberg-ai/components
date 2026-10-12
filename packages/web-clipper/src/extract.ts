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
export interface Asset { type: "image" | "file"; url: string; alt?: string }
export interface Clip {
  url: string;
  title: string;
  /** Conversation id from the URL (chat readers); absent for a plain page. */
  anchor?: string;
  shareUrl?: string;
  units: Unit[];
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

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  turndown.addRule("remove-scripts", {
    filter: ["script", "style", "noscript", "iframe", "nav", "footer", "header"],
    replacement: () => "",
  });

  return {
    title: article.title || doc.title || "Untitled",
    markdown: turndown.turndown(article.content ?? ""),
  };
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
