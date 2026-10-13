// @broberg/web-clipper — F099.20. Files too big for the clip are STREAMED from the page straight to
// the consumer's storage (presigned multipart part addresses), never through the extension's messages
// or into memory beyond one part. Owner 14/10: «en video der fylder 1 GB … så må vi streame til R2».
//
// Lives in the CONTENT SCRIPT (it holds the page's session): the reader registers a file here instead
// of downloading it, and content.ts streams it when the extension hands over the part addresses.

export interface HeldStream {
  name: string;
  /** The final address of the bytes (after any download_url hop) and how to ask for them. */
  url: string;
  init: RequestInit;
  size: number;
  fetch: typeof fetch;
}

const held = new Map<string, HeldStream>();
let next = 0;

export function holdStream(s: HeldStream): string {
  const ref = `stream-${++next}`;
  held.set(ref, s);
  return ref;
}

export function takeStream(ref: string): HeldStream | undefined {
  const s = held.get(ref);
  held.delete(ref);
  return s;
}

/** How many parts a file of `size` needs at `partSize`. */
export const partCount = (size: number, partSize: number) => Math.max(1, Math.ceil(size / partSize));

/**
 * Read the file as a stream and PUT it part by part. Memory: at most one part. Returns each part's ETag
 * in order (what the storage needs to join them). Throws on the first refused part — the caller aborts.
 */
export async function streamParts(s: HeldStream, partUrls: readonly string[], partSize: number, put: typeof fetch = fetch): Promise<{ etags: string[]; size: number }> {
  if (partSize < 1) throw new Error("partSize must be positive");
  const res = await s.fetch(s.url, s.init);
  if (!res.ok || !res.body) throw new Error(`«${s.name}» kunne ikke hentes (${res.status})`);
  const reader = res.body.getReader();
  const etags: string[] = [];
  let buf = new Uint8Array(partSize);
  let fill = 0;
  let total = 0;
  const send = async (bytes: Uint8Array) => {
    const url = partUrls[etags.length];
    if (!url) throw new Error(`«${s.name}» skal bruge flere end ${partUrls.length} dele`);
    const r = await put(url, { method: "PUT", body: bytes as BodyInit });
    if (!r.ok) throw new Error(`del ${etags.length + 1} af «${s.name}» blev afvist (${r.status})`);
    const etag = r.headers.get("etag");
    // without the ETag the parts cannot be joined — a bucket whose CORS hides it must say so, not fail later
    if (!etag) throw new Error(`del ${etags.length + 1} af «${s.name}» kom uden ETag (lageret skal vise ETag-headeren)`);
    etags.push(etag);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let off = 0;
    while (off < value.length) {
      const n = Math.min(partSize - fill, value.length - off);
      buf.set(value.subarray(off, off + n), fill);
      fill += n;
      off += n;
      total += n;
      if (fill === partSize) {
        await send(buf);
        buf = new Uint8Array(partSize);
        fill = 0;
      }
    }
  }
  if (fill > 0 || etags.length === 0) await send(buf.subarray(0, fill));
  return { etags, size: total };
}
