// F101.3 — the example page: the reference editor (Preact) with an image upload, a product block with its
// OWN picker (a popover — never window.prompt), and Save → the server echoes what it stored.
import "@broberg/theme/css/palettes.css";
import "@broberg/editor/css/editor.css";
import "./app.css";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { initPalette, initTheme } from "@broberg/theme";
import { RichTextEditor } from "@broberg/editor/preact";
import { blocks } from "./blocks";

initTheme();
initPalette();

async function uploadImage(file: File) {
  const body = new FormData();
  body.set("file", file);
  const res = await fetch("/api/upload", { method: "POST", body });
  if (!res.ok) throw new Error(`Upload fejlede (${res.status})`);
  return (await res.json()) as { src: string; alt?: string };
}

function App() {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [picker, setPicker] = useState<{ resolve: (v: Record<string, string> | null) => void } | null>(null);
  const [sku, setSku] = useState("");

  useEffect(() => {
    void fetch("/api/doc").then((r) => r.json()).then((d: { markdown: string }) => {
      setLoaded(d.markdown);
      setDraft(d.markdown);
    });
  }, []);

  const doSave = async () => {
    setSave("saving");
    try {
      const res = await fetch("/api/doc", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ markdown: draft }) });
      if (!res.ok) throw new Error(String(res.status));
      const stored = (await res.json()) as { markdown: string };
      setSave(stored.markdown === draft ? "saved" : "error"); // saved means the server holds EXACTLY this
    } catch {
      setSave("error");
    }
  };

  const close = (v: Record<string, string> | null) => {
    picker?.resolve(v);
    setPicker(null);
    setSku("");
  };

  if (loaded === null) return <p class="ex" data-testid="editor-example-loading">Henter…</p>;
  return (
    <main class="ex" data-testid="editor-example-root">
      <h1>@broberg/editor</h1>
      <RichTextEditor
        docKey="news"
        content={loaded}
        placeholder="Skriv en nyhed…"
        onChange={(md) => { setDraft(md); setSave("idle"); }}
        uploadImage={uploadImage}
        blocks={blocks}
        blockPickers={{ product: () => new Promise((resolve) => setPicker({ resolve })) }}
      />
      {picker ? (
        <div class="ex-picker" role="dialog" aria-label="Vælg vare" data-testid="editor-example-picker">
          <input class="ex-input" value={sku} placeholder="Varenummer" aria-label="Varenummer" data-testid="editor-example-sku"
            onInput={(e) => setSku((e.currentTarget as HTMLInputElement).value)} />
          <button type="button" class="ex-btn" disabled={!sku.trim()} data-testid="editor-example-sku-insert" onClick={() => close({ sku: sku.trim() })}>Indsæt</button>
          <button type="button" class="ex-btn is-quiet" data-testid="editor-example-sku-cancel" onClick={() => close(null)}>Annullér</button>
        </div>
      ) : null}
      <div class="ex-actions">
        <button type="button" class="ex-btn" data-testid="editor-example-save" disabled={save === "saving"} aria-busy={save === "saving"} onClick={() => void doSave()}>
          {save === "saving" ? "Gemmer…" : "Gem"}
        </button>
        <span class="ex-status" role="status" data-testid="editor-example-status">
          {save === "saved" ? "Gemt" : save === "error" ? "Kunne ikke gemme" : ""}
        </span>
        <a class="ex-link" href="/preview" data-testid="editor-example-preview-link">Se siden (renderet på serveren)</a>
      </div>
      <pre class="ex-md" data-testid="editor-example-markdown">{draft}</pre>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
