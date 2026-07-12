import { describe, it, expect } from "vitest";
import { contentDisposition } from "../src/index";

/** Pull the `filename*=UTF-8''<X>` payload out of a header value. */
function ext(header: string): string {
  const m = header.match(/filename\*=UTF-8''([^;]+)/);
  return m ? m[1] : "";
}
/** Pull the ASCII `filename="X"` payload out of a header value. */
function asciiName(header: string): string {
  const m = header.match(/filename="([^"]*)"/);
  return m ? m[1] : "";
}

const NON_ASCII = /[^\u0020-\u007E]/;
const CONTROL = /[\u0000-\u001F\u007F]/;

describe("contentDisposition", () => {
  it("preserves a non-ASCII name in filename* and keeps filename= pure ASCII", () => {
    const h = contentDisposition("brændte-filer.pdf");
    expect(h.startsWith("attachment; ")).toBe(true);
    // filename* round-trips to the exact original
    expect(decodeURIComponent(ext(h))).toBe("brændte-filer.pdf");
    // filename= is pure ASCII (no byte above 0x7E)
    const fallback = asciiName(h);
    expect(NON_ASCII.test(fallback)).toBe(false);
    expect(fallback).toBe("br_ndte-filer.pdf");
  });

  it("pct-encodes the RFC 5987 attr-char reserved set ' ( ) *", () => {
    const h = contentDisposition("a'b(c)d*e.txt");
    const star = ext(h);
    expect(star).toContain("%27"); // '
    expect(star).toContain("%28"); // (
    expect(star).toContain("%29"); // )
    expect(star).toContain("%2A"); // *
    expect(decodeURIComponent(star)).toBe("a'b(c)d*e.txt");
  });

  it("defaults to attachment and honours disposition: inline", () => {
    expect(contentDisposition("a.pdf").startsWith("attachment; ")).toBe(true);
    expect(
      contentDisposition("a.pdf", { disposition: "inline" }).startsWith("inline; "),
    ).toBe(true);
  });

  it("is header-injection safe and guards an empty name", () => {
    const h = contentDisposition("evil\r\nSet-Cookie: x .pdf");
    expect(CONTROL.test(h)).toBe(false); // no control/CR/LF anywhere
    expect(contentDisposition("").includes('filename="download"')).toBe(true);
    expect(contentDisposition("   ").includes('filename="download"')).toBe(true);
  });

  it("replaces path separators and quotes in the ASCII fallback", () => {
    const h = contentDisposition('a/b\\c"d.pdf');
    expect(asciiName(h)).toBe("a_b_c_d.pdf");
  });
});
