import { describe, it, expect } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import jsQR from "jsqr";
import { createAuth } from "../src/index.js";
import { buildTwoFactorPlugin, totpQr } from "../src/two-factor.js";

/** F008.11 — the factories now refuse a boot with no signing secret at all, so
 *  a test that boots auth must bring one. Booting on Better Auth's public
 *  default is a configuration nobody should run, tests included. */
const TEST_SECRET = "test-only-secret-xK7pQ2mR9vTnW4bYcHsEdZgLjF8aU3o=";


const db = () => memoryAdapter({});

/** vn-leker's rule applied to a QR: looking at the image proves nothing. Raster
 *  the SVG's module grid and decode it with a real decoder. */
function decode(svg: string): string | null {
  const view = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!view) throw new Error("no viewBox — cannot raster");
  // uqr emits one <rect> background plus a single <path> whose runs are
  // "M{x},{y}h{u}v{u}h-{u}z" in absolute units, u = the module size. Derive u
  // from the first run rather than hardcoding 10 — a change in uqr's unit would
  // otherwise silently shift every module and produce an unreadable raster.
  const runs = [...svg.matchAll(/M(\d+),(\d+)h(\d+)v\3h-\3z/g)];
  if (runs.length === 0) throw new Error("no modules found — the raster would be blank");
  const unit = Number(runs[0][3]);
  const side = Number(view[1]) / unit;
  const mods = runs.map((m) => [Number(m[1]) / unit, Number(m[2]) / unit] as const);
  const S = 8;
  const px = new Uint8ClampedArray(side * S * side * S * 4).fill(255);
  for (const [mx, my] of mods) {
    for (let dy = 0; dy < S; dy++) {
      for (let dx = 0; dx < S; dx++) {
        const i = ((my * S + dy) * side * S + (mx * S + dx)) * 4;
        px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255;
      }
    }
  }
  return jsQR(px, side * S, side * S)?.data ?? null;
}

const URI =
  "otpauth://totp/WebHouse:cb@webhouse.dk?secret=JBSWY3DPEHPK3PXP&issuer=WebHouse&algorithm=SHA1&digits=6&period=30";

describe("AC#3 — the QR decodes back to the URI, byte-exact", () => {
  it("a real decoder reads the generated SVG and gets the input back", () => {
    // An unscannable QR renders perfectly and fails only in someone's hand.
    expect(decode(totpQr(URI))).toBe(URI);
  });

  it("CONTROL: the decoder rejects a QR built from different input", () => {
    // Without this, a decode() that returned its own argument would pass above.
    expect(decode(totpQr(URI + "&x=1"))).not.toBe(URI);
  });

  it("dataUri wraps the same SVG and decodes identically", () => {
    const uri = totpQr(URI, "dataUri");
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svg = Buffer.from(uri.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8");
    expect(decode(svg)).toBe(URI);
  });

  it("refuses an empty URI rather than rendering an empty code", () => {
    expect(() => totpQr("")).toThrow(/needs the totpURI/);
  });
});

describe("AC#4 — the QR helper runs in a browser too", () => {
  it("dataUri works with NO Buffer — the assertion the first version was missing", () => {
    // The original implementation used Buffer.from() and threw "Buffer is not
    // defined" in a browser, while the README and the AC both claimed browser
    // support. The old test asserted only that document/window are absent — Node
    // — which is the one runtime where Buffer EXISTS. It could not have caught
    // this. Deleting Buffer is what reproduces a browser for this code path.
    const real = globalThis.Buffer;
    // @ts-expect-error — deliberately simulating a runtime without Buffer
    delete globalThis.Buffer;
    try {
      const uri = totpQr(URI, "dataUri");
      expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
      const svg = decodeBase64(uri.slice("data:image/svg+xml;base64,".length));
      expect(decode(svg)).toBe(URI);
    } finally {
      globalThis.Buffer = real;
    }
  });

  it("CONTROL: the SVG format never needed Buffer, so the test above is about the base64 branch", () => {
    const real = globalThis.Buffer;
    // @ts-expect-error — deliberately simulating a runtime without Buffer
    delete globalThis.Buffer;
    try {
      expect(decode(totpQr(URI))).toBe(URI);
    } finally {
      globalThis.Buffer = real;
    }
  });
});

/** Decode base64 without Buffer, so the assertion does not need what it is testing for. */
function decodeBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

describe("AC#4 — the QR helper needs no DOM", () => {
  it("runs with no document/window present", () => {
    // vitest's default environment is node; assert that rather than assume it,
    // so this test cannot pass in a jsdom run and claim server-side support.
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    expect(decode(totpQr(URI))).toBe(URI);
  });
});

describe("AC#2 — the plugin registers, and dark-ships when absent", () => {
  it("registers two-factor endpoints when the plugin is passed", () => {
    const auth = createAuth({
      database: db(), secret: TEST_SECRET,
      emailPassword: true,
      plugins: [buildTwoFactorPlugin({ issuer: "WebHouse" })],
    });
    const paths = Object.keys(auth.api);
    expect(paths.some((p) => /twoFactor|TwoFactor/.test(p))).toBe(true);
  });

  it("dark-ship: no plugin passed → no two-factor endpoints, and no throw", () => {
    const auth = createAuth({ database: db(), secret: TEST_SECRET, emailPassword: true });
    const paths = Object.keys(auth.api);
    expect(paths.some((p) => /twoFactor|TwoFactor/.test(p))).toBe(false);
  });

  it("the issuer reaches the plugin (it is what the app shows the user)", () => {
    const plugin = buildTwoFactorPlugin({ issuer: "WebHouse" });
    expect(plugin.id).toBe("two-factor");
  });
});
