/**
 * @broberg/pwa/manifest — the PWA *install* half (the update half lives in the
 * root export). A dependency-free manifest/meta factory + an SVG-based icon
 * generator, so a repo stops hand-rolling `app/manifest.ts`, a
 * `gen-pwa-icons.cjs` script, and a pile of apple-touch `<meta>` tags.
 *
 * Everything here is PURE string/object generation — no filesystem, no
 * rasteriser, no runtime deps — so it runs in Node, Bun, edge, a build script,
 * or the browser, and every piece is offline-unit-testable. Icons are emitted
 * as self-contained SVG documents (modern manifests + apple-touch accept SVG);
 * a consumer that specifically needs PNG can rasterise the SVGs with `sharp`
 * on their side — the package stays dep-free.
 */

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export type Display = "standalone" | "fullscreen" | "minimal-ui" | "browser";

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  /** "any" | "maskable" | "monochrome" (space-separated allowed). */
  purpose?: string;
}

export interface WebAppManifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: Display;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
  description?: string;
  lang?: string;
  orientation?: string;
  categories?: string[];
  id?: string;
  [key: string]: unknown;
}

export interface DefineManifestOptions {
  /** App name (required). */
  name: string;
  /** Home-screen label. Default: `name`. */
  shortName?: string;
  /** Default `/`. */
  startUrl?: string;
  /** Default `/`. */
  scope?: string;
  /** Default `standalone`. */
  display?: Display;
  /** Address-bar / task-switcher colour. Default `#ffffff`. */
  themeColor?: string;
  /** Splash background. Default `#ffffff`. */
  backgroundColor?: string;
  description?: string;
  lang?: string;
  orientation?: string;
  categories?: string[];
  id?: string;
  /** Manifest `icons[]` — typically `buildIconSet(...).icons`. */
  icons?: ManifestIcon[];
  /** Escape hatch: extra top-level manifest members, merged last. */
  extra?: Record<string, unknown>;
}

/**
 * Build a spec-valid Web App Manifest object. Required members are defaulted so
 * a one-liner produces an installable manifest; every default is overridable
 * and `extra` merges last for anything not modelled (shortcuts, screenshots…).
 */
export function defineManifest(opts: DefineManifestOptions): WebAppManifest {
  if (!opts?.name) throw new Error("defineManifest: `name` is required");
  const manifest: WebAppManifest = {
    name: opts.name,
    short_name: opts.shortName ?? opts.name,
    start_url: opts.startUrl ?? "/",
    scope: opts.scope ?? "/",
    display: opts.display ?? "standalone",
    theme_color: opts.themeColor ?? "#ffffff",
    background_color: opts.backgroundColor ?? "#ffffff",
    icons: opts.icons ?? [],
  };
  if (opts.description) manifest.description = opts.description;
  if (opts.lang) manifest.lang = opts.lang;
  if (opts.orientation) manifest.orientation = opts.orientation;
  if (opts.categories) manifest.categories = opts.categories;
  if (opts.id) manifest.id = opts.id;
  return { ...manifest, ...(opts.extra ?? {}) };
}

/** JSON-stringify a manifest for a `manifest.webmanifest` file. */
export function serializeManifest(
  manifest: WebAppManifest,
  opts: { pretty?: boolean } = {},
): string {
  return JSON.stringify(manifest, null, opts.pretty === false ? undefined : 2);
}

// ---------------------------------------------------------------------------
// Icon generation (SVG, zero-dep)
// ---------------------------------------------------------------------------

export interface GeneratedIcon {
  /** URL path, e.g. `/icons/icon-192.svg`. */
  path: string;
  /** The SVG document. */
  content: string;
  type: "image/svg+xml";
  size: number;
  purpose: "any" | "maskable";
}

export interface IconSet {
  files: GeneratedIcon[];
  /** Ready to drop into `defineManifest({ icons })`. */
  icons: ManifestIcon[];
}

export interface IconSetOptions {
  /**
   * Source artwork as a full SVG document (`<svg …>…</svg>`). Embedded via a
   * data-URI `<image>` so it scales cleanly at any size regardless of its
   * internal coordinate system. Mutually exclusive with `monogram`.
   */
  svg?: string;
  /** Fallback artwork: 1–3 letters rendered centred (e.g. "AK"). */
  monogram?: string;
  /** Foreground (monogram text) colour. Default `#ffffff`. */
  color?: string;
  /** Background fill. Default `#111827`. */
  background?: string;
  /** Icon sizes to emit. Default `[180, 192, 512]` (180 = apple-touch). */
  sizes?: number[];
  /** Also emit a maskable 512 with a padded safe-zone. Default `true`. */
  maskable?: boolean;
  /** URL prefix for every icon `src`. Default `/icons`. */
  basePath?: string;
}

const DEFAULT_SIZES = [180, 192, 512];

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;",
  );
}

/** UTF-8-safe base64 for the data-URI embed (works in Node/Bun/browser). */
function toBase64(s: string): string {
  // Reached via globalThis so the package needs no @types/node (browser-safe).
  const g = globalThis as unknown as {
    Buffer?: { from(input: string, enc: string): { toString(enc: string): string } };
    btoa?: (data: string) => string;
  };
  if (typeof g.Buffer !== "undefined") return g.Buffer.from(s, "utf-8").toString("base64");
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return g.btoa!(bin);
}

