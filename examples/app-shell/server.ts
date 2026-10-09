// Builds main.tsx once at start and serves it. PORT defaults to 5195.
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
<title>App shell example</title>${css.map((p) => `<link rel="stylesheet" href="${p}">`).join("")}
<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}.ex-page{padding:16px 24px}@media (max-width:767px){.ex-page{padding:12px 16px}}.ex-count{display:inline-block;min-width:1.25rem;padding:0 .35rem;margin-left:.25rem;border-radius:999px;background:var(--bg-sunk);color:var(--fg-muted);font-size:.75rem;text-align:center}</style>
</head><body><div id="app"></div>${js.map((p) => `<script type="module" src="${p}"></script>`).join("")}</body></html>`;

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5195),
  hostname: "127.0.0.1", // an example page, not something to serve to the LAN
  fetch(req) {
    const path = new URL(req.url).pathname;
    const file = files.get(path);
    if (file) return new Response(file, { headers: { "content-type": file.type } });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
console.log(`data-table example on ${server.url}`);
