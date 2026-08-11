// @broberg/webpush — CLASSIC-script build of the service-worker handlers.
//
// WHY THIS FILE EXISTS: a service worker in `public/` is a STATIC file. It is
// served straight to the browser, never passes through a bundler, and therefore
// cannot `import` from node_modules. Two repos hand-wrote copies of these
// handlers for exactly that reason. This build is the same code with no import
// and no export, so an unbundled worker can use it.
//
//   // your public/sw.js
//   importScripts('/sw.global.js');                        // listeners attached
//   BrobergWebPush.configure({ defaultTitle: 'Cardmem' }); // optional
//
// ⚠️ DELETE YOUR OWN `push` HANDLER WHEN YOU ADOPT THIS. addEventListener is
// ADDITIVE, so this file's listener does not replace yours — it runs ALONGSIDE
// it, and two handlers both calling showNotification produce TWO banners per
// push. It will hit you exactly when you believe you are cleaning up.
import { createPushHandler, handleNotificationClick, type PushHandlerOptions } from './sw';

// ONE registered listener, for the lifetime of the worker. Everything
// configurable swaps what it DELEGATES to.
//
// v0.2.1 — cardmem read the published 0.2.0 tarball and found the trap this
// file warns about, opened by this file: it registered `handlePush` outright
// AND exposed `createPushHandler`. Anyone who wanted to configure anything —
// which is the entire reason the factory exists — had to add a second listener,
// so the default handler and the configured one both ran. Two banners, both of
// them ours, and the README's "delete your OWN handler" did not cover it
// because neither was the consumer's.
//
// The fix is not a louder warning. Delegation makes the duplicate impossible to
// express: configure() REPLACES what the single listener calls. You cannot
// double-register through this package's own API.
let current = createPushHandler();

function configure(options: PushHandlerOptions = {}): void {
  current = createPushHandler(options);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).BrobergWebPush = {
  configure,
  // Exposed for anyone wiring listeners by hand. Note that calling
  // createPushHandler here and registering it YOURSELF re-opens the duplicate —
  // use configure() unless you have deliberately not let this file register.
  createPushHandler,
  handleNotificationClick,
  /** The live handler, for tests that want to drive it directly. */
  get handlePush() {
    return current;
  },
};

self.addEventListener('push', ((event: PushEvent) => current(event)) as EventListener);
self.addEventListener('notificationclick', handleNotificationClick as EventListener);
