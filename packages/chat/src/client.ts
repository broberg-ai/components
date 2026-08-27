/**
 * @broberg/chat/client — read the stream back in a browser (F079.3).
 *
 * Framework-free and dependency-free: `fetch` the route, hand the response
 * here, and get the SAME typed frames the core produced on the server.
 *
 *   const res = await fetch("/api/admin/chat", {
 *     method: "POST",
 *     headers: { "content-type": "application/json" },
 *     body: JSON.stringify({ messages }),
 *     signal: controller.signal,        // aborting stops the work server-side too
 *   });
 *   for await (const frame of readChatStream(res)) {
 *     if (frame.type === "text") append(frame.text);
 *   }
 *
 * The parser is deliberately spec-shaped rather than "split on \n\n and slice
 * off `data: `": an SSE record separator IS a blank line, chunk boundaries fall
 * wherever the network decides, and a naive reader loses exactly the payloads
 * that contain a newline — which is most real answers.
 */
import type { ChatFrame } from "./index.js";

export async function* readChatStream(
  source: Response | ReadableStream<Uint8Array>,
): AsyncGenerator<ChatFrame, void, undefined> {
  let stream: ReadableStream<Uint8Array> | null;

  if (source instanceof ReadableStream) {
    stream = source;
  } else {
    // A failed request must not read as an empty conversation. Silence and "the
    // assistant had nothing to say" are indistinguishable to a caller that only
    // iterates, so a non-2xx is thrown rather than yielded as zero frames.
    if (!source.ok) {
      let detail = "";
      try {
        detail = (await source.text()).slice(0, 200);
      } catch {
        /* a body that cannot be read must not mask the status */
      }
      throw new Error(`readChatStream: the server answered ${source.status}${detail ? ` — ${detail}` : ""}`);
    }
    stream = source.body;
  }

  if (!stream) throw new Error("readChatStream: the response has no body to read");

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const record = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseRecord(record);
        if (frame) yield frame;
        boundary = buffer.indexOf("\n\n");
      }
    }

    // A final record with no trailing blank line — a stream cut short still
    // hands over whatever completed, rather than dropping it silently.
    const tail = buffer.replace(/\r\n/g, "\n").trim();
    if (tail) {
      const frame = parseRecord(tail);
      if (frame) yield frame;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released by an abort */
    }
  }
}

function parseRecord(record: string): ChatFrame | null {
  const data: string[] = [];

  for (const line of record.split("\n")) {
    if (!line || line.startsWith(":")) continue; // blank or comment/keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") continue; // id/event/retry are not ours to interpret
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1); // exactly ONE leading space, per spec
    data.push(value);
  }

  if (!data.length) return null;
  try {
    return JSON.parse(data.join("\n")) as ChatFrame;
  } catch {
    return null; // a truncated record is not a frame; never guess at one
  }
}
