// F099.6 — the popup as a page for Lens (an extension cannot be loaded by Lens).
// Builds src/preview.tsx once at start and serves it. PORT defaults to 5200.
const out = await Bun.build({ entrypoints: [import.meta.dir + "/src/preview.tsx"], target: "browser", minify: false });
if (!out.success) {
  for (const log of out.logs) console.error(log);
  process.exit(1);
}
const files = new Map<string, Blob>();
for (const o of out.outputs) files.set("/" + o.path.replace(/^\.\//, ""), o);
const css = [...files.keys()].filter((p) => p.endsWith(".css"));
const js = [...files.keys()].filter((p) => p.endsWith(".js"));
const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Web Clipper preview</title>${css.map((p) => `<link rel="stylesheet" href="${p}">`).join("")}
<style>body{margin:0;background:var(--bg-sunk);color:var(--fg)}</style>
</head><body><div id="app"></div>${js.map((p) => `<script type="module" src="${p}"></script>`).join("")}</body></html>`;

// F099.26 — a stand-in for BID's passkey frame (?state=embedded-passkey): the real one does Face ID
// at id.broberg.ai; this one only posts the answer to the popup, on the same origin as the in-page BID.
const passkeyFrame = (flow: string) => `<!doctype html><html lang="da"><head><meta charset="utf-8"><style>
body{margin:0;font:600 14px system-ui,sans-serif}button{width:100%;height:44px;border:0;border-radius:100px;background:#00b2ff;color:#04222f;font:inherit;cursor:pointer}
button:hover{filter:brightness(1.07)}button:active{transform:translateY(1px)}a{display:block;text-align:center;font-size:11px;margin-top:4px;color:#888}</style></head><body>
<button type="button" data-testid="passkey-frame-button">⚿&nbsp; Log ind med adgangsnøgle</button>
<a href="#" data-testid="passkey-frame-none">(demo) ingen nøgle på denne enhed</a>
<script>const send=(o)=>parent.postMessage(Object.assign({type:"bid-embedded-passkey",flow_id:${JSON.stringify(flow)}},o),location.origin);
document.querySelector("button").onclick=()=>send({ok:true});document.querySelector("a").onclick=(e)=>{e.preventDefault();send({ok:false,error:"not_found"})};</script></body></html>`;

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5200),
  hostname: "127.0.0.1", // an example page, not something to serve to the LAN
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/embedded/passkey/frame") return new Response(passkeyFrame(url.searchParams.get("flow") ?? ""), { headers: { "content-type": "text/html; charset=utf-8" } });
    const file = files.get(url.pathname);
    if (file) return new Response(file, { headers: { "content-type": file.type } });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
console.log(`web-clipper preview on ${server.url}`);