/** Render one square SVG icon document at `size`. `inset` = safe-zone fraction (maskable). */
function renderIcon(size: number, inset: number, opts: IconSetOptions): string {
  const bg = opts.background ?? "#111827";
  const fg = opts.color ?? "#ffffff";
  const pad = Math.round(size * inset);
  const inner = size - pad * 2;
  let art: string;
  if (opts.svg) {
    const href = `data:image/svg+xml;base64,${toBase64(opts.svg)}`;
    art = `<image x="${pad}" y="${pad}" width="${inner}" height="${inner}" href="${href}" preserveAspectRatio="xMidYMid meet"/>`;
  } else {
    const text = escapeXml((opts.monogram ?? "").slice(0, 3).toUpperCase());
    // Font sized to the safe inner box; a touch smaller for breathing room.
    const fontSize = Math.round(inner * (text.length >= 3 ? 0.42 : 0.52));
    art =
      `<text x="50%" y="50%" fill="${fg}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" ` +
      `font-weight="700" font-size="${fontSize}" text-anchor="middle" dominant-baseline="central">${text}</text>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${bg}"/>` +
    art +
    `</svg>`
  );
}

/**
 * Generate a full icon set (SVG) + the matching manifest `icons[]`. Deterministic,
 * zero-dep. Give it either a source `svg` or a `monogram`; it emits apple-touch
 * (180), 192, 512 by default plus a padded maskable-512.
 */
export function buildIconSet(opts: IconSetOptions): IconSet {
  if (!opts?.svg && !opts?.monogram) {
    throw new Error("buildIconSet: provide either `svg` or `monogram`");
  }
  const base = (opts.basePath ?? "/icons").replace(/\/$/, "");
  const sizes = opts.sizes ?? DEFAULT_SIZES;
  const files: GeneratedIcon[] = [];
  const icons: ManifestIcon[] = [];

  for (const size of sizes) {
    const path = `${base}/icon-${size}.svg`;
    files.push({ path, content: renderIcon(size, 0, opts), type: "image/svg+xml", size, purpose: "any" });
    // apple-touch-icon is referenced via a <link> (see pwaMetaTags), not the
    // manifest, so only real manifest sizes go into icons[].
    if (size !== 180) {
      icons.push({ src: path, sizes: `${size}x${size}`, type: "image/svg+xml", purpose: "any" });
    }
  }

  if (opts.maskable !== false) {
    // Maskable safe-zone: keep content within the central 80% (10% inset).
    const path = `${base}/icon-maskable-512.svg`;
    files.push({ path, content: renderIcon(512, 0.1, opts), type: "image/svg+xml", size: 512, purpose: "maskable" });
    icons.push({ src: path, sizes: "512x512", type: "image/svg+xml", purpose: "maskable" });
  }

  return { files, icons };
}

// ---------------------------------------------------------------------------
// Head meta tags
// ---------------------------------------------------------------------------

export interface MetaTag {
  tag: "meta" | "link";
  attrs: Record<string, string>;
}

export interface MetaTagsOptions {
  /** `<meta name="theme-color">`. Default `#ffffff`. */
  themeColor?: string;
  /** apple-touch-icon href. Default `/icons/icon-180.svg`. */
  appleTouchIcon?: string;
  /** Manifest href for the `<link rel="manifest">`. Default `/manifest.webmanifest`. */
  manifest?: string;
  /** apple-mobile-web-app-title. Default: omitted. */
  title?: string;
  /** apple-mobile-web-app-status-bar-style. Default `default`. */
  statusBarStyle?: "default" | "black" | "black-translucent";
  /** Emit the `*-web-app-capable` tags. Default `true`. */
  capable?: boolean;
}

/**
 * The head tags a PWA needs beyond the manifest link — returned as typed
 * descriptors so a consumer renders them in Next.js `metadata`, a Hono/JSX
 * head, or plain HTML. No framework assumption.
 */
export function pwaMetaTags(opts: MetaTagsOptions = {}): MetaTag[] {
  const tags: MetaTag[] = [];
  tags.push({ tag: "link", attrs: { rel: "manifest", href: opts.manifest ?? "/manifest.webmanifest" } });
  tags.push({ tag: "meta", attrs: { name: "theme-color", content: opts.themeColor ?? "#ffffff" } });
  tags.push({ tag: "link", attrs: { rel: "apple-touch-icon", href: opts.appleTouchIcon ?? "/icons/icon-180.svg" } });
  if (opts.capable !== false) {
    tags.push({ tag: "meta", attrs: { name: "mobile-web-app-capable", content: "yes" } });
    tags.push({ tag: "meta", attrs: { name: "apple-mobile-web-app-capable", content: "yes" } });
    tags.push({
      tag: "meta",
      attrs: { name: "apple-mobile-web-app-status-bar-style", content: opts.statusBarStyle ?? "default" },
    });
  }
  if (opts.title) {
    tags.push({ tag: "meta", attrs: { name: "apple-mobile-web-app-title", content: opts.title } });
  }
  return tags;
}
