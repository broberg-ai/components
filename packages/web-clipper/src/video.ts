// @broberg/web-clipper/extract — the YouTube reader (jam F002.35). A YouTube video page clips as ONE
// unit of kind "video": the video itself (id, title, channel, start time, thumbnail), not the page's
// text. Part of /extract, so every clipper (Jam, Trail) gets it by listing it before the article extractor.
//
//  - WHICH video is read from the URL, never from the page: YouTube is a single-page app, and its
//    <meta> tags can still describe the PREVIOUS video after an in-page navigation. Title and channel
//    are only taken from tags that name this video's id; otherwise from what the page shows now.
//  - The unit's content is the canonical watch URL + title + channel, WITHOUT the start time — so a
//    second clip of the same video at another moment is "same", not a new branch. The start time rides
//    along in `unit.video.start` (not fingerprinted).
//  - The thumbnail is built from the id (i.ytimg.com/vi/<id>/hqdefault.jpg); nothing is fetched.
import { NothingToClipError, type Clip, type Extractor } from "./extract";

export interface VideoRef {
  provider: "youtube";
  /** The 11-character YouTube video id. */
  videoId: string;
  /** The canonical address: https://www.youtube.com/watch?v=<id>. */
  url: string;
  title: string;
  channel?: string;
  /** Start time in whole seconds, from `t=` / `start=`. Absent when the link starts at 0. */
  start?: number;
  thumbnailUrl: string;
  /** "shorts" for a /shorts/ link. */
  format?: "shorts";
}

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

/** The video id and format a URL points at, or null when it is not a single video. */
export function youtubeVideoFromUrl(url: URL): { videoId: string; format?: "shorts" } | null {
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return ID.test(id) ? { videoId: id } : null;
  }
  if (!HOSTS.has(host)) return null;
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return ID.test(id) ? { videoId: id } : null;
  }
  const m = /^\/(shorts|live|embed)\/([^/?#]+)/.exec(url.pathname);
  if (m && ID.test(m[2]!)) return m[1] === "shorts" ? { videoId: m[2]!, format: "shorts" } : { videoId: m[2]! };
  return null;
}

/** `t=` / `start=` as whole seconds: "83", "83s", "1m23s", "1h2m3s". Null when absent, 0 or unreadable. */
export function youtubeStartSeconds(url: URL): number | null {
  const raw = url.searchParams.get("t") ?? url.searchParams.get("start") ?? (/(?:^|&)t=([^&]+)/.exec(url.hash.slice(1))?.[1] ?? null);
  if (!raw) return null;
  let s: number;
  if (/^\d+s?$/.test(raw)) s = parseInt(raw, 10);
  else {
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
    if (!m || !(m[1] || m[2] || m[3])) return null;
    s = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  }
  return s > 0 ? s : null;
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() || undefined;
const meta = (doc: Document, sel: string) => doc.querySelector(sel)?.getAttribute("content")?.trim() || undefined;

/** True when the page's <meta> tags describe THIS video (not the one before an in-page navigation). */
function metaIsCurrent(doc: Document, videoId: string): boolean {
  const id = meta(doc, 'meta[itemprop="identifier"]') ?? meta(doc, 'meta[itemprop="videoId"]');
  if (id) return id === videoId;
  const og = meta(doc, 'meta[property="og:url"]');
  return !!og && og.includes(videoId);
}

function readTitle(doc: Document, videoId: string): string | undefined {
  const shown = text(doc.querySelector("ytd-watch-metadata h1")) ?? text(doc.querySelector("#title h1"));
  if (shown) return shown;
  if (metaIsCurrent(doc, videoId)) {
    const m = meta(doc, 'meta[property="og:title"]') ?? meta(doc, 'meta[name="title"]');
    if (m) return m;
  }
  // document.title follows in-page navigation: "(3) Title - YouTube".
  const t = doc.title.replace(/^\(\d+\)\s*/, "").replace(/\s+-\s+YouTube(?: Music)?$/, "").trim();
  return t && t !== "YouTube" ? t : undefined;
}

function readChannel(doc: Document, videoId: string): string | undefined {
  const shown = text(doc.querySelector("ytd-watch-metadata ytd-channel-name a")) ?? text(doc.querySelector("#owner #channel-name a"));
  if (shown) return shown;
  if (metaIsCurrent(doc, videoId)) return doc.querySelector('[itemprop="author"] [itemprop="name"]')?.getAttribute("content")?.trim() || undefined;
  return undefined;
}

/** The markdown the unit carries — deterministic, start time left out on purpose (see the file header). */
export function videoMarkdown(v: Pick<VideoRef, "url" | "title" | "channel">): string {
  return `[${v.title.replace(/[[\]]/g, "\\$&")}](${v.url})${v.channel ? `\n\n${v.channel}` : ""}`;
}

/** The YouTube reader. List it BEFORE the article extractor (which matches every page). */
export function createYoutubeReader(): Extractor {
  return {
    id: "youtube",
    matches: (url) => youtubeVideoFromUrl(url) !== null,
    async extract(doc, url): Promise<Clip> {
      const hit = youtubeVideoFromUrl(url);
      if (!hit) throw new NothingToClipError(url.href);
      const { videoId, format } = hit;
      const canonical = `https://www.youtube.com/watch?v=${videoId}`;
      const title = readTitle(doc, videoId) ?? canonical;
      const channel = readChannel(doc, videoId);
      const start = youtubeStartSeconds(url);
      const video: VideoRef = {
        provider: "youtube", videoId, url: canonical, title, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        ...(channel ? { channel } : {}), ...(start ? { start } : {}), ...(format ? { format } : {}),
      };
      return {
        url: canonical,
        title,
        anchor: videoId,
        units: [{ kind: "video", content: videoMarkdown(video), position: 0, video }],
      };
    },
  };
}

export const youtubeReader: Extractor = createYoutubeReader();
