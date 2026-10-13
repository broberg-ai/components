// @broberg/web-clipper/content — F099.6. The content-script half of
// extraction: injected into the active tab on click, it answers the popup's
// request with a Clip from YOUR extractors (the article extractor covers the
// rest). Import NOTHING here that the popup also imports — see ./extension.ts.
import { extractClip, type Clip, type Extractor } from "./extract";

/** Must equal EXTRACT_MESSAGE in ./extension.ts (held by a test). */
export const CONTENT_EXTRACT_MESSAGE = "broberg-web-clipper:extract";
/** Must equal PART_MESSAGE in ./extension.ts (held by a test). */
export const CONTENT_PART_MESSAGE = "broberg-web-clipper:part";
/**
 * Chrome refuses an extension message over 64 MiB, so a file's content larger than this travels in
 * parts of this many characters and is put back together on the other side (0.8.3). Must equal
 * PART_CHARS in ./extension.ts.
 */
export const CONTENT_PART_CHARS = 8 * 1024 * 1024;
type Reply = { ok: true; clip: Clip } | { ok: false; error: string; name: string } | { ok: true; data: string };

/** Big contents held back in the page until the extension has fetched every part. */
const held = new Map<string, string>();

function holdBigContents(clip: Clip): Clip {
  held.clear();
  let n = 0;
  return {
    ...clip,
    units: clip.units.map((u) =>
      u.assets?.some((a) => (a.content?.length ?? 0) > CONTENT_PART_CHARS)
        ? {
            ...u,
            assets: u.assets.map((a) => {
              if ((a.content?.length ?? 0) <= CONTENT_PART_CHARS) return a;
              const ref = `part-${++n}`;
              held.set(ref, a.content!);
              const { content: _content, ...rest } = a;
              return { ...rest, contentRef: ref, contentLength: a.content!.length };
            }),
          }
        : u,
    ),
  };
}

interface RuntimeLike {
  onMessage: {
    addListener(fn: (msg: unknown, sender: unknown, respond: (r: Reply) => void) => boolean | void): void;
    removeListener?(fn: (msg: unknown, sender: unknown, respond: (r: Reply) => void) => boolean | void): void;
  };
}

type Listener = Parameters<RuntimeLike["onMessage"]["addListener"]>[0];

/**
 * Call from your content-script entry. Every injection REPLACES the previous
 * listener instead of skipping: after the extension is reloaded, the new
 * script lands in a tab whose old one is still there, and skipping meant the
 * OLD extractors kept answering (or nothing did) until the user reloaded the
 * tab (jam 13/10: «ikke en samtale» on a ChatGPT page). Clipping twice still
 * leaves exactly one listener.
 */
export function runContentScript(extractors: readonly Extractor[] = [], runtime?: RuntimeLike): void {
  const g = globalThis as { __brobergWebClipper?: { rt: RuntimeLike; listener: Listener }; chrome?: { runtime?: RuntimeLike }; browser?: { runtime?: RuntimeLike } };
  const rt = runtime ?? g.browser?.runtime ?? g.chrome?.runtime;
  if (!rt) throw new Error("web-clipper/content: not running inside an extension (no runtime API)");
  const previous = g.__brobergWebClipper;
  if (previous) {
    try {
      previous.rt.onMessage.removeListener?.(previous.listener);
    } catch {
      // the old extension context is gone (it was reloaded) — its listener can no longer fire anyway
    }
  }
  const listener: Listener = (msg, _sender, respond) => {
    const m = msg as { action?: string; ref?: string; start?: number };
    if (m?.action === CONTENT_PART_MESSAGE) {
      const all = typeof m.ref === "string" ? held.get(m.ref) : undefined;
      if (all === undefined) respond({ ok: false, error: "that part is no longer held — clip again", name: "PartGone" });
      else {
        const start = Math.max(0, Number(m.start) || 0);
        const data = all.slice(start, start + CONTENT_PART_CHARS);
        if (start + data.length >= all.length) held.delete(m.ref!);
        respond({ ok: true, data });
      }
      return;
    }
    if (m?.action !== CONTENT_EXTRACT_MESSAGE) return;
    extractClip(document, new URL(location.href), extractors).then(
      (clip) => respond({ ok: true, clip: holdBigContents(clip) }),
      (e: unknown) => respond({ ok: false, error: e instanceof Error ? e.message : String(e), name: e instanceof Error ? e.name : "Error" }),
    );
    return true; // the answer is asynchronous
  };
  rt.onMessage.addListener(listener);
  g.__brobergWebClipper = { rt, listener };
}
