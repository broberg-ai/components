// F017 example: a settings page whose Save really stores. Kept in memory, so a
// page reload reads back what was saved (the read-back proof), a server restart
// does not. PORT defaults to 5196.
const out = await Bun.build({ entrypoints: [import.meta.dir + "/main.tsx"], target: "browser", minify: false });
if (!out.success) {
  for (const log of out.logs) console.error(log);
  process.exit(1);
}
const files = new Map<string, Blob>();
for (const o of out.outputs) files.set("/" + o.path.replace(/^\.\//, ""), o);
const css = [...files.keys()].filter((p) => p.endsWith(".css"));
const js = [...files.keys()].filter((p) => p.endsWith(".js"));
const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Settings example</title>${css.map((p) => `<link rel="stylesheet" href="${p}">`).join("")}
<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}.ex-page{padding:0 24px 24px}@media (max-width:767px){.ex-page{padding:0 16px 16px}}</style>
</head><body><div id="app"></div>${js.map((p) => `<script type="module" src="${p}"></script>`).join("")}</body></html>`;

let stored = { appName: "Acme", supportMail: "support@example.com", maintenance: false, apiKey: "" };

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5196),
  hostname: "127.0.0.1", // an example page, not something to serve to the LAN
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/api/settings" && req.method === "GET") return Response.json(stored);
    if (path === "/api/settings" && req.method === "PUT") {
      const body = (await req.json()) as Partial<typeof stored>;
      if (body.appName === "fail") return Response.json({ error: "rejected" }, { status: 400 });
      stored = { ...stored, ...body };
      return Response.json(stored);
    }
    const file = files.get(path);
    if (file) return new Response(file, { headers: { "content-type": file.type } });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
console.log(`settings example on ${server.url}`);
