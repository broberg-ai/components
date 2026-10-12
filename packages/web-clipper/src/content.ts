// @broberg/web-clipper/content — F099.6. The content-script half of
// extraction: injected into the active tab on click, it answers the popup's
// request with a Clip from YOUR extractors (the article extractor covers the
// rest). Import NOTHING here that the popup also imports — see ./extension.ts.
import { extractClip, type Clip, type Extractor } from "./extract";

/** Must equal EXTRACT_MESSAGE in ./extension.ts (held by a test). */
export const CONTENT_EXTRACT_MESSAGE = "broberg-web-clipper:extract";
type Reply = { ok: true; clip: Clip } | { ok: false; error: string; name: string };

interface RuntimeLike {
  onMessage: { addListener(fn: (msg: unknown, sender: unknown, respond: (r: Reply) => void) => boolean | void): void };
}

/**
 * Call once from your content-script entry. A second injection on the same
 * page (the user clips twice) does not register a second listener.
 */
export function runContentScript(extractors: readonly Extractor[] = [], runtime?: RuntimeLike): void {
  const g = globalThis as { __brobergWebClipper?: boolean; chrome?: { runtime?: RuntimeLike }; browser?: { runtime?: RuntimeLike } };
  if (g.__brobergWebClipper) return;
  const rt = runtime ?? g.browser?.runtime ?? g.chrome?.runtime;
  if (!rt) throw new Error("web-clipper/content: not running inside an extension (no runtime API)");
  g.__brobergWebClipper = true;
  rt.onMessage.addListener((msg, _sender, respond) => {
    if ((msg as { action?: string })?.action !== CONTENT_EXTRACT_MESSAGE) return;
    extractClip(document, new URL(location.href), extractors).then(
      (clip) => respond({ ok: true, clip }),
      (e: unknown) => respond({ ok: false, error: e instanceof Error ? e.message : String(e), name: e instanceof Error ? e.name : "Error" }),
    );
    return true; // the answer is asynchronous
  });
}
