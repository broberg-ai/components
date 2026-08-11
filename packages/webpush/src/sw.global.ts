// @broberg/webpush — CLASSIC-script build of the service-worker handlers.
//
// WHY THIS FILE EXISTS: a service worker in `public/` is a STATIC file. It is
// served straight to the browser, never passes through a bundler, and therefore
// cannot `import` from node_modules. Two repos hand-wrote copies of these
// handlers for exactly that reason. This build is the same code with no import
// and no export, so an unbundled worker can use it.
//
//   // your public/sw.js
//   importScripts('/broberg-webpush-sw.js');   // copied from node_modules at build
//   // …the listeners are already attached; keep your own non-push logic here.
//
// ⚠️ DELETE YOUR OWN `push` HANDLER WHEN YOU ADOPT THIS. addEventListener is
// ADDITIVE, so this file's listener does not replace yours — it runs ALONGSIDE
// it, and two handlers both calling showNotification produce TWO banners per
// push. It will hit you exactly when you believe you are cleaning up.
import { createPushHandler, handleNotificationClick, handlePush } from './sw';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).BrobergWebPush = { handlePush, handleNotificationClick, createPushHandler };

self.addEventListener('push', handlePush as EventListener);
self.addEventListener('notificationclick', handleNotificationClick as EventListener);
