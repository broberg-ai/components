// F100.4 — @broberg/livesync running for real: one Bun server that serves the
// page AND is the sync server (one room per ?doc=…), over a real WebSocket.
// What Lens drives with two browsers. PORT defaults to 5202.
//
// insecureNoAuth + 127.0.0.1 only: this is a local example. A real app passes
// `authorize` (its BrobergID check) and stores documents in its own database.
import { createLivesync, type ConnectionHandle } from "@broberg/livesync/server";

const out = await Bun.build({ entrypoints: [import.meta.dir + "/src/app.tsx"], target: "browser", minify: false });
if (!out.success) {
  for (const log of out.logs) console.error(log);
  process.exit(1);
}
const files = new Map<string, Blob>();
for (const o of out.outputs) files.set("/" + o.path.replace(/^\.\//, ""), o);
const css = [...files.keys()].filter((p) => p.endsWith(".css"));
const js = [...files.keys()].filter((p) => p.endsWith(".js"));
const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Livesync example</title>${css.map((p) => `<link rel="stylesheet" href="${p}">`).join("")}
</head><body><div id="app"></div>${js.map((p) => `<script type="module" src="${p}"></script>`).join("")}</body></html>`;

// The persistence hook, in memory — a real app writes these bytes to its own database.
const saved = new Map<string, Uint8Array>();
const lv = createLivesync({
  insecureNoAuth: true,
  persistence: { load: async (id) => saved.get(id) ?? null, store: async (id, state) => void saved.set(id, state) },
});

const server = Bun.serve<{ docId: string; handle?: ConnectionHandle }, never>({
  port: Number(process.env.PORT ?? 5202),
  hostname: "127.0.0.1", // an example, not something to serve to the LAN
  fetch(req, srv) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/sync\/([\w-]{1,64})$/);
    if (m) return srv.upgrade(req, { data: { docId: m[1]! } }) ? undefined : new Response("expected a WebSocket", { status: 400 });
    // Two people side by side in ONE window: two independent app instances (two
    // clients, two WebSockets through this server). For a single browser — the
    // honest stand-in until Lens can drive two browsers at once.
    if (url.pathname === "/duo") {
      const doc = encodeURIComponent(url.searchParams.get("doc") ?? "demo");
      const a = encodeURIComponent(url.searchParams.get("a") ?? "Anna");
      const b = encodeURIComponent(url.searchParams.get("b") ?? "Bo");
      return new Response(
        `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Livesync duo</title>
<style>body{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:4px;background:transparent}iframe{width:100%;height:100vh;border:0}</style></head>
<body><iframe data-testid="livesync-duo-a" name="a" src="/?name=${a}&doc=${doc}"></iframe><iframe data-testid="livesync-duo-b" name="b" src="/?name=${b}&doc=${doc}"></iframe></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    const file = files.get(url.pathname);
    if (file) return new Response(file, { headers: { "content-type": file.type } });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
  websocket: {
    open(ws) {
      ws.data.handle = lv.connect(ws.data.docId, { send: (bytes) => void ws.sendBinary(bytes), close: () => ws.close() });
    },
    message(ws, msg) {
      if (typeof msg !== "string") ws.data.handle?.message(new Uint8Array(msg));
    },
    close(ws) {
      ws.data.handle?.closed();
    },
  },
});
console.log(`livesync example on ${server.url}  (open ?name=Anna&doc=demo in two windows)`);
