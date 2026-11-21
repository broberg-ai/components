// F111.5 — putObject stores BYTES (a WebP derivative), not only text. The signature must hash
// the raw bytes and the stored object must be those bytes exactly; a string stays as in 0.2.x.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createS3Signer } from "../src/index";
import { fakeS3 } from "./fake-s3";

const SECRET = "test-secret-" + "x".repeat(28);
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

function setup() {
  const s3 = fakeS3();
  const seen: { hash: string | null; type: string | null; len: number; signed: string }[] = [];
  const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const copy = req.clone();
    seen.push({ hash: req.headers.get("x-amz-content-sha256"), type: req.headers.get("content-type"), len: (await copy.arrayBuffer()).byteLength, signed: req.headers.get("authorization") ?? "" });
    return s3.fetch(req);
  }) as typeof fetch;
  const signer = createS3Signer({ accountId: "acct", bucket: "b", accessKeyId: "AKID", secretAccessKey: SECRET, fetch: spy });
  return { s3, signer, seen };
}

// Not valid UTF-8 (RIFF/WEBP header + 0xff 0x00 0xd8): any text round-trip would change these bytes.
const IMAGE = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0xff, 0x00, 0xd8, 0x80, 0x57, 0x45, 0x42, 0x50, 0xfe]);

describe("F111.5 putObject with bytes", () => {
  it("stores the exact bytes and signs their hash", async () => {
    const { s3, signer, seen } = setup();
    await signer.putObject({ key: "products/w480/x.webp", body: IMAGE, contentType: "image/webp" });
    expect(s3.objects.get("products/w480/x.webp")).toEqual(IMAGE);
    expect(s3.meta.get("products/w480/x.webp")?.type).toBe("image/webp");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.hash).toBe(sha(IMAGE));
    expect(seen[0]!.len).toBe(IMAGE.byteLength);
    expect(seen[0]!.signed).toMatch(/SignedHeaders=[^,]*x-amz-content-sha256/);
  });

  it("a string body is unchanged from 0.2.x: UTF-8 bytes, UNSIGNED-PAYLOAD", async () => {
    const { s3, signer, seen } = setup();
    const text = '{"navn":"æøå"}';
    await signer.putObject({ key: "m.json", body: text, contentType: "application/json" });
    expect(new TextDecoder().decode(s3.objects.get("m.json"))).toBe(text);
    expect(seen[0]!.hash).toBe("UNSIGNED-PAYLOAD");
    expect(seen[0]!.len).toBe(Buffer.byteLength(text));
  });
});
