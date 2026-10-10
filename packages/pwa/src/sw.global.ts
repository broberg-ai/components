// F021.10 — CLASSIC-script build of the service-worker half (sales-F001.7).
//
// A service worker in `public/` is a static file: it never passes through a
// bundler and cannot `import` from node_modules, so `@broberg/pwa/sw` (an ES
// module) was out of reach and each app would have copied listenForSkipWaiting.
// Same pattern as @broberg/webpush's sw.global.js:
//
//   // public/sw.js
//   importScripts('/sw.global.js');      // @broberg/webpush
//   importScripts('/pwa-sw.global.js');  // this file — «Opdatér nu» works
//
// The listener is attached on load; do NOT call listenForSkipWaiting again
// (addEventListener is additive). The file is named pwa-sw.global.js so it can
// sit in public/ beside webpush's sw.global.js without overwriting it.
import { listenForSkipWaiting, SKIP_WAITING } from "./sw";

listenForSkipWaiting(self as unknown as Parameters<typeof listenForSkipWaiting>[0]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).BrobergPwa = { listenForSkipWaiting, SKIP_WAITING };
