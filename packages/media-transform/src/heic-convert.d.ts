// heic-convert ships no types. It is the pure-JS (libheif) fallback we use only
// when the native sharp build on a given host lacks HEIF decode.
declare module "heic-convert" {
  interface ConvertOptions {
    buffer: Uint8Array | ArrayBufferLike;
    format: "JPEG" | "PNG";
    /** 0–1. */
    quality?: number;
  }
  function convert(options: ConvertOptions): Promise<ArrayBuffer>;
  export default convert;
}
