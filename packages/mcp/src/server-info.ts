// F007.17 — the server's own identity in the MCP `initialize` result
// (MCP 2025-11-25 Implementation.icons / websiteUrl). One type and one builder
// for every factory, so stdio, Streamable-HTTP and both SSE variants cannot
// drift apart. Without the optional fields serverInfo is exactly { name, version }.

export interface ServerIcon {
  /** Absolute URL of the image (your app's own, e.g. https://app.example/icon.png). */
  src: string;
  mimeType?: string;
  /** e.g. ["48x48"] or ["any"] for SVG. */
  sizes?: string[];
}

export interface ServerIdentityOptions {
  /** Icons a client may show for this server (e.g. claude.ai's connector list). */
  icons?: ServerIcon[];
  /** The app's homepage. */
  websiteUrl?: string;
}

export function serverInfo(opts: { name: string; version: string } & ServerIdentityOptions) {
  return {
    name: opts.name,
    version: opts.version,
    ...(opts.icons ? { icons: opts.icons } : {}),
    ...(opts.websiteUrl ? { websiteUrl: opts.websiteUrl } : {}),
  };
}
