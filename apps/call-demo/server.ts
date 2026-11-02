// F104.9.6 — call-demo: a password-protected page where the owner tries @broberg/call
// (voice, camera, screen share) and recording on his own machines. Owner's GO 2/11 2026
// «GO med adgangskode». Not a product: one room per name, recordings play back from R2.
import { createHmac, timingSafeEqual } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { createRoomToken } from "../../packages/call/src/server.ts";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} must be set`);
  return v;
};
const API_KEY = env("LIVEKIT_API_KEY");
const API_SECRET = env("LIVEKIT_API_SECRET");
const PASSWORD = env("DEMO_PASSWORD");
const MEDIA_URL = process.env.MEDIA_URL ?? "wss://voice.broberg.ai";
const CONTROL_URL = process.env.CONTROL_URL ?? "https://broberg-voice-control.fly.dev";
const R2_ENDPOINT = env("R2_ENDPOINT").replace(/\/$/, "");
const R2 = new AwsClient({ accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), service: "s3", region: "auto" });
const BUCKET = "broberg-call-recordings";
const ROOM_PREFIX = "demo:";

// ---- a session cookie that proves the password was typed (no native browser dialog) ----
const COOKIE = "call_demo";
const sessionValue = createHmac("sha256", API_SECRET).update("call-demo:" + PASSWORD).digest("base64url");
const authed = (req: Request) => {
  const v = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1) ?? "";
  return v.length === sessionValue.length && timingSafeEqual(Buffer.from(v), Buffer.from(sessionValue));
};
const sameSecret = (a: string, b: string) => {
  const x = createHmac("sha256", "cmp").update(a).digest(), y = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(x, y);
};

// ---- the token control accepts: signed with the app's own LiveKit key, roomRecord for ONE room ----
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function recordToken(room: string) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ iss: API_KEY, nbf: now - 5, exp: now + 300, video: { roomRecord: true, room } });
  return `${h}.${p}.${createHmac("sha256", API_SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
async function control(path: string, room: string, init: RequestInit = {}) {
  const res = await fetch(CONTROL_URL + path, { ...init, headers: { authorization: `Bearer ${recordToken(room)}`, "content-type": "application/json" } });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
}

const roomOf = (name: string | null) => {
  const r = (name ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || "demo";
  return ROOM_PREFIX + r;
};

const built = await Bun.build({ entrypoints: [new URL("./page.ts", import.meta.url).pathname], target: "browser", minify: true });
if (!built.success) { console.error(built.logs); process.exit(1); }
const bundle = await built.outputs[0]!.text();

const STYLE = `:root{--bg:#f7f6f3;--fg:#1d1d1b;--muted:#6b6a66;--accent:#c4552d;--accent-fg:#fff;--line:#dedbd4;--rec:#c62828}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#eceae4;--muted:#9a978f;--line:#34332f;--accent:#e0714a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1100px;padding:16px}h1{font-size:20px;margin:0 0 12px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
input{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--fg);min-width:0}
button{font:inherit;padding:8px 14px;border:1px solid var(--line);border-radius:8px;background:transparent;color:var(--fg);cursor:pointer;transition:background .12s,transform .05s}
button:hover:not(:disabled){background:color-mix(in srgb,var(--fg) 8%,transparent)}button:active:not(:disabled){transform:translateY(1px)}
button:disabled{opacity:.45;cursor:not-allowed}button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
button.on{outline:2px solid var(--accent)}button.busy{opacity:.7;cursor:progress}
.status{color:var(--muted);font-size:13px}.error{color:var(--rec);font-size:13px;min-height:1em}
.rec{display:none;align-items:center;gap:6px;color:var(--rec);font-weight:600}.rec.show{display:inline-flex}
.rec i{width:10px;height:10px;border-radius:50%;background:var(--rec);animation:p 1s infinite}@keyframes p{50%{opacity:.3}}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;margin-top:12px}
.tile{position:relative;background:#000;border-radius:10px;overflow:hidden;aspect-ratio:16/9}.tile video{width:100%;height:100%;object-fit:contain}
.tile span{position:absolute;left:8px;bottom:6px;color:#fff;font-size:12px;text-shadow:0 1px 2px #000}
ul{padding-left:18px}a{color:var(--accent)}`;

const page = (body: string) => new Response(`<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Call demo</title><style>${STYLE}</style></head><body data-testid="demo-root">${body}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

const LOGIN = (err = "") => page(`<main><h1>Call demo</h1><form method="post" action="/login" class="row" data-testid="demo-login-form">
<input type="password" name="password" placeholder="Adgangskode" autofocus data-testid="demo-password">
<button class="primary" type="submit" data-testid="demo-login">Log ind</button></form><p class="error" data-testid="demo-login-error">${err}</p></main>`);

Bun.serve({
  port: Number(process.env.PORT ?? 8080),
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/health") return Response.json({ ok: true });
    if (u.pathname === "/login" && req.method === "POST") {
      const pw = String((await req.formData()).get("password") ?? "");
      if (!sameSecret(pw, PASSWORD)) return LOGIN("Forkert adgangskode");
      return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `${COOKIE}=${sessionValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` } });
    }
    if (!authed(req)) return u.pathname === "/" ? LOGIN() : Response.json({ error: "login_required" }, { status: 401 });

    if (u.pathname === "/token") {
      const name = (u.searchParams.get("name") ?? "").trim().slice(0, 40) || "gæst";
      const room = roomOf(u.searchParams.get("room"));
      const identity = `${name}-${crypto.randomUUID().slice(0, 6)}`;
      const token = await createRoomToken({ apiKey: API_KEY, apiSecret: API_SECRET, room, identity, name, sources: ["microphone", "camera", "screen_share", "screen_share_audio"] });
      return Response.json({ token, room, url: MEDIA_URL });
    }
    if (u.pathname === "/record/start" && req.method === "POST") {
      const room = roomOf((await req.json().catch(() => ({}))).room);
      return control("/v1/recordings", room, { method: "POST", body: JSON.stringify({ room }) });
    }
    const m = u.pathname.match(/^\/record\/(rec_[\w-]+)(\/stop)?$/);
    if (m) {
      const room = roomOf(u.searchParams.get("room"));
      return control(`/v1/recordings/${m[1]}${m[2] ?? ""}`, room, { method: m[2] ? "POST" : "GET" });
    }
    if (u.pathname === "/play") {
      const key = u.searchParams.get("key") ?? "";
      if (!key.startsWith(ROOM_PREFIX) || key.includes("..")) return Response.json({ error: "not_a_demo_recording" }, { status: 400 });
      const signed = await R2.sign(`${R2_ENDPOINT}/${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}?X-Amz-Expires=3600`, { aws: { signQuery: true } });
      return new Response(null, { status: 302, headers: { location: signed.url } });
    }
    return page(`<main id="app"></main><script type="module">${bundle}</script>`);
  },
});
console.log("call-demo ready");
