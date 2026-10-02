// components-F006.7 — the bytes decide what a file is, the floor cannot be
// crossed, the name never enters the key, and nothing scriptable renders inline.
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES,
  attachmentHeaders,
  attachmentKey,
  sha256Hex,
  sniffContentType,
  validateAttachment,
} from "../src/attachments";

const pad = (head: number[] | string, n = 64) => {
  const h = typeof head === "string" ? Array.from(head, (c) => c.charCodeAt(0)) : head;
  const b = new Uint8Array(Math.max(n, h.length));
  b.set(h);
  return b;
};
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const GIF = pad("GIF89a");
const WEBP = pad("RIFF\0\0\0\0WEBPVP8 ");
const HEIC = pad("\0\0\0\x18ftypheic");
const PDF = pad("%PDF-1.7\n");
const ZIP = pad([0x50, 0x4b, 0x03, 0x04]);
const OLE = pad([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const EXE = pad([0x4d, 0x5a, 0x90, 0x00]);
const ELF = pad([0x7f, 0x45, 0x4c, 0x46]);
const TEXT = new TextEncoder().encode("hej, æøå\n");

describe("sniffContentType — the first bytes", () => {
  it.each([
    [PNG, "image/png"], [JPEG, "image/jpeg"], [GIF, "image/gif"], [WEBP, "image/webp"],
    [HEIC, "image/heic"], [PDF, "application/pdf"], [ZIP, "application/zip"],
    [OLE, "application/x-ole-storage"], [TEXT, null],
  ] as const)("%#", (bytes, want) => {
    expect(sniffContentType(bytes)).toBe(want);
  });
});

describe("validateAttachment — the bytes decide, not the name or the browser", () => {
  it.each([
    ["photo.png", PNG, "image/png"],
    ["photo.jpg", JPEG, "image/jpeg"],
    ["IMG_1.HEIC", HEIC, "image/heic"],
    ["faktura.pdf", PDF, "application/pdf"],
    ["rapport.docx", ZIP, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["gammel.doc", OLE, "application/msword"],
    ["noter.txt", TEXT, "text/plain; charset=utf-8"],
  ] as const)("%s → %s", (filename, bytes, want) => {
    const v = validateAttachment({ bytes, filename });
    expect(v).toEqual({ ok: true, contentType: want, ext: filename.toLowerCase().split(".").pop(), bytes: bytes.length });
  });

  it("the sniffed type wins: a JPEG called .png is stored as image/jpeg", () => {
    const v = validateAttachment({ bytes: JPEG, filename: "x.png" });
    expect(v.ok && v.contentType).toBe("image/jpeg");
  });

  it.each([
    ["faktura.pdf", PNG],
    ["photo.png", PDF],
    ["photo.png", TEXT],
    ["rapport.docx", PDF],
    ["noter.txt", PDF],
  ] as const)("%s whose bytes are something else → refused", (filename, bytes) => {
    const v = validateAttachment({ bytes, filename });
    expect(v).toEqual({ ok: false, reason: `the file's contents do not match ".${filename.split(".").pop()}"` });
  });

  it("a renamed program is refused whatever it is called", () => {
    expect(validateAttachment({ bytes: EXE, filename: "invoice.pdf" }).ok).toBe(false);
    expect(validateAttachment({ bytes: ELF, filename: "notes.txt" }).ok).toBe(false);
    expect(validateAttachment({ bytes: pad("#!/bin/sh\n"), filename: "notes.txt" }).ok).toBe(false);
  });

  it("a pasted image without a name is accepted only when the bytes prove an image", () => {
    expect(validateAttachment({ bytes: PNG, filename: "" })).toEqual({ ok: true, contentType: "image/png", ext: "", bytes: PNG.length });
    expect(validateAttachment({ bytes: PDF, filename: "" }).ok).toBe(false);
  });
});

describe("validateAttachment — the floor and the limits", () => {
  it.each(["exe", "sh", "js", "dmg", "msi", "jar"])("forbidden .%s is refused even when the caller allows it", (ext) => {
    const v = validateAttachment({ bytes: TEXT, filename: `a.${ext}` }, { allowedExt: [ext, "txt"] });
    expect(v).toEqual({ ok: false, reason: `file type ".${ext}" can never be attached` });
  });

  it("an extension outside the list is refused; the caller may widen it", () => {
    expect(validateAttachment({ bytes: ZIP, filename: "a.zip" })).toEqual({ ok: false, reason: 'file type ".zip" not allowed' });
    expect(validateAttachment({ bytes: ZIP, filename: "a.zip" }, { allowedExt: ["zip"] })).toEqual({ ok: true, contentType: "application/zip", ext: "zip", bytes: ZIP.length });
  });

  it("svg and html are not in the default list", () => {
    expect(validateAttachment({ bytes: pad("<svg"), filename: "a.svg" }).ok).toBe(false);
    expect(validateAttachment({ bytes: pad("<html>"), filename: "a.html" }).ok).toBe(false);
  });

  it("empty and oversize files are refused; the limit is settable", () => {
    expect(validateAttachment({ bytes: new Uint8Array(0), filename: "a.png" })).toEqual({ ok: false, reason: "empty file" });
    expect(validateAttachment({ bytes: PNG, filename: "a.png" }, { maxBytes: 10 })).toEqual({ ok: false, reason: `size ${PNG.length} exceeds 10 bytes` });
    expect(ATTACHMENT_MAX_BYTES).toBe(25 * 1024 * 1024);
  });

  it("accepts an ArrayBuffer as well as a Uint8Array", () => {
    expect(validateAttachment({ bytes: PDF.slice().buffer, filename: "a.pdf" }).ok).toBe(true);
  });
});

describe("attachmentKey — your id, never the file name", () => {
  it("builds attachments/<id>", () => {
    expect(attachmentKey("3f2b9c1e-7a44-4d8e-9a0b-1c2d3e4f5a6b")).toBe("attachments/3f2b9c1e-7a44-4d8e-9a0b-1c2d3e4f5a6b");
  });
  it.each(["../x", "a/b/c/d/e", "short", "faktura.pdf", "x".repeat(129), "æøå-æøå-æøå"])("refuses %s", (id) => {
    expect(() => attachmentKey(id)).toThrow(/attachment id/);
  });
});

describe("attachmentHeaders — nothing scriptable renders inline", () => {
  it("an image renders inline, with the name intact", () => {
    expect(attachmentHeaders("image/png", 10, { filename: "skærm.png" })).toEqual({
      "Content-Type": "image/png",
      "Content-Length": "10",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline; filename=\"sk_rm.png\"; filename*=UTF-8''sk%C3%A6rm.png",
    });
  });

  it("a PDF renders inline, and can be forced to download", () => {
    expect(attachmentHeaders("application/pdf", 5, { filename: "a.pdf" })["Content-Disposition"]).toBe("inline; filename=\"a.pdf\"; filename*=UTF-8''a.pdf");
    expect(attachmentHeaders("application/pdf", 5, { filename: "a.pdf", download: true })["Content-Disposition"]).toBe("attachment; filename=\"a.pdf\"; filename*=UTF-8''a.pdf");
  });

  it.each(["image/svg+xml", "text/html", "text/plain; charset=utf-8", "application/msword", ""])("%s is a hardened download", (type) => {
    const h = attachmentHeaders(type, 1, { filename: "f" });
    expect(h["Content-Security-Policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Disposition"]).toBe("attachment; filename=\"f\"; filename*=UTF-8''f");
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of 'abc'", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
