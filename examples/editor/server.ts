// F101.3 — @broberg/editor running for real: a Bun server that serves the page, keeps ONE document in
// memory, takes image uploads (in memory — a real app sends them to R2) and renders the saved markdown
// to HTML on the server with @broberg/editor/server. What Lens drives. PORT defaults to 5204.
import { renderHTML } from "@broberg/editor/server";
import { blocks } from "./src/blocks";

const out = await Bun.build({ entrypoints: [import.meta.dir + "/src/app.tsx"], target: "browser", minify: false });
if (!out.success) {
  for (const log of out.logs) console.error(log);
  process.exit(1);
}
const files = new Map<string, Blob>();
for (const o of out.outputs) files.set("/" + o.path.replace(/^\.\//, ""), o);
const css = [...files.keys()].filter((p) => p.endsWith(".css"));
const js = [...files.keys()].filter((p) => p.endsWith(".js"));
const page = (body: string, title: string) => `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>${css.map((p) => `<link rel="stylesheet" href="${p}">`).join("")}</head><body>${body}</body></html>`;

let doc = "# Nyhed\n\nSkriv her.";
const uploads = new Map<string, { type: string; bytes: Uint8Array }>();

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5204),
  hostname: "127.0.0.1", // an example, not something to serve to the LAN
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/doc" && req.method === "GET") return Response.json({ markdown: doc });
    if (url.pathname === "/api/doc" && req.method === "PUT") {
      const body = (await req.json()) as { markdown?: unknown };
      if (typeof body.markdown !== "string") return new Response("markdown required", { status: 400 });
      doc = body.markdown;
      return Response.json({ markdown: doc }); // echo what was stored, so the page can prove it
    }
    if (url.pathname === "/api/upload" && req.method === "POST") {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File) || !file.type.startsWith("image/")) return new Response("image required", { status: 400 });
      const id = crypto.randomUUID();
      uploads.set(id, { type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
      return Response.json({ src: `/uploads/${id}`, alt: file.name.replace(/\.[^.]+$/, "") });
    }
    const up = url.pathname.match(/^\/uploads\/([\w-]+)$/);
    if (up) {
      const f = uploads.get(up[1]!);
      return f ? new Response(f.bytes, { headers: { "content-type": f.type } }) : new Response("not found", { status: 404 });
    }
    if (url.pathname === "/preview") return new Response(page(`<main class="ex" data-testid="editor-example-preview">${renderHTML(doc, { blocks })}</main>`, "Forhåndsvisning"), { headers: { "content-type": "text/html; charset=utf-8" } });
    const file = files.get(url.pathname);
    if (file) return new Response(file, { headers: { "content-type": file.type } });
    return new Response(page(`<div id="app"></div>${js.map((p) => `<script type="module" src="${p}"></script>`).join("")}`, "Editor example"), { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
console.log(`editor example on ${server.url}`);
