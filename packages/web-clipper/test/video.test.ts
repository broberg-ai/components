// @vitest-environment jsdom
// jam F002.35 — the YouTube reader: a video page clips as the video, not as the page's text.
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { extractClip, pickExtractor, youtubeReader, youtubeStartSeconds, youtubeVideoFromUrl } from "../src/extract";
import { unitFingerprint } from "../src/core";

const ID = "dQw4w9WgXcQ";
const doc = (html: string, url: string) => new JSDOM(html, { url }).window.document;
const u = (s: string) => new URL(s);

/** A watch page as YouTube serves it: the shown title/channel plus the itemprop + og tags. */
const watchPage = (opts: { id?: string; title?: string; channel?: string; shown?: boolean; docTitle?: string } = {}) => {
  const id = opts.id ?? ID, title = opts.title ?? "Sådan laver du havrebarer uden sukker", channel = opts.channel ?? "Nordisk Køkken";
  return `<!doctype html><html><head><title>${opts.docTitle ?? `(3) ${title} - YouTube`}</title>
  <meta property="og:title" content="${title}"><meta property="og:url" content="https://www.youtube.com/watch?v=${id}">
  <meta itemprop="identifier" content="${id}"></head><body>
  <span itemprop="author"><link itemprop="name" content="${channel}"></span>
  ${opts.shown === false ? "" : `<ytd-watch-metadata><h1><yt-formatted-string>${title}</yt-formatted-string></h1><ytd-channel-name><a href="/@x">${channel}</a></ytd-channel-name></ytd-watch-metadata>`}
  <div id="description">Lots of text the article extractor would have clipped instead.</div></body></html>`;
};

describe("F002.35 — which addresses are a YouTube video", () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, { videoId: ID }],
    [`https://m.youtube.com/watch?v=${ID}&t=83`, { videoId: ID }],
    [`https://music.youtube.com/watch?v=${ID}`, { videoId: ID }],
    [`https://youtu.be/${ID}?t=1m23s`, { videoId: ID }],
    [`https://www.youtube.com/shorts/${ID}`, { videoId: ID, format: "shorts" }],
    [`https://www.youtube.com/live/${ID}`, { videoId: ID }],
  ])("%s → %j", (href, want) => expect(youtubeVideoFromUrl(u(href))).toStrictEqual(want));

  it.each([
    "https://www.youtube.com/",
    "https://www.youtube.com/@NordiskKokken",
    "https://www.youtube.com/results?search_query=havre",
    "https://www.youtube.com/watch?v=tooshort",
    "https://www.youtube.com/watch",
    `https://notyoutube.com/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
  ])("%s is not a single video", (href) => expect(youtubeVideoFromUrl(u(href))).toBeNull());
});

describe("F002.35 — t= gives whole seconds", () => {
  it.each([
    ["t=83", 83], ["t=83s", 83], ["t=1m23s", 83], ["t=1h2m3s", 3723], ["t=2m", 120], ["start=45", 45],
  ])("?%s → %d", (q, s) => expect(youtubeStartSeconds(u(`https://youtu.be/${ID}?${q}`))).toBe(s));
  it.each(["", "t=0", "t=abc", "t=1x"])("?%s → null", (q) => expect(youtubeStartSeconds(u(`https://youtu.be/${ID}?${q}`))).toBeNull());
});

describe("F002.35 — the reader", () => {
  it("a watch page clips as ONE video unit with id, title, channel, start and a thumbnail built from the id", async () => {
    const url = u(`https://www.youtube.com/watch?v=${ID}&t=1m23s`);
    const clip = await extractClip(doc(watchPage(), url.href), url, [youtubeReader]);
    expect(clip.url).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(clip.title).toBe("Sådan laver du havrebarer uden sukker");
    expect(clip.anchor).toBe(ID);
    expect(clip.units).toHaveLength(1);
    expect(clip.units[0]!.kind).toBe("video");
    expect(clip.units[0]!.video).toStrictEqual({
      provider: "youtube", videoId: ID, url: `https://www.youtube.com/watch?v=${ID}`,
      title: "Sådan laver du havrebarer uden sukker", channel: "Nordisk Køkken", start: 83,
      thumbnailUrl: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
    });
    expect(clip.units[0]!.content).toBe(`[Sådan laver du havrebarer uden sukker](https://www.youtube.com/watch?v=${ID})\n\nNordisk Køkken`);
  });

  it("a /shorts/ link is marked as shorts", async () => {
    const url = u(`https://www.youtube.com/shorts/${ID}`);
    const clip = await extractClip(doc(watchPage(), url.href), url, [youtubeReader]);
    expect(clip.units[0]!.video!.format).toBe("shorts");
  });

  it("the same video at another start time is the SAME unit (no false branch)", async () => {
    const a = u(`https://www.youtube.com/watch?v=${ID}`), b = u(`https://youtu.be/${ID}?t=300`);
    const ua = (await youtubeReader.extract(doc(watchPage(), a.href), a)).units[0]!;
    const ub = (await youtubeReader.extract(doc(watchPage(), b.href), b)).units[0]!;
    expect(await unitFingerprint(ua)).toBe(await unitFingerprint(ub));
    expect(ub.video!.start).toBe(300);
  });

  it("after an in-page navigation, STALE meta tags of the previous video are never used", async () => {
    // The URL says NEW_ID; the <meta> tags still describe the previous video; nothing is rendered yet.
    const NEW_ID = "abcdefghijk";
    const url = u(`https://www.youtube.com/watch?v=${NEW_ID}`);
    const html = watchPage({ id: ID, title: "Old video", channel: "Old channel", shown: false, docTitle: "New video - YouTube" });
    const clip = await youtubeReader.extract(doc(html, url.href), url);
    expect(clip.units[0]!.video!.videoId).toBe(NEW_ID);
    expect(clip.title).toBe("New video");
    expect(clip.units[0]!.video!.channel).toBeUndefined();
  });

  it("the YouTube home page and a channel page still go to the article extractor", () => {
    expect(pickExtractor(u("https://www.youtube.com/"), [youtubeReader]).id).toBe("article");
    expect(pickExtractor(u("https://www.youtube.com/@NordiskKokken"), [youtubeReader]).id).toBe("article");
    expect(pickExtractor(u(`https://youtu.be/${ID}`), [youtubeReader]).id).toBe("youtube");
  });
});
