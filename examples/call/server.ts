// examples/call — test harness for @broberg/call against the real media server.
import { readFileSync } from "node:fs";
import { createRoomToken } from "../../packages/call/src/server.ts";

const apiKey = readFileSync(process.env.LIVEKIT_KEY_FILE!, "utf8").trim();
const apiSecret = readFileSync(process.env.LIVEKIT_SECRET_FILE!, "utf8").trim();
const MEDIA_URL = process.env.MEDIA_URL ?? "wss://voice.broberg.ai";

const built = await Bun.build({ entrypoints: [new URL("./page.ts", import.meta.url).pathname], target: "browser", minify: false });
if (!built.success) { console.error(built.logs); process.exit(1); }
const bundle = await built.outputs[0]!.text();

const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>call harness</title>
<style>body{font:14px system-ui;margin:16px}button{margin:4px;padding:6px 10px}video{width:240px;background:#111;margin:4px}</style></head>
<body data-testid="call-root"><div id="app"></div><script>window.MEDIA_URL=${JSON.stringify(MEDIA_URL)}</script><script type="module">${bundle}</script></body></html>`;

Bun.serve({
  port: Number(process.env.PORT ?? 5199),
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/token") {
      const id = u.searchParams.get("id") ?? "anon";
      const room = `components-test:${u.searchParams.get("room") ?? "default"}`;
      const token = await createRoomToken({ apiKey, apiSecret, room, identity: id, name: id, sources: ["microphone", "camera", "screen_share", "screen_share_audio"] });
      return Response.json({ token, room });
    }
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
console.log("call harness on :" + (process.env.PORT ?? 5199));
